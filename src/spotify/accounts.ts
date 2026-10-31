import { z } from "zod";
import {
    ACCOUNTS_ROOT,
    API_ROOT,
    bearer,
    reaching,
    unavailable,
    unixMs,
    type Fetch,
    type SpotifyFailure,
    type SpotifyResult,
    type SpotifyTokens,
    type UnixMs,
} from "./core";

/** A token endpoint reply; `refresh_token` is left out when Spotify keeps the old one. */
const TokenBody = z.object({
    access_token: z.string().min(1),
    expires_in: z.number().positive(),
    refresh_token: z.string().min(1).optional(),
});

/** An OAuth error reply from the token endpoint. */
const OAuthError = z.object({ error: z.string(), error_description: z.string().optional() });

/** A Web API error reply; a player command refused for lack of Premium says why in `reason`. */
const ApiError = z.object({
    error: z.object({ status: z.number(), message: z.string(), reason: z.string().optional() }),
});

/** The response's JSON, or undefined when the body isn't JSON (such as a proxy's error page). */
const jsonOf = (response: Response): Promise<unknown> =>
    response.json().catch((): unknown => undefined);

/** How long Spotify is waited for after a 429 that doesn't say, in seconds. */
const DEFAULT_RETRY_AFTER_S = 60;

/**
 * When a 429 lets the app ask again: after its `Retry-After`, given in seconds or as a date, or
 * a minute if it gives none.
 */
const retryAt = (response: Response, now: () => number): UnixMs => {
    const header = response.headers.get("retry-after") ?? "";
    const seconds = Number(header);
    if (header !== "" && Number.isFinite(seconds) && seconds >= 0)
        return unixMs(now() + seconds * 1000);
    const date = Date.parse(header);
    return unixMs(Number.isNaN(date) ? now() + DEFAULT_RETRY_AFTER_S * 1000 : date);
};

/** Spotify asking the app to wait, quota or not, until its `Retry-After` has passed. */
const rateLimited = (response: Response, now: () => number) =>
    ({ ok: false, error: { kind: "RateLimited", until: retryAt(response, now) } }) as const;

/** Posts a form to the token endpoint and reads the tokens it grants. */
async function requestTokens(
    form: Record<string, string>,
    fetchFn: Fetch,
    now: () => number,
    keptRefreshToken?: string,
): Promise<SpotifyResult<SpotifyTokens>> {
    return reaching(async () => {
        const response = await fetchFn(`${ACCOUNTS_ROOT}/api/token`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(form).toString(),
        });
        if (response.status === 429) return rateLimited(response, now);
        const body = await jsonOf(response);
        const refused = OAuthError.safeParse(body);
        if (refused.success)
            return refused.data.error === "invalid_grant"
                ? { ok: false, error: { kind: "SignInExpired" } }
                : unavailable(refused.data.error_description ?? refused.data.error);
        if (!response.ok) return unavailable(`HTTP ${response.status}`);
        const granted = TokenBody.safeParse(body);
        if (!granted.success) return unavailable("Malformed token reply");
        const refreshToken = granted.data.refresh_token ?? keptRefreshToken;
        if (refreshToken === undefined) return unavailable("No refresh token");
        return {
            ok: true,
            value: {
                accessToken: granted.data.access_token,
                refreshToken,
                expiresAt: unixMs(now() + granted.data.expires_in * 1000),
            },
        };
    });
}

export interface CodeExchange {
    clientId: string;
    redirectUri: string;
    code: string;
    verifier: string;
}

/** Trades the code Spotify sent back, and the verifier it was asked with, for tokens. */
export const exchangeCode = (
    { clientId, redirectUri, code, verifier }: CodeExchange,
    fetchFn: Fetch,
    now: () => number,
): Promise<SpotifyResult<SpotifyTokens>> =>
    requestTokens(
        {
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier,
        },
        fetchFn,
        now,
    );

/** Renews the tokens; a reply without a new refresh token keeps the old one. */
export const refreshTokens = (
    clientId: string,
    { refreshToken }: SpotifyTokens,
    fetchFn: Fetch,
    now: () => number,
): Promise<SpotifyResult<SpotifyTokens>> =>
    requestTokens(
        { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId },
        fetchFn,
        now,
        refreshToken,
    );

/** What a Web API 403 means: Premium missing if it says so, else an account not on the allowlist. */
const forbidden = (body: unknown): SpotifyFailure => {
    const parsed = ApiError.safeParse(body);
    return parsed.success && parsed.data.error.reason === "PREMIUM_REQUIRED"
        ? { kind: "PremiumRequired" }
        : { kind: "NotAllowlisted" };
};

/** Maps a Web API response to success or its failure; a 429, quota or not, says when to ask again. */
export async function apiResult(
    response: Response,
    now: () => number,
): Promise<SpotifyResult<unknown>> {
    const body = await jsonOf(response);
    if (response.ok) return { ok: true, value: body };
    if (response.status === 403) return { ok: false, error: forbidden(body) };
    if (response.status === 429) return rateLimited(response, now);
    const parsed = ApiError.safeParse(body);
    return unavailable(parsed.success ? parsed.data.error.message : `HTTP ${response.status}`);
}

/**
 * Checks the account can use this app: in Development Mode, Spotify refuses `GET /me` with a
 * 403 for anyone not on the allowlist. `/me` no longer says whether the account has Premium.
 */
export async function checkAccount(
    accessToken: string,
    fetchFn: Fetch,
    now: () => number,
): Promise<SpotifyResult<void>> {
    return reaching(async () => {
        const result = await apiResult(
            await fetchFn(`${API_ROOT}/me`, {
                headers: bearer(accessToken),
            }),
            now,
        );
        return result.ok ? { ok: true, value: undefined } : result;
    });
}
