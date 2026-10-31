import { z } from "zod";
import { apiResult } from "./accounts";
import {
    API_ROOT,
    bearer,
    reaching,
    unavailable,
    type DeviceId,
    type Fetch,
    type SpotifyResult,
} from "./core";

/** A Spotify track a last.fm track was matched to, and its length. */
export const TrackMatch = z.object({ uri: z.string().min(1), durationMs: z.number().positive() });
export type TrackMatch = z.infer<typeof TrackMatch>;

/** A stored search result: the match, or that the track isn't on Spotify. */
const SpotifyMatchSchema = z.discriminatedUnion("kind", [
    TrackMatch.extend({ kind: z.literal("found") }),
    z.object({ kind: z.literal("notFound") }),
]);
export type SpotifyMatch = z.infer<typeof SpotifyMatchSchema>;

/** A stored search result read back; a missing or malformed row reads as never searched. */
export const parseSpotifyMatch = (row: unknown): SpotifyMatch | undefined => {
    const parsed = SpotifyMatchSchema.safeParse(row);
    return parsed.success ? parsed.data : undefined;
};

/** A last.fm track, by its exact names. */
export interface TrackName {
    artist: string;
    track: string;
}

/** One track in a search reply; Spotify sometimes leaves a null in place of one. */
const SearchItem = z
    .object({
        uri: z.string().min(1),
        duration_ms: z.number().positive(),
        artists: z.array(z.object({ name: z.string() })),
    })
    .nullable();
type SearchItem = z.infer<typeof SearchItem>;

const SearchReply = z.object({ tracks: z.object({ items: z.array(SearchItem) }) });

/** A name with letter case and accents set aside, so "BJÖRK" is "bjork". */
const folded = (name: string): string =>
    name
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .trim();

/**
 * The first result one of whose artists is `artist`, ignoring case and accents. Titles aren't
 * compared, so "Song - Remastered 2011" matches "Song".
 */
export function firstMatch(items: readonly SearchItem[], artist: string): TrackMatch | undefined {
    const wanted = folded(artist);
    const found = items.find((item) => item?.artists.some(({ name }) => folded(name) === wanted));
    return found ? { uri: found.uri, durationMs: found.duration_ms } : undefined;
}

/** A name with its double quotes dropped, as a field search can't hold them. */
const unquoted = (name: string): string => name.replaceAll('"', "");

/** The searches tried for a track, in order: by field, then plain. */
export const searchQueries = ({ artist, track }: TrackName): readonly string[] => [
    `track:"${unquoted(track)}" artist:"${unquoted(artist)}"`,
    `${artist} ${track}`,
];

/** How far into a track a Soundtrack starts: 30 s, or a third of a track too short for that. */
const START_MS = 30_000;

/** Where a Soundtrack starts in a track of `durationMs`: 30 s in, unless that is past its first third. */
export const startPosition = (durationMs: number): number =>
    Math.min(START_MS, Math.floor(durationMs / 3));

/** The most results a search asks for; Spotify caps it for apps in Development Mode. */
const SEARCH_LIMIT = 10;

/** Runs one search, giving the first result by `artist`, if any. */
async function searchOnce(
    query: string,
    artist: string,
    accessToken: string,
    fetchFn: Fetch,
    now: () => number,
): Promise<SpotifyResult<TrackMatch | undefined>> {
    const url = new URL(`${API_ROOT}/search`);
    url.search = new URLSearchParams({
        q: query,
        type: "track",
        limit: String(SEARCH_LIMIT),
    }).toString();
    const result = await apiResult(
        await fetchFn(url.toString(), { headers: bearer(accessToken) }),
        now,
    );
    if (!result.ok) return result;
    const reply = SearchReply.safeParse(result.value);
    if (!reply.success) return unavailable("Malformed search reply");
    return { ok: true, value: firstMatch(reply.data.tracks.items, artist) };
}

/** Finds a last.fm track on Spotify, by field and then plain; none if neither search matches. */
export function searchTrack(
    name: TrackName,
    accessToken: string,
    fetchFn: Fetch,
    now: () => number,
): Promise<SpotifyResult<TrackMatch | undefined>> {
    return reaching(() =>
        searchQueries(name).reduce<Promise<SpotifyResult<TrackMatch | undefined>>>(
            async (previous, query) => {
                const found = await previous;
                return !found.ok || found.value
                    ? found
                    : searchOnce(query, name.artist, accessToken, fetchFn, now);
            },
            Promise.resolve({ ok: true, value: undefined }),
        ),
    );
}

/** A track to start on this tab's device, and how far in. */
export interface PlayRequest {
    deviceId: DeviceId;
    uri: string;
    positionMs: number;
}

/** Starts a track on this tab's device, `positionMs` in. */
export function playTrack(
    { deviceId, uri, positionMs }: PlayRequest,
    accessToken: string,
    fetchFn: Fetch,
    now: () => number,
): Promise<SpotifyResult<void>> {
    return reaching(async () => {
        const url = new URL(`${API_ROOT}/me/player/play`);
        url.searchParams.set("device_id", deviceId);
        const result = await apiResult(
            await fetchFn(url.toString(), {
                method: "PUT",
                headers: { ...bearer(accessToken), "content-type": "application/json" },
                body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
            }),
            now,
        );
        return result.ok ? { ok: true, value: undefined } : result;
    });
}
