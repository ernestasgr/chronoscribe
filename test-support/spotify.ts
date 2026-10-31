/**
 * A fake Spotify, shared by the Vitest and Playwright tests: its accounts service (the PKCE
 * sign-in page and token endpoint), the Web API's `GET /me`, and the Web Playback SDK. It checks
 * what the real one checks: the client, the redirect address, the PKCE verifier, and refresh
 * tokens that are used up once rotated.
 */

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

const apiError = (status: number, message: string): FixtureResponse => ({
    status,
    body: { error: { status, message } },
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
}: FakeSpotifyOptions) {
    const codes = new Map<string, { challenge: string; redirectUri: string }>();
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

        /** The Web API's reply to a request with the given `Authorization` header. */
        api(url: URL, authorization: string | null): FixtureResponse {
            const token = authorization?.replace(/^Bearer /, "") ?? "";
            if (!accessTokens.has(token)) return apiError(401, "Invalid access token");
            if (url.pathname !== "/v1/me") return apiError(404, "Service not found");
            if (!allowlisted)
                return apiError(
                    403,
                    "Check settings on developer.spotify.com/dashboard, the user may not be registered.",
                );
            return { status: 200, body: { id: "fixture-user", display_name: "Fixture" } };
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
    }
    window.Spotify = { Player };
    window.onSpotifyWebPlaybackSDKReady?.();
})();
`;
}
