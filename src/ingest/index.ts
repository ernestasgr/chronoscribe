import { createStore, type StoreApi } from "zustand";
import {
    listenerId,
    PAGE_SIZES,
    type Db,
    type ListenerId,
    type ListenerRow,
    type PageSize,
} from "../db";
import type { Emitter } from "../events";
import {
    getRecentTracks,
    unixSeconds,
    unixSecondsAt,
    type Fetch,
    type LastfmFailure,
    type LastfmScrobble,
    type RecentTracksPage,
    type RecentTracksRequest,
    type UnixSeconds,
} from "../lastfm";

/** At most 4 last.fm requests per second, app-wide. */
const MIN_REQUEST_GAP_MS = 250;
/** The page size an import falls back to when last.fm won't serve 1000. */
const SMALL_PAGE = PAGE_SIZES[1];
/** How many recent page times the ETA averages. */
const ETA_WINDOW = 5;
/** How many times in a row one request may fail transiently before the import pauses. */
export const MAX_FAILURES = 5;
/** The wait before the first retry, doubling with each failure after it. */
const FIRST_BACKOFF_MS = 1000;
/** How far back a Sync fetches again, so late and deleted Scrobbles are reconciled. */
const SYNC_WINDOW_SECONDS = 14 * 86_400;

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

/** How far a job has got: nothing counted before its first page, then a count with the time left. */
export type JobProgress =
    | { kind: "uncounted" }
    | {
          kind: "counted";
          fetched: number;
          total: number;
          /** Milliseconds left, from a moving average of recent page times. */
          etaMs: number;
      };

/**
 * How a job settled: `paused` keeps what an import fetched and waits to be resumed; `failed` is a
 * Sync that changed nothing, or a bug.
 */
export type Outcome =
    | { status: "paused"; error: LastfmFailure }
    | { status: "done" }
    | { status: "failed"; error: LastfmFailure }
    | { status: "cancelled" };

/** Where a job is in its lifecycle, each status carrying only what it can have. */
export type JobState =
    | { status: "queued" }
    | { status: "running" }
    | { status: "retrying"; retry: Retry }
    | Outcome;

export type JobStatus = JobState["status"];

/** An Import fetches a whole history; a Sync fetches its recent window again. */
const JOB_KINDS = ["import", "sync"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** Who a job is for and how far it has got, whatever its state. */
interface JobBase {
    id: number;
    kind: JobKind;
    listenerId: ListenerId;
    username: string;
    progress: JobProgress;
}

export type Job = JobBase & JobState;

/** Everything that moves a job along, from its own run. */
export type JobEvent =
    | { type: "started" }
    | { type: "counted"; fetched: number; total: number; etaMs: number }
    | { type: "retrying"; retry: Retry }
    | { type: "settled"; outcome: Outcome };

/** A job without what its state carries, ready for its next state. */
const baseOf = (job: Job): JobBase => ({
    id: job.id,
    kind: job.kind,
    listenerId: job.listenerId,
    username: job.username,
    progress: job.progress,
});

/** The job after `event`; an event the current state doesn't accept leaves it unchanged. */
export function transition(job: Job, event: JobEvent): Job {
    switch (job.status) {
        case "queued":
            if (event.type === "started") return { ...baseOf(job), status: "running" };
            return event.type === "settled" && event.outcome.status === "cancelled"
                ? { ...baseOf(job), ...event.outcome }
                : job;
        case "running":
        case "retrying":
            switch (event.type) {
                case "started":
                    return job;
                case "counted": {
                    const { type: _type, ...counted } = event;
                    return {
                        ...baseOf(job),
                        progress: { kind: "counted", ...counted },
                        status: "running",
                    };
                }
                case "retrying":
                    return { ...baseOf(job), status: "retrying", retry: event.retry };
                case "settled":
                    return { ...baseOf(job), ...event.outcome };
            }
        default:
            return job;
    }
}

/** Transient failures being waited out: `failures` in a row, pausing at `pausesAt`, retrying in `inMs`. */
export interface Retry {
    failures: number;
    pausesAt: number;
    inMs: number;
    error: LastfmFailure;
}

export interface IngestState {
    queue: Job[];
}

export interface IngestEvents {
    /** Ingest has committed a change to a Listener's Scrobbles. */
    scrobblesChanged: { listenerId: ListenerId };
    /** A job has finished, paused, failed or been cancelled. */
    jobSettled: { job: Job };
}

/** A Sync of a Listener whose import has finished. */
export interface SyncRequest {
    username: string;
    apiKey: string;
}

export interface ImportRequest {
    username: string;
    apiKey: string;
    timeZone: string;
}

/** Why the probe turned a username and API key down: no such user, a bad key, a private history, or no answer. */
export type ProbeProblem =
    | { kind: "UnknownUser" }
    | { kind: "InvalidKey" }
    | { kind: "PrivateHistory" }
    | { kind: "Unavailable"; message: string };

/** What the probe found: the username and key work together, or the problem with them. */
export type ProbeResult = { ok: true } | { ok: false; problem: ProbeProblem };

/** The last.fm error codes the probe can name: 6 no such user, 10 bad key, 17 private, 26 suspended key. */
const PROBE_PROBLEMS: Readonly<Record<number, ProbeProblem>> = {
    6: { kind: "UnknownUser" },
    10: { kind: "InvalidKey" },
    17: { kind: "PrivateHistory" },
    26: { kind: "InvalidKey" },
};

/** What a last.fm failure means for the Listener and key it was asked with. */
export const problemOf = ({ code, message }: LastfmFailure): ProbeProblem =>
    (code === undefined ? undefined : PROBE_PROBLEMS[code]) ?? { kind: "Unavailable", message };

const SETTLED: ReadonlySet<JobStatus> = new Set<Outcome["status"]>([
    "paused",
    "done",
    "failed",
    "cancelled",
]);

/** Whether a job has stopped running; a paused import resumes as a new job. */
export const isSettled = ({ status }: Job): boolean => SETTLED.has(status);

const average = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

/** The ETA after a page: the mean of the last few page times, once per page still to fetch. */
export const etaMs = (pageTimes: readonly number[], pagesLeft: number): number =>
    Math.round(average(pageTimes.slice(-ETA_WINDOW)) * Math.max(pagesLeft, 0));

/** Where the next request reads from: page `page` of `pageSize` below `to`, with `fetched` stored. */
interface Cursor {
    to: UnixSeconds;
    page: number;
    pageSize: PageSize;
    fetched: number;
}

/** The wait before retrying after `failures` transient failures in a row: 1 s, 2 s, 4 s, … */
export const backoffMs = (failures: number): number => FIRST_BACKOFF_MS * 2 ** (failures - 1);

/** The outcome of an import that stopped on `error`, keeping everything it stored. */
const paused = (error: LastfmFailure): Outcome => ({ status: "paused", error });

/** The outcome of a Sync that stopped on `error`, having stored nothing. */
const failed = (error: LastfmFailure): Outcome => ({ status: "failed", error });

/** How a job ends on a failed page: cancelled if its signal stopped it, else as `outcome` says. */
const stoppedBy = (error: LastfmFailure, outcome: (error: LastfmFailure) => Outcome): Outcome =>
    error.kind === "Aborted" ? { status: "cancelled" } : outcome(error);

const CANCELLED: LastfmFailure = { kind: "Aborted", message: "Cancelled" };

/** Whether a wait before retrying left the request as it was or changed it. */
type Backoff = "same" | "changed";

/** A page fetched, with when its request was started, or why it couldn't be. */
type FetchedPage =
    | { ok: true; value: RecentTracksPage; startedAt: number }
    | { ok: false; error: LastfmFailure };

/** Which unsettled job a new request joins: one per Listener and kind. */
const unsettledKey = (kind: JobKind, listener: ListenerId) => `${kind} ${listener}`;

const withEvent = (queue: readonly Job[], id: number, event: JobEvent): Job[] =>
    queue.map((job) => (job.id === id ? transition(job, event) : job));

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

    /** Waits `ms`, or less if `signal` aborts first. */
    const sleepUnlessAborted = (ms: number, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
            void transport.sleep(ms).then(resolve);
        });
    /** Each Listener's job of each kind that hasn't settled, which a new request for them joins. */
    const unsettled = new Map<string, Promise<Job>>();

    const dispatch = (id: number, event: JobEvent) =>
        store.setState(({ queue }) => ({ queue: withEvent(queue, id, event) }));
    const jobOf = (id: number) => store.getState().queue.find((job) => job.id === id)!;

    /**
     * Fetches the page `request` describes, waiting out transient failures with backoff;
     * `afterBackoff` may change the request, which counts failures afresh. Never rejects.
     */
    async function fetchPage(
        id: number,
        signal: AbortSignal,
        request: () => Omit<RecentTracksRequest, "signal">,
        afterBackoff: () => Promise<Backoff> = async () => "same",
    ): Promise<FetchedPage> {
        let failures = 0;
        for (;;) {
            const startedAt = transport.now();
            await throttle();
            if (signal.aborted) return { ok: false, error: CANCELLED };
            const result = await getRecentTracks({ ...request(), signal }, transport.fetch);
            if (result.ok) return { ...result, startedAt };
            const { error } = result;
            failures++;
            if (error.kind !== "Transient" || failures >= MAX_FAILURES) return result;
            const inMs = backoffMs(failures);
            dispatch(id, {
                type: "retrying",
                retry: { failures, pausesAt: MAX_FAILURES, inMs, error },
            });
            await sleepUnlessAborted(inMs, signal);
            if ((await afterBackoff()) === "changed") failures = 0;
        }
    }

    /** The row to import into: an unfinished one, resumed as it was, or a fresh one viewed at `queuedAt`. */
    async function importRow(
        { username, timeZone }: ImportRequest,
        queuedAt: number,
    ): Promise<ListenerRow> {
        const id = listenerId(username);
        const existing = await db.listener(id);
        const startedAt = transport.now();
        const resuming = existing !== undefined && !existing.importComplete;
        const row: ListenerRow = resuming
            ? { ...existing, timeZone }
            : {
                  id,
                  username,
                  timeZone,
                  pinnedArtists: existing?.pinnedArtists ?? [],
                  importTo: unixSecondsAt(startedAt),
                  importComplete: false,
                  pageSize: existing?.pageSize ?? PAGE_SIZES[0],
                  lastViewedAt: queuedAt,
                  syncedAt: unixSecondsAt(startedAt),
              };
        // A finished history is imported again from nothing.
        if (!resuming) await db.deleteScrobblesOf(id);
        await db.putListener(row);
        return row;
    }

    /** Where paging picks up: the oldest stored second may be partial, so it is dropped and fetched again. */
    async function resumeFrom(row: ListenerRow, pageSize: PageSize): Promise<Cursor> {
        const oldest = await db.oldestUtsOf(row.id);
        if (oldest !== undefined) await db.deleteScrobblesAt(row.id, oldest);
        return {
            to: oldest === undefined ? row.importTo : unixSeconds(oldest + 1),
            page: 1,
            pageSize,
            fetched: await db.countScrobblesOf(row.id),
        };
    }

    /** Drops to pages of 200 for this run and the Listener's later ones, picking up below what is stored. */
    async function smallerPages(row: ListenerRow): Promise<Cursor> {
        await db.updateListener(row.id, { pageSize: SMALL_PAGE });
        return resumeFrom(row, SMALL_PAGE);
    }

    /** Imports a Listener's history newest first below a fixed `to`, resuming an unfinished one; never rejects. */
    async function runImport(
        id: number,
        request: ImportRequest,
        queuedAt: number,
        signal: AbortSignal,
    ): Promise<Outcome> {
        const row = await importRow(request, queuedAt);
        let cursor = await resumeFrom(row, row.pageSize);
        let pageTimes: number[] = [];
        let total: number | undefined;

        const report = () => {
            if (total === undefined) return;
            const pagesLeft = Math.ceil((total - cursor.fetched) / cursor.pageSize);
            dispatch(id, {
                type: "counted",
                fetched: cursor.fetched,
                total,
                etaMs: etaMs(pageTimes, pagesLeft),
            });
        };
        // Pages of 200 are a new request, timed and counted afresh.
        const switchToSmallPages = async () => {
            cursor = await smallerPages(row);
            pageTimes = [];
            report();
        };
        // A page of 1000 that fails is asked for again in 200s.
        const afterBackoff = async (): Promise<Backoff> => {
            if (cursor.pageSize === SMALL_PAGE) return "same";
            await switchToSmallPages();
            return "changed";
        };

        for (;;) {
            const fetched = await fetchPage(
                id,
                signal,
                () => ({
                    user: row.username,
                    apiKey: request.apiKey,
                    page: cursor.page,
                    limit: cursor.pageSize,
                    to: cursor.to,
                }),
                afterBackoff,
            );
            if (!fetched.ok) return stoppedBy(fetched.error, paused);
            // A page cut short would leave a gap below it, so it is fetched again in 200s.
            if (cursor.pageSize !== SMALL_PAGE && fetched.value.perPage < cursor.pageSize) {
                await switchToSmallPages();
                continue;
            }

            const { scrobbles, totalPages } = fetched.value;
            // The run's first page counts what is left below its `to`; later pages could drift.
            total ??= cursor.fetched + fetched.value.total;
            const last = scrobbles.length === 0 || cursor.page >= totalPages;
            await db.addPage(
                row.id,
                scrobbles.map((scrobble) => ({ listenerId: row.id, ...scrobble })),
                { last },
            );
            pageTimes.push(transport.now() - fetched.startedAt);
            cursor = {
                ...cursor,
                page: cursor.page + 1,
                fetched: cursor.fetched + scrobbles.length,
            };
            report();
            if (last) break;
        }
        // One event for the whole import: its history is only shown once it is complete.
        events.emit("scrobblesChanged", { listenerId: row.id });
        return { status: "done" };
    }

    /**
     * Fetches everything since the last Sync, or the last 14 days if that is more, into memory,
     * then replaces that window in one transaction. Any failure stores nothing; never rejects.
     */
    async function runSync(
        id: number,
        request: SyncRequest,
        signal: AbortSignal,
    ): Promise<Outcome> {
        const row = await db.listener(listenerId(request.username));
        if (!row?.importComplete)
            return {
                status: "failed",
                error: { kind: "Hard", message: "No finished import to sync" },
            };
        const to = unixSecondsAt(transport.now());
        const from = unixSeconds(Math.min(row.syncedAt, to - SYNC_WINDOW_SECONDS));
        let pageSize = row.pageSize;
        let page = 1;
        let fetched: LastfmScrobble[] = [];

        for (;;) {
            const result = await fetchPage(id, signal, () => ({
                user: row.username,
                apiKey: request.apiKey,
                page,
                limit: pageSize,
                from,
                to,
            }));
            if (!result.ok) return stoppedBy(result.error, failed);
            // A page cut short would leave a gap, so the window is fetched again in 200s.
            if (pageSize !== SMALL_PAGE && result.value.perPage < pageSize) {
                pageSize = SMALL_PAGE;
                page = 1;
                fetched = [];
                continue;
            }
            const { scrobbles, totalPages, total } = result.value;
            fetched = [...fetched, ...scrobbles];
            dispatch(id, { type: "counted", fetched: fetched.length, total, etaMs: 0 });
            if (scrobbles.length === 0 || page >= totalPages) break;
            page++;
        }
        // The second at `from` is left as stored, whether or not last.fm counts it in the range.
        await db.replaceScrobblesAfter(
            row.id,
            from,
            fetched
                .filter((scrobble) => scrobble.uts > from)
                .map((scrobble) => ({ listenerId: row.id, ...scrobble })),
            // The fallback to 200s is remembered only with a Sync that succeeds.
            { syncedAt: to, pageSize },
        );
        events.emit("scrobblesChanged", { listenerId: row.id });
        return { status: "done" };
    }

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
