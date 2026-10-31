import { expect, test, type Page } from "@playwright/test";
import { scrobbles, type FixtureUser } from "../test-support/lastfm";
import { focusDay, focusOn, importListener, serveLastfm } from "./app";
import { fakePlayer, serveSpotify } from "./spotify";

test.use({ timezoneId: "UTC" });

const FIRST_DAY = "2026-07-02";

// In 1-week Windows from 2 July: Portishead's Window, then Tricky's, then an empty one.
const wildBunch: FixtureUser = {
    username: "WildBunch",
    history: [
        ...scrobbles("Portishead", 10, "2026-07-02T08:00:00Z"),
        ...scrobbles("Tricky", 10, "2026-07-09T08:00:00Z"),
    ],
};

const CATALOGUE = [
    {
        name: "Portishead track 0",
        artists: ["Portishead"],
        uri: "spotify:track:portishead",
        durationMs: 240_000,
    },
    // Short, so it starts a third of the way in; titled differently, as remasters are.
    {
        name: "Tricky track 0 - Remastered 2011",
        artists: ["TRICKY"],
        uri: "spotify:track:tricky",
        durationMs: 60_000,
    },
];

/** Turns the Soundtrack on, which signs in to Spotify and back, and waits for this tab's device. */
async function signIn(page: Page) {
    await Promise.all([
        page.waitForURL((url) => url.searchParams.has("code"), { waitUntil: "commit" }),
        page.getByRole("switch", { name: "Soundtrack" }).click(),
    ]);
    await expect(page.getByRole("heading", { name: "WildBunch", exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Soundtrack" })).toBeChecked();
    await expect.poll(async () => (await fakePlayer(page))?.connected).toBe(true);
}

const heading = (page: Page) => focusDay(page).getByRole("heading", { level: 2 });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test("the Soundtrack plays on Spotify as the history crosses Windows, pausing and resuming with it", async ({
    page,
    baseURL,
}) => {
    await page.clock.install({ time: new Date("2026-07-31T12:00:00Z") });
    await serveLastfm(page, [wildBunch]);
    const spotify = await serveSpotify(page, baseURL, { catalogue: CATALOGUE });
    await importListener(page, "WildBunch");

    await signIn(page);
    await page.clock.pauseAt(new Date("2026-07-31T13:00:00Z"));

    // A Day a second, so each week-long Window plays for 7 seconds.
    await button(page, "1w Windows").click();
    await page.getByRole("spinbutton", { name: "Speed" }).fill("1");
    await focusOn(page, FIRST_DAY, FIRST_DAY);
    const played = () => spotify.plays.map(({ uris, positionMs }) => [uris[0], positionMs]);
    expect(played()).toEqual([]);

    await button(page, "Play").click();
    await expect.poll(played).toEqual([["spotify:track:portishead", 30_000]]);

    // Paused and played again in the same Window, it carries on.
    await page.clock.runFor(3_000);
    await button(page, "Pause").click();
    await expect.poll(async () => (await fakePlayer(page))?.pauses).toBe(1);
    await button(page, "Play").click();
    await expect.poll(async () => (await fakePlayer(page))?.resumes).toBe(1);
    expect(played()).toHaveLength(1);

    // Into 9 July's Window: Tricky's short track, a third of the way in.
    await page.clock.runFor(5_000);
    await expect(heading(page)).toHaveText("2026-07-10");
    await expect.poll(played).toEqual([
        ["spotify:track:portishead", 30_000],
        ["spotify:track:tricky", 20_000],
    ]);

    // Paused, moved back to the first Window and played again: its Soundtrack starts over.
    await button(page, "Pause").click();
    await expect.poll(async () => (await fakePlayer(page))?.pauses).toBe(2);
    await focusOn(page, FIRST_DAY, FIRST_DAY);
    await button(page, "Play").click();
    // Tricky was sent under 2 s ago on the page's stopped clock, so Portishead waits its turn.
    await page.clock.runFor(2_000);
    await expect.poll(played).toEqual([
        ["spotify:track:portishead", 30_000],
        ["spotify:track:tricky", 20_000],
        ["spotify:track:portishead", 30_000],
    ]);
    expect((await fakePlayer(page))?.resumes).toBe(1);
    // Each track was searched for once.
    expect(spotify.searches).toEqual([
        'track:"Portishead track 0" artist:"Portishead"',
        'track:"Tricky track 0" artist:"Tricky"',
    ]);
});

test("a 429 turns the Soundtrack off and says when it can go back on", async ({
    page,
    baseURL,
}) => {
    await page.clock.install({ time: new Date("2026-07-31T12:00:00Z") });
    await serveLastfm(page, [wildBunch]);
    const spotify = await serveSpotify(page, baseURL, { catalogue: CATALOGUE });
    await importListener(page, "WildBunch");
    await signIn(page);
    await page.clock.pauseAt(new Date("2026-07-31T13:00:00Z"));

    spotify.rateLimit(600);
    await focusOn(page, FIRST_DAY, FIRST_DAY);
    await button(page, "Play").click();

    const toggle = page.getByRole("switch", { name: "Soundtrack" });
    await expect(page.getByRole("alert")).toContainText("Spotify asked Chronoscribe to slow down");
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAccessibleDescription(/Spotify asked to wait: back on at/);

    // Ten minutes on, it can be turned back on.
    spotify.rateLimit(undefined);
    await page.clock.runFor(600_000);
    await expect(toggle).toBeEnabled();
});
