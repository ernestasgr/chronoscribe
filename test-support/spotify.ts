/**
 * A fake Spotify, shared by the Vitest and Playwright tests: its accounts service (the PKCE
 * sign-in page and token endpoint), the Web API's `GET /me`, track search and play, and the Web
 * Playback SDK. It checks what the real one checks: the client, the redirect address, the PKCE
 * verifier, refresh tokens that are used up once rotated, and the device a track is played on.
 */

import { z } from "zod";
import type { FixtureResponse } from "./lastfm";

export const ACCOUNTS_ORIGIN = "https://accounts.spotify.com";
export const API_ORIGIN = "https://api.spotify.com";
export const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
export const FIXTURE_DEVICE_ID = "fixture-device";
/** The Client ID the Playwright tests' build is made with. */
export const FIXTURE_CLIENT_ID = "fixture-client";

export interface FakeSpotifyOptions {
    clientId: string;
    redirectUri: string;
    /** Whether the account is on the app's allowlist; Spotify refuses `/me` with a 403 if not. */
    allowlisted?: boolean;
    /** Whether the user agrees on the sign-in page. */
    consents?: boolean;
    /** Whether a refresh returns a new refresh token, using up the old one, as Spotify does for PKCE. */
    rotatesRefreshTokens?: boolean;
    /** Whether the account has Premium; the SDK raises `account_error` if not. */
    premium?: boolean;
    /** Whether the browser supports DRM; the SDK raises `initialization_error` if not. */
    drm?: boolean;
    /** The tracks search finds. */
    catalogue?: readonly CatalogueTrack[];
}

/** A track on the fake Spotify. */
export interface CatalogueTrack {
    name: string;
    artists: readonly string[];
    uri: string;
    durationMs: number;
}

/** A Web API request as the fake reads it. */
export interface ApiRequest {
    url: URL;
    method: string;
    authorization: string | null;
    body: string | null;
}

/** A Web API reply; a 204 has no body. */
export interface ApiResponse {
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
}

/** A play request the fake was sent. */
export interface PlayCall {
    deviceId: string;
    uris: readonly string[];
    positionMs: number;
}

const SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-modify-playback-state",
    "user-read-playback-state",
];

const base64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");

const sha256 = async (text: string) =>
    base64url(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    );

const oauthError = (error: string, description: string, status = 400): FixtureResponse => ({
    status,
    body: { error, error_description: description },
});

const apiError = (status: number, message: string): ApiResponse => ({
    status,
    body: { error: { status, message } },
});

/** Text as loosely as Spotify's search compares it. */
const folded = (text: string) =>
    text
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();

/**
 * Whether `track` answers the search `q`: a `track:"…" artist:"…"` search needs each field to
 * hold its term; a plain search needs every word somewhere in the artists and title.
 */
function answers(track: CatalogueTrack, q: string): boolean {
    const title = folded(track.name);
    const artists = track.artists.map(folded);
    const fields = /^track:"(.*)" artist:"(.*)"$/.exec(q);
    if (fields)
        return (
            title.includes(folded(fields[1] ?? "")) &&
            artists.some((artist) => artist.includes(folded(fields[2] ?? "")))
        );
    const haystack = [...artists, title].join(" ");
    return folded(q)
        .split(/\s+/)
        .every((word) => haystack.includes(word));
}

const searchItem = (track: CatalogueTrack) => ({
    uri: track.uri,
    name: track.name,
    duration_ms: track.durationMs,
    artists: track.artists.map((name) => ({ name })),
});

const PlayBody = z.object({
    uris: z.array(z.string()).default([]),
    position_ms: z.number().default(0),
});

type Handler = (payload: unknown) => void;

export function createFakeSpotify({
    clientId,
    redirectUri,
    allowlisted = true,
    consents = true,
    rotatesRefreshTokens = true,
    premium = true,
    drm = true,
    catalogue = [],
}: FakeSpotifyOptions) {
    const codes = new Map<string, { challenge: string; redirectUri: string }>();
    const searches: string[] = [];
    const plays: PlayCall[] = [];
    const limits: { retryAfter: number | undefined } = { retryAfter: undefined };
    const refreshTokens = new Set<string>();
    const accessTokens = new Set<string>();
    const counts = { issued: 0, refreshes: 0 };

    const issue = (refreshToken?: string): FixtureResponse => {
        const n = ++counts.issued;
        const access = `access-${n}`;
        accessTokens.add(access);
        const refresh = refreshToken ?? `refresh-${n}`;
        refreshTokens.add(refresh);
        return {
            status: 200,
            body: {
                access_token: access,
                token_type: "Bearer",
                expires_in: 3600,
                scope: SCOPES.join(" "),
                ...(refreshToken === undefined ? { refresh_token: refresh } : {}),
            },
        };
    };

    async function exchange(form: URLSearchParams): Promise<FixtureResponse> {
        const code = codes.get(form.get("code") ?? "");
        if (!code) return oauthError("invalid_grant", "Invalid authorization code");
        codes.delete(form.get("code") ?? "");
        if (form.get("redirect_uri") !== code.redirectUri)
            return oauthError("invalid_grant", "Invalid redirect URI");
        if ((await sha256(form.get("code_verifier") ?? "")) !== code.challenge)
            return oauthError("invalid_grant", "code_verifier was incorrect");
        return issue();
    }

    function renew(form: URLSearchParams): FixtureResponse {
        const token = form.get("refresh_token") ?? "";
        if (!refreshTokens.has(token)) return oauthError("invalid_grant", "Refresh token revoked");
        counts.refreshes++;
        if (!rotatesRefreshTokens) return issue(token);
        refreshTokens.delete(token);
        return issue();
    }

    return {
        /**
         * Where the sign-in page sends the browser back to, for the address the app sent it to.
         * Spotify shows its own error page, not a redirect, for an unknown client or address.
         */
        async authorize(url: URL): Promise<string> {
            const params = url.searchParams;
            if (params.get("client_id") !== clientId) throw new Error("INVALID_CLIENT");
            if (params.get("redirect_uri") !== redirectUri)
                throw new Error("INVALID_CLIENT: Invalid redirect URI");
            const back = new URL(redirectUri);
            const state = params.get("state");
            if (state !== null) back.searchParams.set("state", state);
            const scopes = (params.get("scope") ?? "").split(" ");
            if (
                params.get("response_type") !== "code" ||
                params.get("code_challenge_method") !== "S256" ||
                !SCOPES.every((scope) => scopes.includes(scope))
            ) {
                back.searchParams.set("error", "invalid_request");
            } else if (!consents) {
                back.searchParams.set("error", "access_denied");
            } else {
                const code = `code-${codes.size + 1}-${crypto.randomUUID()}`;
                codes.set(code, {
                    challenge: params.get("code_challenge") ?? "",
                    redirectUri,
                });
                back.searchParams.set("code", code);
            }
            return back.toString();
        },

        /** The token endpoint's reply to a form-encoded POST. */
        async token(form: URLSearchParams): Promise<FixtureResponse> {
            if (form.get("client_id") !== clientId)
                return oauthError("invalid_client", "Invalid client", 401);
            switch (form.get("grant_type")) {
                case "authorization_code":
                    return exchange(form);
                case "refresh_token":
                    return renew(form);
                default:
                    return oauthError("unsupported_grant_type", "Unsupported grant type");
            }
        },

        /** The Web API's reply to a request. */
        api({ url, method, authorization, body }: ApiRequest): ApiResponse {
            const token = authorization?.replace(/^Bearer /, "") ?? "";
            if (!accessTokens.has(token)) return apiError(401, "Invalid access token");
            if (limits.retryAfter !== undefined)
                return {
                    ...apiError(429, "API rate limit exceeded"),
                    headers: { "retry-after": String(limits.retryAfter) },
                };
            if (!allowlisted)
                return apiError(
                    403,
                    "Check settings on developer.spotify.com/dashboard, the user may not be registered.",
                );
            const route = `${method} ${url.pathname}`;
            if (route === "GET /v1/me")
                return { status: 200, body: { id: "fixture-user", display_name: "Fixture" } };
            if (route === "GET /v1/search") {
                const q = url.searchParams.get("q") ?? "";
                const limit = Number(url.searchParams.get("limit") ?? 20);
                if (url.searchParams.get("type") !== "track" || limit > 10)
                    return apiError(400, "Invalid search");
                searches.push(q);
                const items = catalogue.filter((track) => answers(track, q)).slice(0, limit);
                return { status: 200, body: { tracks: { items: items.map(searchItem) } } };
            }
            if (route === "PUT /v1/me/player/play") {
                const deviceId = url.searchParams.get("device_id");
                if (deviceId !== FIXTURE_DEVICE_ID) return apiError(404, "Device not found");
                const play = PlayBody.parse(JSON.parse(body ?? "{}"));
                plays.push({ deviceId, uris: play.uris, positionMs: play.position_ms });
                return { status: 204 };
            }
            return apiError(404, "Service not found");
        },

        /** Every search query the fake was sent, in order. */
        searches,

        /** Every play request the fake was sent, in order. */
        plays,

        /** Answers every Web API request with a 429 asking to wait `seconds`, until called with none. */
        rateLimit(seconds: number | undefined): void {
            limits.retryAfter = seconds;
        },

        /** Whether `token` is an access token this fake issued. */
        accepts: (token: string): boolean => accessTokens.has(token),

        /** Revokes every refresh token, as when the user removes the app's access. */
        revoke(): void {
            refreshTokens.clear();
        },

        /** How many refreshes the token endpoint has granted. */
        refreshes: (): number => counts.refreshes,

        /** The SDK's player as the fake browser loads it, for the Vitest tests. */
        players: createFakePlayers({ accepts: (token) => accessTokens.has(token), premium, drm }),

        /** The SDK script the fake serves to a real browser, for the Playwright tests. */
        sdkScript: fakeSdkScript({ premium, drm }),
    };
}

export type FakeSpotify = ReturnType<typeof createFakeSpotify>;

/** Fake Web Playback SDK players that the tests can watch and drive. */
function createFakePlayers({
    accepts,
    premium,
    drm,
}: {
    accepts: (token: string) => boolean;
    premium: boolean;
    drm: boolean;
}) {
    const made: ReturnType<typeof makePlayer>[] = [];

    function makePlayer(options: {
        name: string;
        getOAuthToken: (callback: (token: string) => void) => void;
    }) {
        const handlers = new Map<string, Handler[]>();
        const player = {
            name: options.name,
            activations: 0,
            connected: false,
            addListener(event: string, handler: Handler): boolean {
                handlers.set(event, [...(handlers.get(event) ?? []), handler]);
                return true;
            },
            emit(event: string, payload: unknown): void {
                (handlers.get(event) ?? []).forEach((handler) => handler(payload));
            },
            /** Asks for a token and registers the device, or raises what the real SDK would. */
            connect(): Promise<boolean> {
                if (!drm) {
                    queueMicrotask(() =>
                        player.emit("initialization_error", {
                            message: "Failed to initialize player",
                        }),
                    );
                    return Promise.resolve(false);
                }
                return new Promise((resolve) =>
                    options.getOAuthToken((token) => {
                        player.connected = true;
                        resolve(true);
                        queueMicrotask(() => {
                            if (!accepts(token))
                                player.emit("authentication_error", {
                                    message: "Invalid token scopes.",
                                });
                            else if (!premium)
                                player.emit("account_error", {
                                    message:
                                        "This functionality is restricted to premium users only",
                                });
                            else player.emit("ready", { device_id: FIXTURE_DEVICE_ID });
                        });
                    }),
                );
            },
            disconnect(): void {
                player.connected = false;
            },
            activateElement(): Promise<void> {
                player.activations++;
                return Promise.resolve();
            },
            pauses: 0,
            resumes: 0,
            pause(): Promise<void> {
                player.pauses++;
                return Promise.resolve();
            },
            resume(): Promise<void> {
                player.resumes++;
                return Promise.resolve();
            },
            /** Asks for a token the way the SDK does whenever it needs a fresh one. */
            token(): Promise<string> {
                return new Promise((resolve) => options.getOAuthToken(resolve));
            },
        };
        return player;
    }

    return {
        made,
        create: async (options: Parameters<typeof makePlayer>[0]) => {
            const player = makePlayer(options);
            made.push(player);
            return player;
        },
        /** The most recently made player. */
        latest: () => made.at(-1),
    };
}

/**
 * The fake SDK as a script for a real browser: it defines `Spotify.Player` and calls
 * `onSpotifyWebPlaybackSDKReady`, as the real script does. The latest player is
 * `window.fakeSpotifyPlayer`, so a test can read its activations or raise events on it.
 */
function fakeSdkScript({ premium, drm }: { premium: boolean; drm: boolean }): string {
    return `(() => {
    class Player {
        constructor(options) {
            this.options = options;
            this.handlers = {};
            this.activations = 0;
            this.connected = false;
            window.fakeSpotifyPlayer = this;
        }
        addListener(event, handler) {
            (this.handlers[event] ??= []).push(handler);
            return true;
        }
        emit(event, payload) {
            (this.handlers[event] ?? []).forEach((handler) => handler(payload));
        }
        connect() {
            if (!${drm}) {
                setTimeout(() => this.emit("initialization_error", { message: "Failed to initialize player" }));
                return Promise.resolve(false);
            }
            return new Promise((resolve) =>
                this.options.getOAuthToken((token) => {
                    this.connected = true;
                    resolve(true);
                    setTimeout(() =>
                        ${premium}
                            ? this.emit("ready", { device_id: "${FIXTURE_DEVICE_ID}" })
                            : this.emit("account_error", { message: "Premium required" }),
                    );
                }),
            );
        }
        disconnect() {
            this.connected = false;
        }
        activateElement() {
            this.activations += 1;
            return Promise.resolve();
        }
        pause() {
            this.pauses = (this.pauses ?? 0) + 1;
            return Promise.resolve();
        }
        resume() {
            this.resumes = (this.resumes ?? 0) + 1;
            return Promise.resolve();
        }
    }
    window.Spotify = { Player };
    window.onSpotifyWebPlaybackSDKReady?.();
})();
`;
}

/** The fake Spotify's accounts service and Web API, as `fetch` reaches them, for the Vitest tests. */
export const fakeSpotifyFetch =
    (spotify: FakeSpotify) =>
    async (input: string, init?: RequestInit): Promise<Response> => {
        const url = new URL(input);
        const reply =
            url.origin === ACCOUNTS_ORIGIN && url.pathname === "/api/token"
                ? await spotify.token(new URLSearchParams(String(init?.body)))
                : url.origin === API_ORIGIN
                  ? spotify.api({
                        url,
                        method: init?.method ?? "GET",
                        authorization: new Headers(init?.headers).get("authorization"),
                        body: typeof init?.body === "string" ? init.body : null,
                    })
                  : undefined;
        if (!reply) throw new TypeError("unexpected host");
        const headers = "headers" in reply ? reply.headers : undefined;
        return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
            status: reply.status,
            headers,
        });
    };
