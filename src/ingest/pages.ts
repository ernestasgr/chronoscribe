import { PAGE_SIZES, type Db } from "../db";
import type { Emitter } from "../events";
import {
    getRecentTracks,
    type Fetch,
    type LastfmFailure,
    type RecentTracksPage,
    type RecentTracksRequest,
} from "../lastfm";
import type { IngestEvents, JobEvent } from "./job";

/** The page size a job falls back to when last.fm won't serve 1000. */
export const SMALL_PAGE = PAGE_SIZES[1];
/** How many times in a row one request may fail transiently before the import pauses. */
export const MAX_FAILURES = 5;
/** The wait before the first retry, doubling with each failure after it. */
const FIRST_BACKOFF_MS = 1000;

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

/** The wait before retrying after `failures` transient failures in a row: 1 s, 2 s, 4 s, … */
export const backoffMs = (failures: number): number => FIRST_BACKOFF_MS * 2 ** (failures - 1);

export const CANCELLED: LastfmFailure = { kind: "Aborted", message: "Cancelled" };

/** Whether a wait before retrying left the request as it was or changed it. */
export type Backoff = "same" | "changed";

/** A page fetched, with when its request was started, or why it couldn't be. */
type FetchedPage =
    | { ok: true; value: RecentTracksPage; startedAt: number }
    | { ok: false; error: LastfmFailure };

/**
 * Fetches the page `request` describes for job `id`, waiting out transient failures with backoff;
 * `afterBackoff` may change the request, which counts failures afresh. Never rejects.
 */
export type FetchPage = (
    id: number,
    signal: AbortSignal,
    request: () => Omit<RecentTracksRequest, "signal">,
    afterBackoff?: () => Promise<Backoff>,
) => Promise<FetchedPage>;

/** What a job's run needs from the queue running it. */
export interface JobRunDeps {
    db: Db;
    events: Emitter<IngestEvents>;
    transport: Transport;
    fetchPage: FetchPage;
    dispatch: (id: number, event: JobEvent) => void;
}

/** Resolves when the caller may send its request: each caller waits its turn, `gapMs` apart. */
export function createThrottle({ now, sleep }: Transport, gapMs: number): () => Promise<void> {
    const state = { lastAt: -Infinity, turn: Promise.resolve() };
    return () =>
        (state.turn = state.turn.then(async () => {
            const wait = state.lastAt + gapMs - now();
            if (wait > 0) await sleep(wait);
            state.lastAt = now();
        }));
}

/** The one paging protocol Import and Sync share: throttled, retried with backoff, abortable. */
export function createFetchPage({
    transport,
    throttle,
    dispatch,
}: {
    transport: Transport;
    throttle: () => Promise<void>;
    dispatch: (id: number, event: JobEvent) => void;
}): FetchPage {
    /** Waits `ms`, or less if `signal` aborts first. */
    const sleepUnlessAborted = (ms: number, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
            void transport.sleep(ms).then(resolve);
        });

    return async (id, signal, request, afterBackoff = async () => "same") => {
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
    };
}
