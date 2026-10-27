import { createStore, type StoreApi } from "zustand";
import { listenerId, type Db, type ListenerRow } from "../db";
import type { Subscriber } from "../events";
import type { Ingest, IngestEvents, Job } from "../ingest";
import type { Timeline } from "../timeline";
import type { Settings } from "./settings";

export type Screen =
    | { kind: "setup"; error?: string }
    | { kind: "importing"; listenerId: string; username: string }
    | { kind: "dashboard"; listener: ListenerRow };

export interface SessionState {
    screen: Screen;
}

export interface SessionDeps {
    db: Db;
    events: Subscriber<IngestEvents>;
    ingest: Ingest;
    timeline: Timeline;
    settings: Settings;
    /** The Listener to open on, if any has finished importing. */
    initial: ListenerRow | undefined;
    timeZone: string;
}

const failureOf = (job: Job): string =>
    job.status === "cancelled" ? "Import cancelled" : (job.error?.message ?? "Import failed");

/** Which screen shows, moving from setup through import to the dashboard as jobs settle. */
export function createSession({
    db,
    events,
    ingest,
    timeline,
    settings,
    initial,
    timeZone,
}: SessionDeps) {
    const store: StoreApi<SessionState> = createStore<SessionState>(() => ({
        screen: initial ? { kind: "dashboard", listener: initial } : { kind: "setup" },
    }));

    function open(listener: ListenerRow): void {
        store.setState({ screen: { kind: "dashboard", listener } });
        timeline.show(listener);
    }

    const importingOf = (id: string) => {
        const { screen } = store.getState();
        return screen.kind === "importing" && screen.listenerId === id;
    };

    events.on("jobSettled", async ({ job }) => {
        if (!importingOf(job.listenerId)) return;
        const listener = job.status === "done" ? await db.listener(job.listenerId) : undefined;
        if (listener) open(listener);
        else store.setState({ screen: { kind: "setup", error: failureOf(job) } });
    });

    if (initial) timeline.show(initial);

    return {
        store,
        /** Saves the API key and queues the new Listener's import, showing its progress. */
        addListener(username: string, apiKey: string): void {
            settings.update({ apiKey });
            store.setState({
                screen: { kind: "importing", listenerId: listenerId(username), username },
            });
            void ingest.enqueueImport({ username, apiKey, timeZone });
        },
    };
}

export type Session = ReturnType<typeof createSession>;
