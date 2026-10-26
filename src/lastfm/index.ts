export const API_ROOT = "https://ws.audioscrobbler.com/2.0/";

export interface LastfmScrobble {
  uts: number;
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

/** `Hard` errors need the user to fix something; `Transient` ones are worth retrying. */
export type LastfmErrorKind = "Hard" | "Transient";

// Every other last.fm error (6 user not found, 10 invalid key, 17 private, …) is Hard.
const TRANSIENT_CODES = new Set([8, 11, 16, 29]);

export class LastfmError extends Error {
  constructor(
    readonly kind: LastfmErrorKind,
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "LastfmError";
  }
}

export interface RecentTracksRequest {
  user: string;
  apiKey: string;
  page: number;
  limit: number;
  /** Exclusive upper bound, in Unix seconds. */
  to?: number;
  signal?: AbortSignal;
}

interface RawTrack {
  artist: { "#text": string };
  album: { "#text": string };
  name: string;
  date?: { uts: string };
  "@attr"?: { nowplaying?: string };
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One page of `user.getRecentTracks`, newest first, without the now-playing entry. */
export async function getRecentTracks(
  request: RecentTracksRequest,
  fetchFn: Fetch = fetch,
): Promise<RecentTracksPage> {
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

  let response: Response;
  let body: {
    error?: number;
    message?: string;
    recenttracks?: { track: RawTrack | RawTrack[]; "@attr": Record<string, string> };
  };
  try {
    response = await fetchFn(url.toString(), { signal: request.signal });
    body = await response.json();
  } catch (error) {
    if (request.signal?.aborted) throw error;
    throw new LastfmError("Transient", `Network error: ${String(error)}`);
  }

  if (body.error !== undefined) {
    const kind = TRANSIENT_CODES.has(body.error) ? "Transient" : "Hard";
    throw new LastfmError(kind, body.message ?? `last.fm error ${body.error}`, body.error);
  }
  if (!response.ok || !body.recenttracks) {
    throw new LastfmError(
      response.status === 429 || response.status >= 500 ? "Transient" : "Hard",
      `HTTP ${response.status}`,
    );
  }

  const { track, "@attr": attr } = body.recenttracks;
  const tracks = Array.isArray(track) ? track : [track];
  return {
    scrobbles: tracks
      .filter((t) => t.date?.uts !== undefined && t["@attr"]?.nowplaying !== "true")
      .map((t) => ({
        uts: Number(t.date!.uts),
        artist: t.artist["#text"],
        track: t.name,
        album: t.album["#text"],
      })),
    page: Number(attr.page),
    perPage: Number(attr.perPage),
    totalPages: Number(attr.totalPages),
    total: Number(attr.total),
  };
}
