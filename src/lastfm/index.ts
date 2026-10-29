export const API_ROOT = "https://ws.audioscrobbler.com/2.0/";

/** A moment as last.fm counts it: whole seconds since the Unix epoch. */
export type UnixSeconds = number & { readonly brand: "UnixSeconds" };

/** Brands a count of whole seconds since the Unix epoch. */
export const unixSeconds = (seconds: number): UnixSeconds => seconds as UnixSeconds;

/** The whole second a Unix time in milliseconds falls in. */
export const unixSecondsAt = (ms: number): UnixSeconds => unixSeconds(Math.floor(ms / 1000));

export interface LastfmScrobble {
    uts: UnixSeconds;
    artist: string;
    track: string;
    album: string;
}

export interface RecentTracksPage {
    scrobbles: LastfmScrobble[];
    page: number;
    perPage: number;
    totalPages: number;
    total: number;
}

/**
 * Why a request failed: `Hard` needs the user to fix something, `Transient` is worth retrying,
 * and `Aborted` means the caller's signal stopped it.
 */
export interface LastfmFailure {
    kind: "Hard" | "Transient" | "Aborted";
    message: string;
    code?: number;
}

export type LastfmResult<T> = { ok: true; value: T } | { ok: false; error: LastfmFailure };

// Every other last.fm error (6 user not found, 10 invalid key, 17 private, …) is Hard.
const TRANSIENT_CODES = new Set([8, 11, 16, 29]);

const fail = (kind: LastfmFailure["kind"], message: string, code?: number) =>
    ({ ok: false, error: { kind, message, ...(code === undefined ? {} : { code }) } }) as const;

export interface RecentTracksRequest {
    user: string;
    apiKey: string;
    page: number;
    limit: number;
    /** Exclusive upper bound. */
    to?: UnixSeconds;
    signal?: AbortSignal;
}

interface RawTrack {
    artist: { "#text": string };
    album: { "#text": string };
    name: string;
    date?: { uts: string };
    "@attr"?: { nowplaying?: string };
}

interface RawBody {
    error?: number;
    message?: string;
    recenttracks?: { track: RawTrack | RawTrack[]; "@attr": Record<string, string> };
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const recentTracksUrl = (request: RecentTracksRequest): string => {
    const url = new URL(API_ROOT);
    url.search = new URLSearchParams({
        method: "user.getrecenttracks",
        user: request.user,
        api_key: request.apiKey,
        format: "json",
        page: String(request.page),
        limit: String(request.limit),
        ...(request.to === undefined ? {} : { to: String(request.to) }),
    }).toString();
    return url.toString();
};

/** Maps a last.fm response to a page, without the now-playing entry, or to its failure. */
function parseRecentTracks(status: number, body: RawBody): LastfmResult<RecentTracksPage> {
    if (body.error !== undefined) {
        const kind = TRANSIENT_CODES.has(body.error) ? "Transient" : "Hard";
        return fail(kind, body.message ?? `last.fm error ${body.error}`, body.error);
    }
    if (status < 200 || status >= 300 || !body.recenttracks) {
        return fail(status === 429 || status >= 500 ? "Transient" : "Hard", `HTTP ${status}`);
    }

    const { track, "@attr": attr } = body.recenttracks;
    const tracks = Array.isArray(track) ? track : [track];
    return {
        ok: true,
        value: {
            scrobbles: tracks
                .filter((t) => t.date?.uts !== undefined && t["@attr"]?.nowplaying !== "true")
                .map((t) => ({
                    uts: unixSeconds(Number(t.date!.uts)),
                    artist: t.artist["#text"],
                    track: t.name,
                    album: t.album["#text"],
                })),
            page: Number(attr.page),
            perPage: Number(attr.perPage),
            totalPages: Number(attr.totalPages),
            total: Number(attr.total),
        },
    };
}

/** One page of `user.getRecentTracks`, newest first, without the now-playing entry. */
export async function getRecentTracks(
    request: RecentTracksRequest,
    fetchFn: Fetch = fetch,
): Promise<LastfmResult<RecentTracksPage>> {
    try {
        const response = await fetchFn(recentTracksUrl(request), { signal: request.signal });
        return parseRecentTracks(response.status, (await response.json()) as RawBody);
    } catch (error) {
        return request.signal?.aborted
            ? fail("Aborted", "Cancelled")
            : fail("Transient", `Network error: ${String(error)}`);
    }
}
