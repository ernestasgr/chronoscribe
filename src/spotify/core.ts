import { z } from "zod";

export const ACCOUNTS_ROOT = "https://accounts.spotify.com";
export const API_ROOT = "https://api.spotify.com/v1";
export const SDK_URL = "https://sdk.scdn.co/spotify-player.js";

/** What the app asks Spotify for: playing in this tab, and reading and steering the player. */
export const SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-modify-playback-state",
    "user-read-playback-state",
] as const;

/** The id Spotify gives this tab's Web Playback SDK player, to start tracks on. */
export type DeviceId = string & { readonly brand: "DeviceId" };

/** Brands the `device_id` the SDK's `ready` event carries. */
export const deviceId = (id: string): DeviceId => id as DeviceId;

/** The build's Spotify Client ID, if it was built with one; without it the app has no Spotify. */
export const spotifyClientId = (env: unknown): string | undefined => {
    const parsed = z.object({ VITE_SPOTIFY_CLIENT_ID: z.string().trim().min(1) }).safeParse(env);
    return parsed.success ? parsed.data.VITE_SPOTIFY_CLIENT_ID : undefined;
};

/**
 * Why Spotify can't be used: the sign-in was refused or lapsed, the account isn't allowlisted
 * or lacks Premium, the browser can't play (no DRM) or blocked autoplay, or Spotify didn't answer.
 */
export type SpotifyFailure =
    | { kind: "SignInRefused"; message: string }
    | { kind: "SignInExpired" }
    | { kind: "NotAllowlisted" }
    | { kind: "PremiumRequired" }
    | { kind: "Unsupported"; message: string }
    | { kind: "AutoplayBlocked" }
    | { kind: "Unavailable"; message: string };

export type SpotifyResult<T> = { ok: true; value: T } | { ok: false; error: SpotifyFailure };

export const unavailable = (message: string) =>
    ({ ok: false, error: { kind: "Unavailable", message } }) as const;

/** What `request` gets, or Unavailable if Spotify couldn't be reached at all. */
export async function reaching<T>(
    request: () => Promise<SpotifyResult<T>>,
): Promise<SpotifyResult<T>> {
    try {
        return await request();
    } catch (error) {
        return unavailable(`Network error: ${String(error)}`);
    }
}

/** A moment in milliseconds since the Unix epoch, as `Date.now()` counts it. */
export type UnixMs = number & { readonly brand: "UnixMs" };

/** Brands a count of milliseconds since the Unix epoch. */
export const unixMs = (ms: number): UnixMs => ms as UnixMs;

/** An access token, the refresh token that renews it, and when the access token expires. */
export const SpotifyTokens = z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().transform(unixMs),
});
export type SpotifyTokens = z.infer<typeof SpotifyTokens>;

/** The one stored Spotify connection: a sign-in waiting for its code, or the tokens it got. */
const StoredSpotifySchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("signingIn"), verifier: z.string().min(43), state: z.string() }),
    z.object({ kind: z.literal("connected"), tokens: SpotifyTokens }),
]);
export type StoredSpotify = z.infer<typeof StoredSpotifySchema>;

/** A stored connection read back; a missing or malformed row reads as none. */
export const parseStoredSpotify = (row: unknown): StoredSpotify | undefined => {
    const parsed = StoredSpotifySchema.safeParse(row);
    return parsed.success ? parsed.data : undefined;
};

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
