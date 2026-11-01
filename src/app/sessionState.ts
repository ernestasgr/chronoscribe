import { listenerId, type ListenerId, type ListenerRow } from "../db";
import type { Job, ProbeProblem, ProbeResult } from "../ingest";
import { artistNamed, type StandingsTables } from "../standings";

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
    /** The Spotlit Artist is navigation state: named here while the Spotlight is open, never stored. */
    | { kind: "dashboard"; listenerId: ListenerId; spotlit: string | undefined };

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
    | { type: "keyProbed"; apiKey: string; result: ProbeResult }
    | { type: "spotlit"; artist: string }
    | { type: "spotlightClosed" }
    /** The timeline swapped in new tables for the viewed Listener. */
    | { type: "tablesSwapped"; tables: StandingsTables };

export const setupScreen = (status: SetupStatus): Screen => ({ kind: "setup", status });

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
export const withPin = (pins: readonly string[], artist: string): string[] =>
    pins.includes(artist) ? [...pins] : [...pins, artist];

/** The Pinned Artists without `artist`. */
export const withoutPin = (pins: readonly string[], artist: string): string[] =>
    pins.filter((pinned) => pinned !== artist);

export const byRecentView = (listeners: readonly ListenerRow[]): ListenerRow[] =>
    listeners.toSorted((a, b) => b.lastViewedAt - a.lastViewedAt);

/** A Listener's dashboard, opening with the Spotlight closed. */
const dashboardOf = (id: ListenerId): Screen => ({
    kind: "dashboard",
    listenerId: id,
    spotlit: undefined,
});

/** The dashboard with the Spotlight on `spotlit`, or closed; any other screen is left as it is. */
const withSpotlit = (screen: Screen, spotlit: string | undefined): Screen =>
    screen.kind === "dashboard" && screen.spotlit !== spotlit ? { ...screen, spotlit } : screen;

/** Whether the dashboard's Spotlit Artist is gone from `tables`, as an unresolved pin is. */
const spotlitGone = (screen: Screen, tables: StandingsTables): boolean =>
    screen.kind === "dashboard" &&
    screen.spotlit !== undefined &&
    artistNamed(tables, screen.spotlit) === undefined;

/** A Listener's dashboard once their import has finished, their import's screen until then. */
export const screenOf = (listener: ListenerRow): Screen =>
    listener.importComplete
        ? dashboardOf(listener.id)
        : { kind: "importing", listenerId: listener.id, username: listener.username };

/** The Listener a screen is showing, if any. */
const listenerOn = (screen: Screen): ListenerId | undefined =>
    screen.kind === "setup" ? undefined : screen.listenerId;

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
                ? dashboardOf(listener.id)
                : setupScreen({
                      kind: "rejected",
                      problem: unfinished(job),
                      username: job.username,
                  });
        }
        case "spotlit":
            return withSpotlit(screen, event.artist);
        case "spotlightClosed":
            return withSpotlit(screen, undefined);
        case "tablesSwapped":
            return spotlitGone(screen, event.tables) ? withSpotlit(screen, undefined) : screen;
        case "listenerChanged":
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

/** The Listeners with `listener`'s row in place of the stored one, or added if new. */
const upserted = (listeners: readonly ListenerRow[], listener: ListenerRow): ListenerRow[] =>
    byRecentView([...listeners.filter(({ id }) => id !== listener.id), listener]);

/**
 * The rows the events carry, as fresh as storage: they are written before they are dispatched. A
 * removed Listener stays listed until their deletion is read back, so the list never runs ahead
 * of what a reload would show.
 */
const listenersAfter = (
    listeners: readonly ListenerRow[],
    event: SessionEvent,
): readonly ListenerRow[] => {
    switch (event.type) {
        case "opened":
            return upserted(listeners, event.listener);
        case "jobSettled":
            return event.listener ? upserted(listeners, event.listener) : listeners;
        case "listenerChanged":
            return listeners.some(({ id }) => id === event.listener.id)
                ? upserted(listeners, event.listener)
                : listeners;
        default:
            return listeners;
    }
};

/** The session after `event`; an event the current state doesn't accept leaves it unchanged. */
export function transition(state: SessionState, event: SessionEvent): SessionState {
    const screen = screenAfter(state.screen, event);
    const apiKeyCheck = apiKeyCheckAfter(state.apiKeyCheck, event);
    const listeners = listenersAfter(state.listeners, event);
    return screen === state.screen &&
        apiKeyCheck === state.apiKeyCheck &&
        listeners === state.listeners
        ? state
        : { screen, apiKeyCheck, listeners };
}

/** The Spotlit Artist's name, while the dashboard's Spotlight is open. */
export const spotlitArtist = ({ screen }: SessionState): string | undefined =>
    screen.kind === "dashboard" ? screen.spotlit : undefined;

/** The Listener the dashboard shows, looked up among the stored ones. */
export const viewedListener = ({ screen, listeners }: SessionState): ListenerRow | undefined =>
    screen.kind === "dashboard" ? listeners.find(({ id }) => id === screen.listenerId) : undefined;
