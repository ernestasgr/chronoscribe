/**
 * A fake last.fm `user.getRecentTracks` endpoint over a fixture history, shared by the
 * Vitest ingest tests and the Playwright tests. It pages newest-first and honours
 * `limit`, `page`, `from` (inclusive) and `to` (exclusive), as the real API does.
 */

export interface FixtureScrobble {
  uts: number;
  artist: string;
  track: string;
  album: string;
}

export interface FixtureUser {
  username: string;
  history: FixtureScrobble[];
  /** A track the user is playing right now, served on top of page 1. */
  nowPlaying?: Omit<FixtureScrobble, "uts">;
}

export interface FixtureResponse {
  status: number;
  body: unknown;
}

export const LASTFM_ORIGIN = "https://ws.audioscrobbler.com";

function track(scrobble: Omit<FixtureScrobble, "uts"> & { uts?: number }) {
  return {
    artist: { mbid: "", "#text": scrobble.artist },
    streamable: "0",
    image: [],
    mbid: "",
    album: { mbid: "", "#text": scrobble.album },
    name: scrobble.track,
    url: "https://www.last.fm/music/fixture",
    ...(scrobble.uts === undefined
      ? { "@attr": { nowplaying: "true" } }
      : { date: { uts: String(scrobble.uts), "#text": "fixture" } }),
  };
}

export function respondRecentTracks(
  url: URL,
  users: FixtureUser[],
  apiKey: string,
): FixtureResponse {
  const params = url.searchParams;
  if (params.get("method") !== "user.getrecenttracks" || params.get("format") !== "json") {
    return { status: 400, body: { error: 6, message: "Invalid parameters" } };
  }
  if (params.get("api_key") !== apiKey) {
    return {
      status: 403,
      body: { error: 10, message: "Invalid API key - You must be granted a valid key by last.fm" },
    };
  }
  const user = users.find(
    (candidate) => candidate.username.toLowerCase() === params.get("user")?.toLowerCase(),
  );
  if (!user) return { status: 404, body: { error: 6, message: "User not found" } };

  const limit = Math.min(Number(params.get("limit") ?? 50), 1000);
  const page = Number(params.get("page") ?? 1);
  const from = params.has("from") ? Number(params.get("from")) : -Infinity;
  const to = params.has("to") ? Number(params.get("to")) : Infinity;
  const matching = user.history
    .filter((scrobble) => scrobble.uts >= from && scrobble.uts < to)
    .toSorted((a, b) => b.uts - a.uts);
  const tracks = matching.slice((page - 1) * limit, page * limit).map(track);
  if (page === 1 && user.nowPlaying) tracks.unshift(track(user.nowPlaying));

  return {
    status: 200,
    body: {
      recenttracks: {
        track: tracks,
        "@attr": {
          user: user.username,
          page: String(page),
          perPage: String(limit),
          totalPages: String(Math.ceil(matching.length / limit)),
          total: String(matching.length),
        },
      },
    },
  };
}

/** `count` Scrobbles of one Artist, spread a minute apart from `startIso`. */
export function scrobbles(artist: string, count: number, startIso: string): FixtureScrobble[] {
  const start = Date.parse(startIso) / 1000;
  return Array.from({ length: count }, (_, i) => ({
    uts: start + i * 60,
    artist,
    track: `${artist} track ${i % 7}`,
    album: `${artist} album`,
  }));
}
