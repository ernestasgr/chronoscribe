import { expect, test, type Page } from "@playwright/test";
import { LASTFM_ORIGIN } from "../test-support/lastfm";
import { API_KEY, bristol, focusOn, importListener, serveLastfm, topX } from "./app";

test.use({ timezoneId: "UTC" });

const isPageTwo = (url: string) => new URL(url).searchParams.get("page") === "2";

const focusOnBristol = (page: Page, date: string) => focusOn(page, date, "2026-07-01");

test("imports a Listener and shows the Top X for a chosen Day", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    const lastfmRequests = await serveLastfm(page, [bristol]);

    await importListener(page, "Bristol");
    const pages = lastfmRequests.filter((url) => url.searchParams.get("limit") === "1000");
    expect(pages.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);

    await focusOnBristol(page, "2026-07-03");
    await expect
        .poll(() => topX(page))
        .toEqual(["#1 Portishead · 650", "#2 Massive Attack · 600", "#3 Tricky · 200"]);

    // Massive Attack draws level on 4 July, but Portishead reached 650 first.
    await focusOnBristol(page, "2026-07-04");
    await expect
        .poll(() => topX(page))
        .toEqual(["#1 Portishead · 650", "#2 Massive Attack · 650", "#3 Tricky · 200"]);
});

test("X is a setting that survives a reload", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await serveLastfm(page, [bristol]);

    await importListener(page, "Bristol");

    await page.getByRole("spinbutton", { name: "X" }).fill("2");
    await focusOnBristol(page, "2026-07-03");
    await expect.poll(() => topX(page)).toEqual(["#1 Portishead · 650", "#2 Massive Attack · 600"]);

    await page.reload();
    await expect(page.getByRole("spinbutton", { name: "X" })).toHaveValue("2");
    await focusOnBristol(page, "2026-07-03");
    await expect.poll(() => topX(page)).toEqual(["#1 Portishead · 650", "#2 Massive Attack · 600"]);
});

test("reloading mid-import resumes it and finishes with every Scrobble", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    const lastfmRequests = await serveLastfm(page, [bristol]);
    // Leaves the first request for page 2 unanswered, so the reload lands mid-import.
    const pageTwoRequested = page.waitForRequest((request) => isPageTwo(request.url()));
    let held = false;
    await page.route(`${LASTFM_ORIGIN}/**`, (route) => {
        if (held || !isPageTwo(route.request().url())) return route.fallback();
        held = true;
    });

    await page.goto("/");
    await page.getByLabel("last.fm username").fill("Bristol");
    await page.getByLabel("API key").fill(API_KEY);
    await page.getByRole("button", { name: "Import" }).click();
    await pageTwoRequested;
    await expect(page.getByRole("status")).toContainText("1,000 / 1,500 Scrobbles");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Bristol", exact: true })).toBeVisible();

    // Page 1 ended on Massive Attack's 501st Scrobble, whose second is fetched again on resuming.
    const oldestOfPageOne = Date.parse("2026-07-01T08:00:00Z") / 1000 + 500 * 60;
    const resumed = lastfmRequests.filter((url) => url.searchParams.get("limit") === "1000").at(-1);
    expect(Object.fromEntries(resumed!.searchParams)).toMatchObject({
        page: "1",
        to: String(oldestOfPageOne + 1),
    });
    await focusOnBristol(page, "2026-07-04");
    await expect
        .poll(() => topX(page))
        .toEqual(["#1 Portishead · 650", "#2 Massive Attack · 650", "#3 Tricky · 200"]);
});
