import { createStore, type StoreApi } from "zustand";
import { listenerId, type Db } from "../db";
import type { Emitter } from "../events";
import { getRecentTracks, type Fetch, type LastfmFailure } from "../lastfm";

const PAGE_LIMIT = 1000;
/** At most 4 last.fm requests per second, app-wide. */
const MIN_REQUEST_GAP_MS = 250;
/** How many recent page times the ETA averages. */
const ETA_WINDOW = 5;

export interface Transport {
    fetch: Fetch;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
}

export const browserTransport: Transport = {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobProgress {
    fetched: number;
    total: number;
}

export interface Job {
    id: number;
    kind: "import";
    listenerId: string;
    username: string;
    status: JobStatus;
    progress?: JobProgress;
    /** Milliseconds left, from a moving average of recent page times. */
    etaMs?: number;
    error?: LastfmFailure;
}

export interface IngestState {
    queue: Job[];
}

export interface IngestEvents {
    /** Ingest has committed a change to a Listener's Scrobbles. */
    scrobblesChanged: { listenerId: string };
    /** A job has finished, failed or been cancelled. */
    jobSettled: { job: Job };
}

export interface ImportRequest {
    username: string;
    apiKey: string;
    timeZone: string;
}

export const isSettled = ({ status }: Job): boolean =>
    status === "done" || status === "failed" || status === "cancelled";

const average = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

/** The ETA after a page: the mean of the last few page times, once per page still to fetch. */
export const etaMs = (pageTimes: readonly number[], pagesLeft: number): number =>
    Math.round(average(pageTimes.slice(-ETA_WINDOW)) * Math.max(pagesLeft, 0));

const withJob = (queue: readonly Job[], id: number, changes: Partial<Job>): Job[] =>
    queue.map((job) => (job.id === id ? { ...job, ...changes } : job));

/** Resolves when the caller may send its request: each caller waits its turn, `gapMs` apart. */
function createThrottle({ now, sleep }: Transport, gapMs: number): () => Promise<void> {
    const state = { lastAt: -Infinity, turn: Promise.resolve() };
    return () =>
        (state.turn = state.turn.then(async () => {
            const wait = state.lastAt + gapMs - now();
            if (wait > 0) await sleep(wait);
            state.lastAt = now();
        }));
}

export interface IngestDeps {
    db: Db;
    events: Emitter<IngestEvents>;
    transport?: Transport;
}

/**
 * The app-wide fetch queue. Jobs run one at a time across every Listener; their state is
 * published to `store` as `queue`, and every committed change is emitted as `scrobblesChanged`.
 */
export function createIngest({ db, events, transport = browserTransport }: IngestDeps) {
    const store: StoreApi<IngestState> = createStore<IngestState>(() => ({ queue: [] }));
    const throttle = createThrottle(transport, MIN_REQUEST_GAP_MS);
    const controllers = new Map<number, AbortController>();
    const runs = { tail: Promise.resolve(), nextId: 1 };

    const patch = (id: number, changes: Partial<Job>) =>
        store.setState(({ queue }) => ({ queue: withJob(queue, id, changes) }));
    const jobOf = (id: number) => store.getState().queue.find((job) => job.id === id)!;

    /**
     * Adds a Listener and imports their whole Scrobble history, newest first, up to a `to`
     * fixed when the job starts. Resolves to the job's outcome; never rejects.
     */
    async function runImport(
        id: number,
        { username, apiKey, timeZone }: ImportRequest,
        signal: AbortSignal,
    ): Promise<Partial<Job>> {
        const listener = listenerId(username);
        const importTo = Math.floor(transport.now() / 1000);
        // Until imports can resume, a restarted import begins again from nothing.
        await db.deleteScrobblesOf(listener);
        await db.putListener({
            id: listener,
            username,
            timeZone,
            pinnedArtists: [],
            importTo,
            importComplete: false,
            lastViewedAt: transport.now(),
        });

        const pageTimes: number[] = [];
        for (let page = 1; ; page++) {
            const startedAt = transport.now();
            await throttle();
            if (signal.aborted) return { status: "cancelled" };
            const result = await getRecentTracks(
                { user: username, apiKey, page, limit: PAGE_LIMIT, to: importTo, signal },
                transport.fetch,
            );
            if (!result.ok)
                return result.error.kind === "Aborted"
                    ? { status: "cancelled" }
                    : { status: "failed", error: result.error };

            const { scrobbles, total, totalPages } = result.value;
            await db.addScrobbles(
                scrobbles.map((scrobble) => ({ listenerId: listener, ...scrobble })),
            );
            pageTimes.push(transport.now() - startedAt);
            const fetched = (jobOf(id).progress?.fetched ?? 0) + scrobbles.length;
            patch(id, { progress: { fetched, total }, etaMs: etaMs(pageTimes, totalPages - page) });
            if (scrobbles.length === 0 || page >= totalPages) break;
        }
        await db.updateListener(listener, { importComplete: true });
        // One event for the whole import: its history is only shown once it is complete.
        events.emit("scrobblesChanged", { listenerId: listener });
        return { status: "done", etaMs: 0 };
    }

    /** Queues an Import job; resolves to the job once it has settled. */
    function enqueueImport(request: ImportRequest): Promise<Job> {
        const id = runs.nextId++;
        const controller = new AbortController();
        controllers.set(id, controller);
        store.setState(({ queue }) => ({
            queue: [
                ...queue,
                {
                    id,
                    kind: "import",
                    listenerId: listenerId(request.username),
                    username: request.username,
                    status: "queued",
                },
            ],
        }));

        runs.tail = runs.tail.then(() => run(id, request, controller.signal));
        return runs.tail.then(() => {
            controllers.delete(id);
            events.emit("jobSettled", { job: jobOf(id) });
            return jobOf(id);
        });
    }

    async function run(id: number, request: ImportRequest, signal: AbortSignal): Promise<void> {
        if (signal.aborted) return patch(id, { status: "cancelled" });
        patch(id, { status: "running" });
        const outcome = await runImport(id, request, signal).catch(
            (error: unknown): Partial<Job> => ({
                status: "failed",
                error: { kind: "Transient", message: String(error) },
            }),
        );
        patch(id, outcome);
    }

    /** Cancels a Listener's queued jobs and aborts their running one. */
    function cancel(listener: string): void {
        store
            .getState()
            .queue.filter((job) => job.listenerId === listener && !isSettled(job))
            .forEach((job) => controllers.get(job.id)?.abort());
    }

    return { store, enqueueImport, cancel };
}

export type Ingest = ReturnType<typeof createIngest>;
