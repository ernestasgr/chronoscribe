import { listenerId } from "../db";
import { unixSeconds, unixSecondsAt, type LastfmFailure, type LastfmScrobble } from "../lastfm";
import { stoppedBy, type Outcome } from "./job";
import { SMALL_PAGE, type JobRunDeps } from "./pages";

/** How far back a Sync fetches again, so late and deleted Scrobbles are reconciled. */
const SYNC_WINDOW_SECONDS = 14 * 86_400;

/** A Sync of a Listener whose import has finished. */
export interface SyncRequest {
    username: string;
    apiKey: string;
}

/** The outcome of a Sync that stopped on `error`, having stored nothing. */
const failed = (error: LastfmFailure): Outcome => ({ status: "failed", error });

/**
 * Builds the Sync job's run: fetches everything since the last Sync, or the last 14 days if that
 * is more, into memory, then replaces that window in one transaction. Any failure stores nothing;
 * the run never rejects.
 */
export const createSyncJob =
    ({ db, events, transport, fetchPage, dispatch }: JobRunDeps) =>
    async (id: number, request: SyncRequest, signal: AbortSignal): Promise<Outcome> => {
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
    };
