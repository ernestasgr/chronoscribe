import { createStore, type StoreApi } from "zustand";
import { listenerId, mostRecentlyViewed, type Db, type ListenerId, type ListenerRow } from "../db";
import type { Subscriber } from "../events";
import {
    isSettled,
    type ImportRequest,
    type Ingest,
    type IngestEvents,
    type Job,
    type ProbeProblem,
    type ProbeResult,
} from "../ingest";
import type { Timeline } from "../timeline";
import type { Failures } from "./failures";
import type { Settings } from "./settings";

/** Why setup shows a message: a taken username, a probe that turned it down, or an unfinished import. */
export type SetupProblem =
    | { kind: "ListenerTaken" }
    | ProbeProblem
    | { kind: "ImportFailed"; message: string }
    | { kind: "ImportCancelled" };

/** Where the setup form is: being filled in, being checked by the probe, or turned down. */
export type SetupStatus =
    | { kind: "editing" }
    | { kind: "checking" }
    | { kind: "rejected"; problem: SetupProblem; username: string };

/** Where a new API key from Settings is: untouched, being probed, turned down or saved. */
export type ApiKeyCheck =
    | { kind: "idle" }
    | { kind: "checking"; apiKey: string }
    | { kind: "rejected"; apiKey: string; problem: ProbeProblem }
    | { kind: "saved"; apiKey: string };

export type Screen =
    | { kind: "setup"; status: SetupStatus }
    | { kind: "importing"; listenerId: ListenerId; username: string }
    | { kind: "dashboard"; listener: ListenerRow };

export interface SessionState {
    screen: Screen;
    apiKeyCheck: ApiKeyCheck;
    /** Every stored Listener, most recently viewed first. */
    listeners: readonly ListenerRow[];
}

/** Everything that moves the session along, from the user or from settled work. */
export type SessionEvent =
    | { type: "submitted" }
    | { type: "taken"; username: string }
    | { type: "probed"; username: string; result: ProbeResult }
    | { type: "addingStarted" }
    | { type: "opened"; listener: ListenerRow }
    /** A Listener whose import is queued but whose row isn't stored yet. */
    | { type: "queuedOpened"; listenerId: ListenerId; username: string }
    | { type: "removed"; listenerId: ListenerId; next: ListenerRow | undefined }
    | { type: "jobSettled"; job: Job; listener: ListenerRow | undefined }
    | { type: "listenerChanged"; listener: ListenerRow }
    | { type: "keySubmitted"; apiKey: string }
    | { type: "keyProbed"; apiKey: string; result: ProbeResult };

const setupScreen = (status: SetupStatus): Screen => ({ kind: "setup", status });

/** Why an import that didn't finish didn't: cancelled is its own outcome, not a failure. */
const unfinished = (job: Job): SetupProblem =>
    job.status === "cancelled"
        ? { kind: "ImportCancelled" }
        : {
              kind: "ImportFailed",
              message: job.status === "failed" ? job.error.message : "Import failed",
          };

/**
 * Whether a probe problem keeps a new key from being saved. A missing or private Listener still
 * means last.fm took the key, so only a refused key or no answer at all does.
 */
const refusesKey = ({ kind }: ProbeProblem): boolean =>
    kind === "InvalidKey" || kind === "Unavailable";

/** The Pinned Artists with `artist` added at the end, unless already pinned. */
const withPin = (pins: readonly string[], artist: string): string[] =>
    pins.includes(artist) ? [...pins] : [...pins, artist];

/** The Pinned Artists without `artist`. */
const withoutPin = (pins: readonly string[], artist: string): string[] =>
    pins.filter((pinned) => pinned !== artist);

const byRecentView = (listeners: readonly ListenerRow[]): ListenerRow[] =>
    listeners.toSorted((a, b) => b.lastViewedAt - a.lastViewedAt);

/** A Listener's dashboard once their import has finished, their import's screen until then. */
const screenOf = (listener: ListenerRow): Screen =>
    listener.importComplete
        ? { kind: "dashboard", listener }
        : { kind: "importing", listenerId: listener.id, username: listener.username };

/** The Listener a screen is showing, if any. */
const listenerOn = (screen: Screen): ListenerId | undefined => {
    if (screen.kind === "dashboard") return screen.listener.id;
    return screen.kind === "importing" ? screen.listenerId : undefined;
};

/** Whether setup's form can be sent: it isn't already being checked. */
const editable = (screen: Screen): boolean =>
    screen.kind === "setup" && screen.status.kind !== "checking";

const screenAfter = (screen: Screen, event: SessionEvent): Screen => {
    switch (event.type) {
        case "submitted":
            return editable(screen) ? setupScreen({ kind: "checking" }) : screen;
        case "taken":
            return editable(screen)
                ? setupScreen({
                      kind: "rejected",
                      problem: { kind: "ListenerTaken" },
                      username: event.username,
                  })
                : screen;
        case "addingStarted":
            return screen.kind === "setup" ? screen : setupScreen({ kind: "editing" });
        case "opened":
            return screenOf(event.listener);
        case "queuedOpened":
            return { kind: "importing", listenerId: event.listenerId, username: event.username };
        case "removed":
            if (listenerOn(screen) !== event.listenerId) return screen;
            return event.next ? screenOf(event.next) : setupScreen({ kind: "editing" });
        case "probed":
            if (screen.kind !== "setup" || screen.status.kind !== "checking") return screen;
            return event.result.ok
                ? {
                      kind: "importing",
                      listenerId: listenerId(event.username),
                      username: event.username,
                  }
                : setupScreen({
                      kind: "rejected",
                      problem: event.result.problem,
                      username: event.username,
                  });
        case "jobSettled": {
            const { job, listener } = event;
            if (screen.kind !== "importing" || screen.listenerId !== job.listenerId) return screen;
            // A paused import stays behind its screen, which offers to resume it.
            if (job.status === "paused") return screen;
            return job.status === "done" && listener
                ? { kind: "dashboard", listener }
                : setupScreen({
                      kind: "rejected",
                      problem: unfinished(job),
                      username: job.username,
                  });
        }
        case "listenerChanged":
            return screen.kind === "dashboard" && screen.listener.id === event.listener.id
                ? { kind: "dashboard", listener: event.listener }
                : screen;
        case "keySubmitted":
        case "keyProbed":
            return screen;
    }
};

const apiKeyCheckAfter = (check: ApiKeyCheck, event: SessionEvent): ApiKeyCheck => {
    switch (event.type) {
        case "keySubmitted":
            return check.kind === "checking" ? check : { kind: "checking", apiKey: event.apiKey };
        case "keyProbed":
            if (check.kind !== "checking" || check.apiKey !== event.apiKey) return check;
            return event.result.ok || !refusesKey(event.result.problem)
                ? { kind: "saved", apiKey: event.apiKey }
                : { kind: "rejected", apiKey: event.apiKey, problem: event.result.problem };
        default:
            return check;
    }
};

/** The session after `event`; an event the current state doesn't accept leaves it unchanged. */
export function transition(state: SessionState, event: SessionEvent): SessionState {
    const screen = screenAfter(state.screen, event);
    const apiKeyCheck = apiKeyCheckAfter(state.apiKeyCheck, event);
    return screen === state.screen && apiKeyCheck === state.apiKeyCheck
        ? state
        : { ...state, screen, apiKeyCheck };
}

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

    const currentListener = (): ListenerRow | undefined => {
        const { screen } = store.getState();
        return screen.kind === "dashboard" ? screen.listener : undefined;
    };

    /** The username Settings checks a new API key against: the dashboard's or the import's. */
    const currentUsername = (): string | undefined => {
        const { screen } = store.getState();
        if (screen.kind === "dashboard") return screen.listener.username;
        return screen.kind === "importing" ? screen.username : undefined;
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
        const { screen } = store.getState();
        if (screen.kind === "dashboard") timeline.show(screen.listener);
        else timeline.clear();
    };

    /** Reads the Listeners back from storage; only the latest read is kept. */
    async function reload(): Promise<void> {
        const read = ++reads.latest;
        const stored = await db.listeners();
        if (read === reads.latest) store.setState({ listeners: byRecentView(stored) });
    }

    /** Reads the Listeners back after a failure, so the screen shows what is stored. */
    async function resync(): Promise<void> {
        await reload();
        const listener = currentListener();
        const stored = listener && storedListener(listener.id);
        if (stored) dispatch({ type: "listenerChanged", listener: stored });
    }

    /**
     * `action`, reporting a failure as `what` and resyncing with storage rather than rejecting,
     * since the UI calls it without awaiting.
     */
    const guarded =
        <Args extends unknown[]>(what: string, action: (...args: Args) => Promise<void>) =>
        (...args: Args): Promise<void> =>
            action(...args).catch(async (error: unknown) => {
                failures.report(what, error);
                await resync().catch((resyncError: unknown) =>
                    failures.report("Couldn't read the Listeners", resyncError),
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
        dispatch({ type: "opened", listener });
        followScreen();
        await db.updateListener(id, { lastViewedAt: listener.lastViewedAt });
        await reload();
    }

    /** Stores the dashboard Listener's Pinned Artists as `change` leaves them; the tables stay as they are. */
    async function changePins(change: (pins: readonly string[]) => string[]): Promise<void> {
        const listener = currentListener();
        if (!listener) return;
        const pinnedArtists = change(listener.pinnedArtists);
        dispatch({ type: "listenerChanged", listener: { ...listener, pinnedArtists } });
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
            if (dispatch({ type: "listenerChanged", listener: { ...listener, timeZone } }))
                showCurrent();
            await reload();
        }),

        /** Stops reacting to settled jobs. */
        dispose: stopListening,
    };
}

export type Session = ReturnType<typeof createSession>;
