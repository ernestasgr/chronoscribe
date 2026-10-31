import { ACCOUNTS_ROOT, SCOPES } from "./core";

// PKCE (RFC 7636): the verifier stays in the browser; Spotify only sees its SHA-256.

const VERIFIER_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

const randomText = (length: number): string =>
    Array.from(
        crypto.getRandomValues(new Uint8Array(length)),
        (byte) => VERIFIER_CHARACTERS[byte % VERIFIER_CHARACTERS.length],
    ).join("");

/** A fresh PKCE code verifier, 64 unreserved characters. */
export const newVerifier = (): string => randomText(64);

/** A fresh `state`, which ties Spotify's answer to the sign-in that asked. */
export const newState = (): string => randomText(16);

const base64url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");

/** The `S256` code challenge for `verifier`. */
export const challengeOf = async (verifier: string): Promise<string> =>
    base64url(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    );

export interface AuthorizeRequest {
    clientId: string;
    redirectUri: string;
    challenge: string;
    state: string;
}

/** Spotify's sign-in page, which sends the browser back to `redirectUri` with a code. */
export const authorizeUrl = ({ clientId, redirectUri, challenge, state }: AuthorizeRequest) => {
    const url = new URL(`${ACCOUNTS_ROOT}/authorize`);
    url.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        scope: SCOPES.join(" "),
        redirect_uri: redirectUri,
        code_challenge_method: "S256",
        code_challenge: challenge,
        state,
    }).toString();
    return url.toString();
};

/** What an address the app loads at says about a sign-in, with the address it leaves behind. */
export type SignInCallback =
    | { kind: "none" }
    | { kind: "code"; code: string; state: string; cleaned: string }
    | { kind: "refused"; error: string; state: string; cleaned: string };

const CALLBACK_PARAMS = ["code", "state", "error"] as const;

/** Reads Spotify's answer from the address it sent the browser back to. */
export const signInCallback = (href: string): SignInCallback => {
    const url = new URL(href);
    const params = url.searchParams;
    const code = params.get("code");
    const error = params.get("error");
    const state = params.get("state") ?? "";
    if (code === null && error === null) return { kind: "none" };
    CALLBACK_PARAMS.forEach((name) => params.delete(name));
    const cleaned = url.toString();
    return code !== null
        ? { kind: "code", code, state, cleaned }
        : { kind: "refused", error: error ?? "", state, cleaned };
};
