import { createStore, type StoreApi } from "zustand";
import { listenerId, type Db, type ListenerId } from "../db";
import type { Emitter } from "../events";
import { getRecentTracks } from "../lastfm";
import { createImportJob, type ImportRequest } from "./importJob";
import {
    isSettled,
    JOB_KINDS,
    transition,
    type IngestEvents,
    type Job,
    type JobEvent,
    type JobKind,
    type Outcome,
} from "./job";
import { browserTransport, createFetchPage, createThrottle, type Transport } from "./pages";
import { problemOf, type ProbeResult } from "./probe";
import { createSyncJob, type SyncRequest } from "./syncJob";

export type { ImportRequest } from "./importJob";
export {
    etaMs,
    isSettled,
    transition,
    type IngestEvents,
    type Job,
    type JobEvent,
    type JobKind,
    type JobProgress,
    type JobState,
    type JobStatus,
    type Outcome,
    type Retry,
} from "./job";
export { backoffMs, browserTransport, MAX_FAILURES, type Transport } from "./pages";
export { problemOf, type ProbeProblem, type ProbeResult } from "./probe";
export type { SyncRequest } from "./syncJob";

/** At most 4 last.fm requests per second, app-wide. */
const MIN_REQUEST_GAP_MS = 250;

export interface IngestState {
    queue: Job[];
}

/** Which unsettled job a new request joins: one per Listener and kind. */
const unsettledKey = (kind: JobKind, listener: ListenerId) => `${kind} ${listener}`;

const withEvent = (queue: readonly Job[], id: number, event: JobEvent): Job[] =>
    queue.map((job) => (job.id === id ? transition(job, event) : job));

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
    /** Each Listener's job of each kind that hasn't settled, which a new request for them joins. */
    const unsettled = new Map<string, Promise<Job>>();

    const dispatch = (id: number, event: JobEvent) =>
        store.setState(({ queue }) => ({ queue: withEvent(queue, id, event) }));
    /** A queued job; jobs are never removed from the queue, so one missing is a bug. */
    const jobOf = (id: number): Job => {
        const job = store.getState().queue.find((queued) => queued.id === id);
        if (!job) throw new Error(`Job ${id} is not in the queue`);
        return job;
    };

    const fetchPage = createFetchPage({ transport, throttle, dispatch });
    const runImport = createImportJob({ db, events, transport, fetchPage, dispatch });
    const runSync = createSyncJob({ db, events, transport, fetchPage, dispatch });

    /** Queues a job, or joins the Listener's unsettled one of the same kind; resolves to it once settled. */
    function enqueue(
        kind: JobKind,
        username: string,
        work: (id: number, signal: AbortSignal) => Promise<Outcome>,
    ): Promise<Job> {
        const listener = listenerId(username);
        const key = unsettledKey(kind, listener);
        const joined = unsettled.get(key);
        if (joined) return joined;
        const id = runs.nextId++;
        const controller = new AbortController();
        controllers.set(id, controller);
        store.setState(({ queue }) => ({
            queue: [
                ...queue,
                {
                    id,
                    kind,
                    listenerId: listener,
                    username,
                    progress: { kind: "uncounted" },
                    status: "queued",
                },
            ],
        }));

        // A job cancelled while queued settles at once, without waiting for its turn.
        const finished = new Promise<void>((resolve) => {
            controller.signal.addEventListener(
                "abort",
                () => {
                    if (jobOf(id).status !== "queued") return;
                    dispatch(id, { type: "settled", outcome: { status: "cancelled" } });
                    resolve();
                },
                { once: true },
            );
            runs.tail = runs.tail.then(() => run(id, work, controller.signal)).then(resolve);
        });
        const settled = finished.then(() => {
            controllers.delete(id);
            unsettled.delete(key);
            events.emit("jobSettled", { job: jobOf(id) });
            return jobOf(id);
        });
        unsettled.set(key, settled);
        return settled;
    }

    async function run(
        id: number,
        work: (id: number, signal: AbortSignal) => Promise<Outcome>,
        signal: AbortSignal,
    ): Promise<void> {
        if (isSettled(jobOf(id))) return;
        dispatch(id, { type: "started" });
        const outcome = await work(id, signal).catch((error: unknown): Outcome => ({
            status: "failed",
            error: { kind: "Transient", message: String(error) },
        }));
        dispatch(id, { type: "settled", outcome });
    }

    /** Queues an Import job, or joins the Listener's unsettled one; resolves to it once settled. */
    const enqueueImport = (request: ImportRequest): Promise<Job> => {
        const queuedAt = transport.now();
        return enqueue("import", request.username, (id, signal) =>
            runImport(id, request, queuedAt, signal),
        );
    };

    /** Queues a Sync of a finished Listener, or joins their unsettled one; resolves to it once settled. */
    const enqueueSync = (request: SyncRequest): Promise<Job> =>
        enqueue("sync", request.username, (id, signal) => runSync(id, request, signal));

    /** Cancels a Listener's queued jobs and aborts their running one. */
    function cancel(listener: ListenerId): void {
        store
            .getState()
            .queue.filter((job) => job.listenerId === listener && !isSettled(job))
            .forEach((job) => controllers.get(job.id)?.abort());
    }

    /** Cancels a Listener's jobs, waits for a running one to stop, then deletes them in one transaction. */
    async function removeListener(listener: ListenerId): Promise<void> {
        const pending = JOB_KINDS.flatMap(
            (kind) => unsettled.get(unsettledKey(kind, listener)) ?? [],
        );
        cancel(listener);
        await Promise.all(pending);
        await db.deleteListener(listener);
    }

    /** Checks a username and API key with one `limit=1` request, in turn with the queue's requests. */
    async function probe(username: string, apiKey: string): Promise<ProbeResult> {
        await throttle();
        const result = await getRecentTracks(
            { user: username, apiKey, page: 1, limit: 1 },
            transport.fetch,
        );
        return result.ok ? { ok: true } : { ok: false, problem: problemOf(result.error) };
    }

    return { store, enqueueImport, enqueueSync, cancel, removeListener, probe };
}

export type Ingest = ReturnType<typeof createIngest>;
