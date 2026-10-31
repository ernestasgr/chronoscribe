import { expect, test, type Page, type Route } from "@playwright/test";
import { LASTFM_ORIGIN, scrobbles, type FixtureUser } from "../test-support/lastfm";
import { bristol, focusDay, focusOn, importListener, serveLastfm, topX } from "./app";

test.use({ timezoneId: "UTC" });

const IMPORTED_AT = new Date("2026-07-10T12:00:00Z");
const SYNC_AT = new Date("2026-07-13T15:00:00Z");

/** Whether a request is a Sync's: only a Sync asks for a `from`. */
const isSync = (url: string) => new URL(url).searchParams.has("from");

/** Bristol imported on IMPORTED_AT and reopened on SYNC_AT, with last.fm edited in between. */
async function importedThenReopened(page: Page) {
    const listener: FixtureUser = { ...bristol, history: [...bristol.history] };
    await page.clock.setFixedTime(IMPORTED_AT);
    await serveLastfm(page, [listener]);
    await importListener(page, "Bristol");
    // 1 July's Scrobbles were deleted on last.fm, so the history now starts on 2 July.
    listener.history = [
        ...bristol.history.filter((s) => s.uts >= Date.parse("2026-07-02T00:00:00Z") / 1000),
        ...scrobbles("Burial", 700, "2026-07-12T08:00:00Z"),
    ];
    await page.clock.setFixedTime(SYNC_AT);
    await page.reload();
    await expect(page.getByText("Synced 3 d ago")).toBeVisible();
    await focusOn(page, "2026-07-03", "2026-07-01");
    await expect
        .poll(() => topX(page))
        .toEqual(["#1 Portishead +150 650", "#2 Massive Attack +0 600", "#3 Tricky +100 200"]);
}

test("Sync reconciles the recent window and extends to today, keeping the Focus Day", async ({
    page,
}) => {
    await importedThenReopened(page);
    // Holds the Sync's requests until the chart has been used mid-Sync.
    const held: Route[] = [];
    let holding = true;
    await page.route(`${LASTFM_ORIGIN}/**`, (route) =>
        holding && isSync(route.request().url()) ? void held.push(route) : route.fallback(),
    );

    await page.getByRole("button", { name: "Sync" }).click();
    await expect(page.getByRole("status", { name: "Syncing" })).toBeVisible();
    await page.getByRole("slider", { name: "Focus Day" }).press("ArrowLeft");
    await expect(focusDay(page).getByRole("heading", { level: 2 })).toHaveText("2026-07-02");
    await page.getByRole("slider", { name: "Focus Day" }).press("ArrowRight");
    await expect.poll(() => held.length).toBeGreaterThan(0);
    holding = false;
    await Promise.all(held.map((route) => route.fallback()));

    await expect(page.getByText("Synced just now")).toBeVisible();
    await expect(page.getByRole("status", { name: "Syncing" })).toBeHidden();
    await expect(focusDay(page).getByRole("heading", { level: 2 })).toHaveText("2026-07-03");
    await expect.poll(() => topX(page)).toEqual(["#1 Portishead +150 650", "#2 Tricky +100 200"]);

    await page.getByRole("slider", { name: "Focus Day" }).press("End");
    await expect(focusDay(page).getByRole("heading", { level: 2 })).toHaveText("2026-07-13");
    await expect.poll(() => topX(page)).toContain("#1 Burial +0 700");
});

test("a failed Sync changes nothing and offers Retry", async ({ page }) => {
    await importedThenReopened(page);
    let failing = true;
    await page.route(`${LASTFM_ORIGIN}/**`, (route) =>
        failing && isSync(route.request().url())
            ? route.fulfill({
                  status: 403,
                  json: { error: 10, message: "Invalid API key" },
                  headers: { "access-control-allow-origin": "*" },
              })
            : route.fallback(),
    );

    await page.getByRole("button", { name: "Sync" }).click();

    const toast = page.getByRole("alert").filter({ hasText: "Sync failed" });
    await expect(toast).toBeVisible();
    await expect(page.getByText("Synced 3 d ago")).toBeVisible();
    await expect(focusDay(page).getByRole("heading", { level: 2 })).toHaveText("2026-07-03");
    await expect
        .poll(() => topX(page))
        .toEqual(["#1 Portishead +150 650", "#2 Massive Attack +0 600", "#3 Tricky +100 200"]);

    failing = false;
    await toast.getByRole("button", { name: "Retry" }).click();

    await expect(toast).toBeHidden();
    await expect(page.getByText("Synced just now")).toBeVisible();
    await expect.poll(() => topX(page)).toEqual(["#1 Portishead +150 650", "#2 Tricky +100 200"]);
});
