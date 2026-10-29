import { expect, test, type Page, type Route } from "@playwright/test";
import { LASTFM_ORIGIN, scrobbles, type FixtureUser } from "../test-support/lastfm";
import { API_KEY, bristol, focusDay, focusOn, importListener, serveLastfm } from "./app";

test.use({ timezoneId: "UTC" });

// 1,200 Scrobbles, so their import takes two pages of 1000.
const bath: FixtureUser = {
    username: "Bath",
    history: scrobbles("Goldfrapp", 1200, "2026-07-05T08:00:00Z"),
};

const isBathPageTwo = (url: string) => {
    const { searchParams } = new URL(url);
    return searchParams.get("user") === "Bath" && searchParams.get("page") === "2";
};

// The menu is named after the button that opened it.
const listenerMenu = (page: Page) => page.getByRole("menu");

/** Opens the Listener menu from the toolbar's Listener, or from an import's screen. */
async function openMenu(page: Page, trigger: string) {
    await page.getByRole("button", { name: trigger, exact: true }).click();
    await expect(listenerMenu(page)).toBeVisible();
}

const listed = (page: Page, username: string) =>
    listenerMenu(page).getByRole("menuitemradio", { name: new RegExp(`^${username}`) });

async function addListener(page: Page, from: string, username: string) {
    await openMenu(page, from);
    await listenerMenu(page).getByRole("menuitem", { name: "Add Listener…" }).click();
    await page.getByLabel("last.fm username").fill(username);
    await page.getByLabel("API key").fill(API_KEY);
    await page.getByRole("button", { name: "Import" }).click();
}

const focusDayHeading = (page: Page) => focusDay(page).getByRole("heading", { level: 2 });

test("a new Listener imports in the background while another is viewed, and switching resets the view", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await serveLastfm(page, [bristol, bath]);
    // Holds Bath's second page until Bristol has been viewed mid-import.
    const held: Route[] = [];
    let holding = true;
    await page.route(`${LASTFM_ORIGIN}/**`, (route) =>
        holding && isBathPageTwo(route.request().url()) ? void held.push(route) : route.fallback(),
    );
    await importListener(page, "Bristol");

    await addListener(page, "Bristol", "Bath");
    await expect(page.getByRole("heading", { name: "Importing Bath" })).toBeVisible();
    await expect.poll(() => held.length).toBe(1);
    await openMenu(page, "Listeners");
    await listed(page, "Bristol").click();

    await expect(page.getByRole("heading", { name: "Bristol", exact: true })).toBeVisible();
    await focusOn(page, "2026-07-03", "2026-07-01");
    await openMenu(page, "Bristol");
    await expect(listed(page, "Bath")).toContainText("Importing 1,000 / 1,200");
    await expect(listed(page, "Bristol")).toContainText("Synced just now");
    await expect(listed(page, "Bristol")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    holding = false;
    await Promise.all(held.map((route) => route.fallback()));

    await openMenu(page, "Bristol");
    await expect(listed(page, "Bath")).toContainText("Synced just now");
    await listed(page, "Bath").click();
    await expect(page.getByRole("heading", { name: "Bath", exact: true })).toBeVisible();
    await expect(focusDayHeading(page)).toHaveText("2026-07-10");

    await openMenu(page, "Bath");
    await listed(page, "Bristol").click();
    await expect(page.getByRole("heading", { name: "Bristol", exact: true })).toBeVisible();
    await expect(focusDayHeading(page)).toHaveText("2026-07-10");

    // Boot opens the Listener viewed last.
    await openMenu(page, "Bristol");
    await listed(page, "Bath").click();
    await expect(page.getByRole("heading", { name: "Bath", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Bath", exact: true })).toBeVisible();
});

test("a username already added is refused, whatever its case", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    const requests = await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");
    const before = requests.length;

    await addListener(page, "Bristol", "BRISTOL");

    await expect(page.getByLabel("last.fm username")).toHaveAccessibleDescription(
        "BRISTOL is already a Listener",
    );
    expect(requests).toHaveLength(before);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Bristol", exact: true })).toBeVisible();
});

test("removing Listeners deletes their Scrobbles, then shows setup once none are left", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await serveLastfm(page, [bristol, bath]);
    await importListener(page, "Bristol");
    await addListener(page, "Bristol", "Bath");
    await expect(page.getByRole("heading", { name: "Bath", exact: true })).toBeVisible();

    await openMenu(page, "Bath");
    await listenerMenu(page).getByRole("menuitem", { name: "Remove…" }).click();
    const prompt = page.getByRole("alertdialog");
    await expect(prompt).toContainText("Delete 1,200 Scrobbles for Bath?");
    await prompt.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByRole("heading", { name: "Bristol", exact: true })).toBeVisible();
    await openMenu(page, "Bristol");
    await expect(listenerMenu(page).getByRole("menuitemradio")).toHaveCount(1);
    await listenerMenu(page).getByRole("menuitem", { name: "Remove…" }).click();
    await expect(prompt).toContainText("Delete 1,500 Scrobbles for Bristol?");
    await prompt.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByRole("heading", { name: "Add a Listener" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Add a Listener" })).toBeVisible();
});
