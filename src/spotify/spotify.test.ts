import { describe, expect, test } from "vitest";
import { signInCallback, spotifyClientId } from ".";

describe("the build's Client ID", () => {
    test.each([[{}], [{ VITE_SPOTIFY_CLIENT_ID: "" }], [{ VITE_SPOTIFY_CLIENT_ID: "  " }]])(
        "is missing from %j, so the app has no Spotify",
        (env) => {
            expect(spotifyClientId(env)).toBeUndefined();
        },
    );

    test("is read when set", () => {
        expect(spotifyClientId({ VITE_SPOTIFY_CLIENT_ID: "abc123" })).toBe("abc123");
    });
});

describe("Spotify's answer to a sign-in", () => {
    test("is read from the address and cleared from it, keeping everything else", () => {
        expect(signInCallback("http://127.0.0.1:5273/?view=x&code=c1&state=s1#top")).toEqual({
            kind: "code",
            code: "c1",
            state: "s1",
            cleaned: "http://127.0.0.1:5273/?view=x#top",
        });
    });

    test("may be a refusal", () => {
        expect(signInCallback("http://127.0.0.1:5273/?error=access_denied&state=s1")).toEqual({
            kind: "refused",
            error: "access_denied",
            state: "s1",
            cleaned: "http://127.0.0.1:5273/",
        });
    });

    test("is absent from an ordinary address", () => {
        expect(signInCallback("http://127.0.0.1:5273/?state=s1")).toEqual({ kind: "none" });
    });
});
