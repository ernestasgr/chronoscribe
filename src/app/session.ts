import { createStore, type StoreApi } from "zustand";
import { listenerId, mostRecentlyViewed, type Db, type ListenerId, type ListenerRow } from "../db";
import type { Subscriber } from "../events";
import type {
    ImportRequest,
    Ingest,
    IngestEvents,
    Job,
    ProbeProblem,
    ProbeResult,
} from "../ingest";
import type { Timeline } from "../timeline";
import type { Settings } from "./settings";

/** Why setup is showing a message: the probe turned the inputs down, or the import didn't finish. */
export type SetupProblem =
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
}

/** Everything that moves the session along, from the user or from settled work. */
export type SessionEvent =
    | { type: "submitted" }
    | { type: "probed"; username: string; result: ProbeResult }
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

/** Listeners whose import never finished, most recently viewed first. */
const unfinishedImports = (listeners: readonly ListenerRow[]): ListenerRow[] =>
    listeners
        .filter((listener) => !listener.importComplete)
        .toSorted((a, b) => b.lastViewedAt - a.lastViewedAt);

/** The dashboard of a finished Listener, else the import of an unfinished one, else setup. */
const openingScreen = (
    finished: ListenerRow | undefined,
    resumable: ListenerRow | undefined,
): Screen => {
    if (finished) return { kind: "dashboard", listener: finished };
    return resumable
        ? { kind: "importing", listenerId: resumable.id, username: resumable.username }
        : setupScreen({ kind: "editing" });
};

const screenAfter = (screen: Screen, event: SessionEvent): Screen => {
    switch (event.type) {
        case "submitted":
            return screen.kind === "setup" && screen.status.kind !== "checking"
                ? setupScreen({ kind: "checking" })
                : screen;
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
        : { screen, apiKeyCheck };
}

export interface SessionDeps {
    db: Db;
    events: Subscriber<IngestEvents>;
    ingest: Ingest;
    timeline: Timeline;
    settings: Settings;
    /** Every stored Listener: the app opens on the most recently viewed, resuming unfinished imports. */
    listeners: readonly ListenerRow[];
    /** The browser's timezone, offered for new Listeners. */
    defaultTimeZone: string;
}

/** Which screen shows, moving from setup through the probe and import to the dashboard. */
export function createSession({
    db,
    events,
    ingest,
    timeline,
    settings,
    listeners,
    defaultTimeZone,
}: SessionDeps) {
    const initial = mostRecentlyViewed(listeners);
    const resumable = unfinishedImports(listeners);
    const store: StoreApi<SessionState> = createStore<SessionState>(() => ({
        screen: openingScreen(initial, resumable[0]),
        apiKeyCheck: { kind: "idle" },
    }));

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

    events.on("jobSettled", async ({ job }) => {
        const listener = job.status === "done" ? await db.listener(job.listenerId) : undefined;
        if (dispatch({ type: "jobSettled", job, listener })) showCurrent();
    });

    if (initial) timeline.show(initial);
    resumable.forEach(resume);

    return {
        store,
        /** The timezone the setup form starts on. */
        defaultTimeZone,

        /** Probes the inputs, then saves the API key and queues the new Listener's import. */
        async addListener({ username, apiKey, timeZone }: ImportRequest): Promise<void> {
            if (!dispatch({ type: "submitted" })) return;
            const result = await ingest.probe(username, apiKey);
            dispatch({ type: "probed", username, result });
            if (store.getState().screen.kind !== "importing") return;
            settings.update({ apiKey });
            void ingest.enqueueImport({ username, apiKey, timeZone });
        },

        resumeImport,

        /** Probes a new API key against the current Listener, saving it and resuming their import only if last.fm takes it. */
        async changeApiKey(apiKey: string): Promise<void> {
            const username = currentUsername();
            if (!username || !dispatch({ type: "keySubmitted", apiKey })) return;
            const result = await ingest.probe(username, apiKey);
            dispatch({ type: "keyProbed", apiKey, result });
            if (store.getState().apiKeyCheck.kind !== "saved") return;
            settings.update({ apiKey });
            await resumeImport();
        },

        /** Moves the current Listener's Days to `timeZone`, rebuilding the tables from what is stored. */
        async changeTimeZone(timeZone: string): Promise<void> {
            const listener = currentListener();
            if (!listener || listener.timeZone === timeZone) return;
            await db.updateListener(listener.id, { timeZone });
            if (dispatch({ type: "listenerChanged", listener: { ...listener, timeZone } }))
                showCurrent();
        },
    };
}

export type Session = ReturnType<typeof createSession>;
