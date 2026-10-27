import { expect, type Page } from "@playwright/test";
import {
    LASTFM_ORIGIN,
    respondRecentTracks,
    scrobbles,
    type FixtureUser,
} from "../test-support/lastfm";

export const API_KEY = "fixture-key";

// 1,500 Scrobbles, so the import takes two pages of 1000.
export const bristol: FixtureUser = {
    username: "Bristol",
    history: [
        ...scrobbles("Massive Attack", 600, "2026-07-01T08:00:00Z"),
        ...scrobbles("Portishead", 500, "2026-07-02T08:00:00Z"),
        ...scrobbles("Tricky", 100, "2026-07-02T20:00:00Z"),
        ...scrobbles("Portishead", 150, "2026-07-03T08:00:00Z"),
        ...scrobbles("Tricky", 100, "2026-07-03T12:00:00Z"),
        ...scrobbles("Massive Attack", 50, "2026-07-04T08:00:00Z"),
    ],
    nowPlaying: { artist: "Burial", track: "Archangel", album: "Untrue" },
};

export async function serveLastfm(page: Page, users: FixtureUser[]) {
    const lastfmRequests: URL[] = [];
    // Anything leaving the machine other than to the fake last.fm is refused.
    await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
    await page.route(`${LASTFM_ORIGIN}/**`, (route) => {
        const url = new URL(route.request().url());
        lastfmRequests.push(url);
        const { status, body } = respondRecentTracks(url, users, API_KEY);
        return route.fulfill({
            status,
            json: body,
            headers: { "access-control-allow-origin": "*" },
        });
    });
    return lastfmRequests;
}

export async function importListener(page: Page, username: string) {
    await page.goto("/");
    await page.getByLabel("last.fm username").fill(username);
    await page.getByLabel("API key").fill(API_KEY);
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByRole("heading", { name: username, exact: true })).toBeVisible();
}

/** Moves the Focus Day to `date`, counting Days from `firstDay`. */
export async function focusOn(page: Page, date: string, firstDay: string) {
    const slider = page.getByRole("slider", { name: "Focus Day" });
    const day = (Date.parse(date) - Date.parse(firstDay)) / 86_400_000;
    await slider.press("Home");
    for (let step = 0; step < day; step++) await slider.press("ArrowRight");
    await expect(focusDay(page).getByRole("heading", { level: 2 })).toHaveText(date);
}

export function focusDay(page: Page) {
    return page.getByRole("region", { name: "Focus Day" });
}

export async function topX(page: Page) {
    return page.getByRole("list", { name: "Top X" }).getByRole("listitem").allTextContents();
}
