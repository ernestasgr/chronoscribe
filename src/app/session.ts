import { createStore, type StoreApi } from "zustand";
import { listenerId, mostRecentlyViewed, type Db, type ListenerId, type ListenerRow } from "../db";
import type { Subscriber } from "../events";
import { isSettled, type ImportRequest, type Ingest, type IngestEvents, type Job } from "../ingest";
import type { Timeline } from "../timeline";
import type { Failures } from "./failures";
import type { Settings } from "./settings";
import {
    byRecentView,
    screenOf,
    setupScreen,
    transition,
    viewedListener,
    withoutPin,
    withPin,
    type SessionEvent,
    type SessionState,
} from "./sessionState";

export {
    spotlitArtist,
    transition,
    viewedListener,
    type ApiKeyCheck,
    type Screen,
    type SessionEvent,
    type SessionState,
    type SetupProblem,
    type SetupStatus,
} from "./sessionState";

export interface SessionDeps {
    db: Db;
    events: Subscriber<IngestEvents>;
    ingest: Ingest;
    timeline: Timeline;
    settings: Settings;
    /** Where the failures of actions nobody awaits are reported. */
    failures: Pick<Failures, "report">;
    /** Every stored Listener: the app opens on the most recently viewed, resuming unfinished imports. */
    listeners: readonly ListenerRow[];
    /** The browser's timezone, offered for new Listeners. */
    defaultTimeZone: string;
    /** The clock a Listener's last view is stamped with. */
    now: () => number;
}

/** Which of the Listeners kept side by side is viewed, and which screen shows for them. */
export function createSession({
    db,
    events,
    ingest,
    timeline,
    settings,
    failures,
    listeners,
    defaultTimeZone,
    now,
}: SessionDeps) {
    const initial = mostRecentlyViewed(listeners);
    const store: StoreApi<SessionState> = createStore<SessionState>(() => ({
        screen: initial ? screenOf(initial) : setupScreen({ kind: "editing" }),
        apiKeyCheck: { kind: "idle" },
        listeners: byRecentView(listeners),
    }));
    const reads = { latest: 0 };

    /** Applies `event`, returning whether the session accepted it. */
    const dispatch = (event: SessionEvent): boolean => {
        const before = store.getState();
        store.setState(transition(before, event), true);
        return store.getState() !== before;
    };

    const currentListener = (): ListenerRow | undefined => viewedListener(store.getState());

    /** The username Settings checks a new API key against: the dashboard's or the import's. */
    const currentUsername = (): string | undefined => {
        const { screen } = store.getState();
        return screen.kind === "importing" ? screen.username : currentListener()?.username;
    };

    /** Picks an unfinished import back up with the stored API key. */
    const resume = (row: ListenerRow) =>
        void ingest.enqueueImport({
            username: row.username,
            apiKey: settings.store.getState().apiKey,
            timeZone: row.timeZone,
        });

    /** Resumes the import screen's import; one still queued or running is joined, not restarted. */
    async function resumeImport(): Promise<void> {
        const { screen } = store.getState();
        if (screen.kind !== "importing") return;
        const row = await db.listener(screen.listenerId);
        if (row && !row.importComplete) resume(row);
    }

    /** Shows the dashboard's Listener on the timeline, if the dashboard is showing. */
    const showCurrent = () => {
        const listener = currentListener();
        if (listener) timeline.show(listener);
    };

    /** Points the timeline at the screen's Listener: their tables on a dashboard, none elsewhere. */
    const followScreen = () => {
        const listener = currentListener();
        if (listener) timeline.show(listener);
        else timeline.clear();
    };

    /** Reads the Listeners back from storage; only the latest read is kept. */
    async function reload(): Promise<void> {
        const read = ++reads.latest;
        const stored = await db.listeners();
        if (read === reads.latest) store.setState({ listeners: byRecentView(stored) });
    }

    /** Applies a change to a stored row, dropping any read started before it as stale. */
    const dispatchRow = (event: SessionEvent): boolean => {
        reads.latest++;
        return dispatch(event);
    };

    /**
     * `action`, reporting a failure as `what` and reading the Listeners back rather than rejecting,
     * since the UI calls it without awaiting.
     */
    const guarded =
        <Args extends unknown[]>(what: string, action: (...args: Args) => Promise<void>) =>
        (...args: Args): Promise<void> =>
            action(...args).catch(async (error: unknown) => {
                failures.report(what, error);
                await reload().catch((reloadError: unknown) =>
                    failures.report("Couldn't read the Listeners", reloadError),
                );
            });

    const storedListener = (id: ListenerId) =>
        store.getState().listeners.find((listener) => listener.id === id);

    const unsettledJobOf = (id: ListenerId) =>
        ingest.store.getState().queue.findLast((job) => job.listenerId === id && !isSettled(job));

    /** A new Listener's import under way before their row is listed, other than `id`'s. */
    const queuedImportBesides = (id?: ListenerId) =>
        ingest.store
            .getState()
            .queue.findLast(
                (job) =>
                    job.kind === "import" &&
                    job.listenerId !== id &&
                    !isSettled(job) &&
                    !storedListener(job.listenerId),
            );

    /** Whether `id` is already a Listener's: finished, or with an import or Sync under way. */
    const isTaken = (id: ListenerId): boolean =>
        storedListener(id)?.importComplete === true || unsettledJobOf(id) !== undefined;

    /** Views a stored Listener, or one whose import is queued, remembering when they were viewed. */
    async function open(id: ListenerId): Promise<void> {
        // Read afresh: an import may have finished since the list was last read.
        const stored = await db.listener(id);
        if (!stored) {
            const queued = unsettledJobOf(id);
            if (!queued) return;
            dispatch({ type: "queuedOpened", listenerId: id, username: queued.username });
            followScreen();
            return;
        }
        const listener = { ...stored, lastViewedAt: now() };
        dispatchRow({ type: "opened", listener });
        followScreen();
        await db.updateListener(id, { lastViewedAt: listener.lastViewedAt });
        await reload();
    }

    /** Stores the dashboard Listener's Pinned Artists as `change` leaves them; the tables stay as they are. */
    async function changePins(change: (pins: readonly string[]) => string[]): Promise<void> {
        const listener = currentListener();
        if (!listener) return;
        const pinnedArtists = change(listener.pinnedArtists);
        dispatchRow({ type: "listenerChanged", listener: { ...listener, pinnedArtists } });
        await db.updateListener(listener.id, { pinnedArtists });
        await reload();
    }

    const onJobSettled = guarded("Couldn't read the finished job's Listener", async (job: Job) => {
        const listener = job.status === "done" ? await db.listener(job.listenerId) : undefined;
        // A Sync's new tables are already being built from its `scrobblesChanged`.
        if (job.kind === "sync") {
            if (listener) dispatch({ type: "listenerChanged", listener });
        } else if (dispatch({ type: "jobSettled", job, listener })) showCurrent();
        await reload();
    });
    const stopListening = events.on("jobSettled", ({ job }) => void onJobSettled(job));
    const stopFollowingTables = timeline.store.subscribe(({ tables }, previous) => {
        if (tables && tables !== previous.tables) dispatch({ type: "tablesSwapped", tables });
    });

    if (initial?.importComplete) timeline.show(initial);
    byRecentView(listeners)
        .filter((listener) => !listener.importComplete)
        .forEach(resume);

    return {
        store,
        /** The timezone the setup form starts on. */
        defaultTimeZone,

        /** Refuses a taken username, else probes it and queues the import, which runs in the background. */
        addListener: guarded(
            "Couldn't add the Listener",
            async function addListener({
                username: typed,
                apiKey,
                timeZone,
            }: ImportRequest): Promise<void> {
                const id = listenerId(typed);
                if (isTaken(id)) {
                    dispatch({ type: "taken", username: typed });
                    return;
                }
                // An unfinished Listener added again keeps the name they were first added under.
                const known = storedListener(id);
                const username = known?.username ?? typed;
                if (!dispatch({ type: "submitted" })) return;
                const result = await ingest.probe(username, apiKey);
                dispatch({ type: "probed", username, result });
                if (store.getState().screen.kind !== "importing") return;
                settings.update({ apiKey });
                followScreen();
                void ingest.enqueueImport({ username, apiKey, timeZone });
                if (known) {
                    await db.updateListener(id, { lastViewedAt: now() });
                    await reload();
                }
            },
        ),

        open: guarded("Couldn't open the Listener", open),

        /** Shows setup to add another Listener. */
        startAdding: (): void => void dispatch({ type: "addingStarted" }),

        /** Leaves setup for the Listener viewed most recently. */
        cancelAdding: guarded("Couldn't open the Listener", async () => {
            const previous =
                mostRecentlyViewed(store.getState().listeners)?.id ??
                queuedImportBesides()?.listenerId;
            if (previous) await open(previous);
        }),

        /** How many Scrobbles are stored for a Listener, for the removal prompt. */
        scrobbleCount: (id: ListenerId): Promise<number | undefined> =>
            db.countScrobblesOf(id).catch((error: unknown) => {
                failures.report("Couldn't count the Scrobbles", error);
                return undefined;
            }),

        /** Removes a Listener's jobs and Scrobbles; if in view, opens the next most recently viewed. */
        removeListener: guarded("Couldn't remove the Listener", async (id: ListenerId) => {
            const next = mostRecentlyViewed(
                store.getState().listeners.filter((listener) => listener.id !== id),
            );
            const queued = next ? undefined : queuedImportBesides(id);
            // The screen moves on first, so the cancelled import doesn't show as a setup problem.
            if (dispatch({ type: "removed", listenerId: id, next })) {
                if (queued)
                    dispatch({
                        type: "queuedOpened",
                        listenerId: queued.listenerId,
                        username: queued.username,
                    });
                followScreen();
            }
            await ingest.removeListener(id);
            await reload();
        }),

        resumeImport: guarded("Couldn't resume the import", resumeImport),

        /** Probes a new API key against the current Listener, saving it and resuming their import only if last.fm takes it. */
        changeApiKey: guarded("Couldn't change the API key", async (apiKey: string) => {
            const username = currentUsername();
            if (!username || !dispatch({ type: "keySubmitted", apiKey })) return;
            const result = await ingest.probe(username, apiKey);
            dispatch({ type: "keyProbed", apiKey, result });
            if (store.getState().apiKeyCheck.kind !== "saved") return;
            settings.update({ apiKey });
            await resumeImport();
        }),

        /** Queues a Sync of the dashboard's Listener with the stored API key. */
        sync(): void {
            const listener = currentListener();
            if (!listener) return;
            void ingest.enqueueSync({
                username: listener.username,
                apiKey: settings.store.getState().apiKey,
            });
        },

        /** Pins an Artist, by name, for the dashboard's Listener. */
        pin: guarded("Couldn't pin the Artist", (artist: string) =>
            changePins((pins) => withPin(pins, artist)),
        ),

        /** Unpins an Artist, by name, for the dashboard's Listener. */
        unpin: guarded("Couldn't unpin the Artist", (artist: string) =>
            changePins((pins) => withoutPin(pins, artist)),
        ),

        /** Moves the current Listener's Days to `timeZone`, rebuilding the tables from what is stored. */
        changeTimeZone: guarded("Couldn't change the timezone", async (timeZone: string) => {
            const listener = currentListener();
            if (!listener || listener.timeZone === timeZone) return;
            await db.updateListener(listener.id, { timeZone });
            if (dispatchRow({ type: "listenerChanged", listener: { ...listener, timeZone } }))
                showCurrent();
            await reload();
        }),

        /** Opens the Spotlight on an Artist, by name, in place of any Spotlit Artist before. */
        spotlight: (artist: string): void => void dispatch({ type: "spotlit", artist }),

        /** Closes the Spotlight, leaving the window and playhead as they are. */
        closeSpotlight: (): void => void dispatch({ type: "spotlightClosed" }),

        /** Stops reacting to settled jobs and swapped tables. */
        dispose: () => {
            stopListening();
            stopFollowingTables();
        },
    };
}

export type Session = ReturnType<typeof createSession>;
