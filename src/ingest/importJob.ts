import { listenerId, PAGE_SIZES, type ListenerRow, type PageSize } from "../db";
import { unixSeconds, unixSecondsAt, type LastfmFailure, type UnixSeconds } from "../lastfm";
import { etaMs, stoppedBy, type Outcome } from "./job";
import { SMALL_PAGE, type Backoff, type JobRunDeps } from "./pages";

export interface ImportRequest {
    username: string;
    apiKey: string;
    timeZone: string;
}

/** Where the next request reads from: page `page` of `pageSize` below `to`, with `fetched` stored. */
interface Cursor {
    to: UnixSeconds;
    page: number;
    pageSize: PageSize;
    fetched: number;
}

/** The outcome of an import that stopped on `error`, keeping everything it stored. */
const paused = (error: LastfmFailure): Outcome => ({ status: "paused", error });

/** Builds the Import job's run: a Listener's whole history, newest first, resumable. */
export function createImportJob({ db, events, transport, fetchPage, dispatch }: JobRunDeps) {
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
    return async function runImport(
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
    };
}
