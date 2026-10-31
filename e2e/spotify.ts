import type { Page, Route } from "@playwright/test";
import {
    ACCOUNTS_ORIGIN,
    API_ORIGIN,
    createFakeSpotify,
    FIXTURE_CLIENT_ID,
    SDK_URL,
    type FakeSpotifyOptions,
} from "../test-support/spotify";

const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
};

/** Answers a CORS preflight, which the browser sends before a request with `Authorization`. */
const preflighted = (route: Route) =>
    route.request().method() === "OPTIONS"
        ? route.fulfill({ status: 204, headers: CORS }).then(() => true)
        : Promise.resolve(false);

/**
 * Serves the fake Spotify to the page: its sign-in page, token endpoint, Web API and SDK. Call it
 * after `serveLastfm`, so its routes are tried before that one's refusal of every other host.
 */
export async function serveSpotify(
    page: Page,
    baseURL: string | undefined,
    options: Partial<FakeSpotifyOptions> = {},
) {
    const spotify = createFakeSpotify({
        clientId: FIXTURE_CLIENT_ID,
        redirectUri: new URL("/", baseURL).toString(),
        ...options,
    });
    await page.route(/^https:\/\/accounts\.spotify\.com\/authorize\b/, async (route) => {
        const answer = await spotify
            .authorize(new URL(route.request().url()))
            .then((location) => ({ status: 302, headers: { location } }))
            .catch((error: unknown) => ({ status: 400, body: String(error) }));
        return route.fulfill(answer);
    });
    await page.route(`${ACCOUNTS_ORIGIN}/api/token`, async (route) => {
        if (await preflighted(route)) return;
        const form = new URLSearchParams(route.request().postData() ?? "");
        const { status, body } = await spotify.token(form);
        return route.fulfill({ status, json: body, headers: CORS });
    });
    await page.route(`${API_ORIGIN}/**`, async (route) => {
        if (await preflighted(route)) return;
        const request = route.request();
        const { status, body } = spotify.api(
            new URL(request.url()),
            (await request.headerValue("authorization")) ?? null,
        );
        return route.fulfill({ status, json: body, headers: CORS });
    });
    await page.route(SDK_URL, (route) =>
        route.fulfill({ contentType: "text/javascript", body: spotify.sdkScript }),
    );
    return spotify;
}

/** The fake SDK's latest player in the page, as `window.fakeSpotifyPlayer` exposes it. */
export const fakePlayer = (page: Page) =>
    page.evaluate(() => {
        // cast: the fake SDK script puts its player on `window`, which the page's types don't know.
        const player = (window as unknown as Record<string, unknown>).fakeSpotifyPlayer as
            | { connected: boolean; activations: number }
            | undefined;
        return player && { connected: player.connected, activations: player.activations };
    });
