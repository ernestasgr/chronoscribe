import { Dexie, type EntityTable, type Table } from "dexie";
import { z } from "zod";
import { unixSeconds, type UnixSeconds } from "../lastfm";
import { parseSettings, type AppSettings } from "../settings";
import {
    parseSpotifyMatch,
    parseStoredLimit,
    parseStoredSpotify,
    type SpotifyMatch,
    type StoredSpotify,
    type TrackName,
    type UnixMs,
} from "../spotify";

/** A Listener's key: their last.fm username, lowercased. */
export type ListenerId = string & { readonly brand: "ListenerId" };

/** The Listener id for a last.fm username, which last.fm matches case-insensitively. */
export const listenerId = (username: string): ListenerId => username.toLowerCase() as ListenerId;

export interface ScrobbleRow {
    id?: number;
    listenerId: ListenerId;
    uts: UnixSeconds;
    artist: string;
    track: string;
    album: string;
}

const ScrobbleRowSchema = z.object({
    listenerId: z.string().transform(listenerId),
    uts: z.number().transform(unixSeconds),
    artist: z.string(),
    track: z.string(),
    album: z.string(),
});

/** A stored Scrobble without its row id, or none if malformed. */
const parseScrobble = (row: unknown): Omit<ScrobbleRow, "id"> | undefined => {
    const parsed = ScrobbleRowSchema.safeParse(row);
    return parsed.success ? parsed.data : undefined;
};

/** The page sizes an import asks last.fm for, largest first. */
export const PAGE_SIZES = [1000, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/**
 * A stored Listener row; one from before page sizes were remembered asks for 1000, and one from
 * before Syncs counts as synced up to its import.
 */
const ListenerRowSchema = z
    .object({
        id: z.string().transform(listenerId),
        username: z.string(),
        /** IANA timezone the Listener's Days are counted in. */
        timeZone: z.string(),
        pinnedArtists: z.array(z.string()),
        /** The fixed, exclusive `to` the import pages up to. */
        importTo: z.number().transform(unixSeconds),
        importComplete: z.boolean(),
        /** How many Scrobbles each import request asks for: 200 once last.fm has refused 1000. */
        pageSize: z.literal(PAGE_SIZES).catch(PAGE_SIZES[0]),
        lastViewedAt: z.number(),
        /** The exclusive `to` the history was last fetched up to, by its import or a Sync. */
        syncedAt: z.number().optional(),
    })
    .transform(({ syncedAt, ...row }) => ({
        ...row,
        syncedAt: syncedAt === undefined ? row.importTo : unixSeconds(syncedAt),
    }));

export type ListenerRow = z.infer<typeof ListenerRowSchema>;

const parseListener = (row: unknown): ListenerRow | undefined => {
    const parsed = ListenerRowSchema.safeParse(row);
    return parsed.success ? parsed.data : undefined;
};

const SETTINGS_ID = "app";
/** The id of the one Spotify connection row: the whole app shares it, whichever Listener is viewed. */
const SPOTIFY_ID = "app";

type ChronoscribeDexie = Dexie & {
    appSettings: EntityTable<AppSettings & { id: string }, "id">;
    listeners: EntityTable<ListenerRow, "id">;
    scrobbles: EntityTable<ScrobbleRow, "id">;
    spotify: EntityTable<StoredSpotify & { id: string }, "id">;
    /** Each last.fm track's Spotify search result, shared by every Listener; keyed on `[artist+track]`. */
    spotifyMatches: Table<TrackName & { match: SpotifyMatch }, [string, string]>;
    /** When a 429 lets the app ask Spotify again, kept so a reload still waits. */
    spotifyLimit: EntityTable<{ id: string; until: number }, "id">;
};

function openDexie(name: string): ChronoscribeDexie {
    // cast: Dexie's documented way to type its tables, which `version().stores()` below declares.
    const dexie = new Dexie(name) as ChronoscribeDexie;
    dexie.version(1).stores({
        appSettings: "id",
        listeners: "id",
        scrobbles: "++id, [listenerId+uts]",
    });
    dexie.version(2).stores({ spotify: "id" });
    dexie.version(3).stores({ spotifyMatches: "[artist+track]", spotifyLimit: "id" });
    return dexie;
}

/** The most recently viewed Listener, finished or not. */
export const mostRecentlyViewed = (listeners: readonly ListenerRow[]): ListenerRow | undefined =>
    listeners.toSorted((a, b) => b.lastViewedAt - a.lastViewedAt)[0];

/** The app's storage. Every read and write of IndexedDB goes through here. */
export function openDb(name = "chronoscribe") {
    const dexie = openDexie(name);
    const scrobblesOf = (id: ListenerId) =>
        dexie.scrobbles.where("[listenerId+uts]").between([id, Dexie.minKey], [id, Dexie.maxKey]);

    return {
        async loadSettings(): Promise<AppSettings> {
            return parseSettings(await dexie.appSettings.get(SETTINGS_ID));
        },

        async saveSettings(settings: AppSettings): Promise<void> {
            await dexie.appSettings.put({ ...settings, id: SETTINGS_ID });
        },

        /** The Spotify connection, checked as it is read; none if missing or malformed. */
        async loadSpotify(): Promise<StoredSpotify | undefined> {
            return parseStoredSpotify(await dexie.spotify.get(SPOTIFY_ID));
        },

        async saveSpotify(connection: StoredSpotify): Promise<void> {
            await dexie.spotify.put({ ...connection, id: SPOTIFY_ID });
        },

        async clearSpotify(): Promise<void> {
            await dexie.spotify.delete(SPOTIFY_ID);
        },

        /** A track's stored Spotify search result, checked as it is read; none if never searched or malformed. */
        async spotifyMatch({ artist, track }: TrackName): Promise<SpotifyMatch | undefined> {
            return parseSpotifyMatch((await dexie.spotifyMatches.get([artist, track]))?.match);
        },

        /** Stores a track's Spotify search result, found or not, for every Listener. */
        async saveSpotifyMatch({ artist, track }: TrackName, match: SpotifyMatch): Promise<void> {
            await dexie.spotifyMatches.put({ artist, track, match });
        },

        /** Forgets every Spotify search result, so tracks are searched for again. */
        async clearSpotifyMatches(): Promise<void> {
            await dexie.spotifyMatches.clear();
        },

        /** When the last 429 lets the app ask Spotify again, checked as it is read; none if never limited. */
        async loadSpotifyLimit(): Promise<UnixMs | undefined> {
            return parseStoredLimit(await dexie.spotifyLimit.get(SPOTIFY_ID));
        },

        async saveSpotifyLimit(until: UnixMs): Promise<void> {
            await dexie.spotifyLimit.put({ id: SPOTIFY_ID, until });
        },

        async listener(id: ListenerId): Promise<ListenerRow | undefined> {
            return parseListener(await dexie.listeners.get(id));
        },

        async listeners(): Promise<ListenerRow[]> {
            return (await dexie.listeners.toArray()).flatMap((row) => parseListener(row) ?? []);
        },

        async putListener(listener: ListenerRow): Promise<void> {
            await dexie.listeners.put(listener);
        },

        async updateListener(
            id: ListenerId,
            changes: Partial<Omit<ListenerRow, "id">>,
        ): Promise<void> {
            await dexie.listeners.update(id, changes);
        },

        /** Stores one page of a Listener's Scrobbles in one transaction, completing their import on the last. */
        async addPage(
            id: ListenerId,
            rows: Omit<ScrobbleRow, "id">[],
            { last }: { last: boolean },
        ): Promise<void> {
            await dexie.transaction("rw", dexie.scrobbles, dexie.listeners, async () => {
                await dexie.scrobbles.bulkAdd(rows);
                if (last) await dexie.listeners.update(id, { importComplete: true });
            });
        },

        /**
         * Replaces a Listener's Scrobbles after the second `after` with `rows` and records the
         * Sync's `syncedAt` and page size, all in one transaction.
         */
        async replaceScrobblesAfter(
            id: ListenerId,
            after: UnixSeconds,
            rows: Omit<ScrobbleRow, "id">[],
            sync: Pick<ListenerRow, "syncedAt" | "pageSize">,
        ): Promise<void> {
            await dexie.transaction("rw", dexie.scrobbles, dexie.listeners, async () => {
                await dexie.scrobbles
                    .where("[listenerId+uts]")
                    .between([id, after], [id, Dexie.maxKey], false, true)
                    .delete();
                await dexie.scrobbles.bulkAdd(rows);
                await dexie.listeners.update(id, sync);
            });
        },

        async deleteScrobblesOf(id: ListenerId): Promise<void> {
            await scrobblesOf(id).delete();
        },

        /** Deletes a Listener's Scrobbles and their row in one transaction. */
        async deleteListener(id: ListenerId): Promise<void> {
            await dexie.transaction("rw", dexie.scrobbles, dexie.listeners, async () => {
                await scrobblesOf(id).delete();
                await dexie.listeners.delete(id);
            });
        },

        /** The second of a Listener's oldest stored Scrobble, if they have any. */
        async oldestUtsOf(id: ListenerId): Promise<UnixSeconds | undefined> {
            return (await scrobblesOf(id).first())?.uts;
        },

        /** Deletes a Listener's Scrobbles from exactly the second `uts`. */
        async deleteScrobblesAt(id: ListenerId, uts: UnixSeconds): Promise<void> {
            await dexie.scrobbles.where("[listenerId+uts]").equals([id, uts]).delete();
        },

        countScrobblesOf(id: ListenerId): Promise<number> {
            return scrobblesOf(id).count();
        },

        /** A Listener's Scrobbles from second `from` through `to`, oldest first, checked as they are read. */
        async scrobblesBetween(
            id: ListenerId,
            from: UnixSeconds,
            to: UnixSeconds,
        ): Promise<Omit<ScrobbleRow, "id">[]> {
            const rows = await dexie.scrobbles
                .where("[listenerId+uts]")
                .between([id, from], [id, to], true, true)
                .toArray();
            return rows.flatMap((row) => parseScrobble(row) ?? []);
        },

        /** A Listener's Scrobbles, oldest first. */
        async scrobblesOf(id: ListenerId): Promise<Omit<ScrobbleRow, "id">[]> {
            const rows = await scrobblesOf(id).toArray();
            return rows.map(({ id: _id, ...row }) => row);
        },

        close(): void {
            dexie.close();
        },
    };
}

export type Db = ReturnType<typeof openDb>;
