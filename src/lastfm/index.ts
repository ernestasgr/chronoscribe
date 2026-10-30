import { z } from "zod";

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
    /** Lower bound; last.fm's inclusiveness is not relied on. */
    from?: UnixSeconds;
    /** Exclusive upper bound. */
    to?: UnixSeconds;
    signal?: AbortSignal;
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
        ...(request.from === undefined ? {} : { from: String(request.from) }),
        ...(request.to === undefined ? {} : { to: String(request.to) }),
    }).toString();
    return url.toString();
};

/** A count last.fm sends as a string of digits. */
const Count = z.string().regex(/^\d+$/, "expected a count").transform(Number);

const Text = z.object({ "#text": z.string() });

const Track = z.object({
    artist: Text,
    album: Text,
    name: z.string(),
    date: z.object({ uts: Count.transform(unixSeconds) }).optional(),
    "@attr": z.object({ nowplaying: z.string().optional() }).optional(),
});

/** A last.fm error reply, which can come with any HTTP status. */
const ErrorBody = z.object({ error: z.number(), message: z.string().optional() });

/** A page of `user.getRecentTracks`; a lone track comes unwrapped, so it is wrapped here. */
const RecentTracksBody = z
    .object({
        recenttracks: z.object({
            track: z.union([Track, z.array(Track)]),
            "@attr": z.object({ page: Count, perPage: Count, totalPages: Count, total: Count }),
        }),
    })
    .transform(({ recenttracks: { track, "@attr": counts } }): RecentTracksPage => ({
        scrobbles: (Array.isArray(track) ? track : [track]).flatMap((t) =>
            t.date === undefined || t["@attr"]?.nowplaying === "true"
                ? []
                : [
                      {
                          uts: t.date.uts,
                          artist: t.artist["#text"],
                          track: t.name,
                          album: t.album["#text"],
                      },
                  ],
        ),
        ...counts,
    }));

/** Whether an HTTP status is worth retrying. */
const isTransientStatus = (status: number) => status === 429 || status >= 500;

/** Maps a last.fm response to a page, without the now-playing entry, or to its failure. */
function parseRecentTracks(status: number, body: unknown): LastfmResult<RecentTracksPage> {
    const error = ErrorBody.safeParse(body);
    if (error.success) {
        const { error: code, message } = error.data;
        const kind = TRANSIENT_CODES.has(code) ? "Transient" : "Hard";
        return fail(kind, message ?? `last.fm error ${code}`, code);
    }
    if (status < 200 || status >= 300)
        return fail(isTransientStatus(status) ? "Transient" : "Hard", `HTTP ${status}`);
    const page = RecentTracksBody.safeParse(body);
    return page.success
        ? { ok: true, value: page.data }
        : fail("Hard", `Malformed last.fm page: ${z.prettifyError(page.error)}`);
}

/** The response's JSON, or undefined when the body isn't JSON (such as a proxy's error page). */
const jsonOf = (response: Response): Promise<unknown> =>
    response.json().catch((): unknown => undefined);

/** One page of `user.getRecentTracks`, newest first, without the now-playing entry. */
export async function getRecentTracks(
    request: RecentTracksRequest,
    fetchFn: Fetch = fetch,
): Promise<LastfmResult<RecentTracksPage>> {
    try {
        const response = await fetchFn(recentTracksUrl(request), { signal: request.signal });
        return parseRecentTracks(response.status, await jsonOf(response));
    } catch (error) {
        return request.signal?.aborted
            ? fail("Aborted", "Cancelled")
            : fail("Transient", `Network error: ${String(error)}`);
    }
}
