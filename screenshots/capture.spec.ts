import { expect, test, type Page } from "@playwright/test";
import { API_KEY, serveLastfm } from "../e2e/app";
import { LAST_DAY, sampleListener } from "./history";

const listener = sampleListener();
const shot = (name: string) => `docs/screenshots/${name}.png`;
const timeline = (page: Page) => page.getByRole("figure", { name: "Timeline" });

/** Imports the made-up history; it is large enough that the Import takes a few seconds. */
async function importSample(page: Page) {
    await page.clock.setFixedTime(new Date(`${LAST_DAY}T20:00:00Z`));
    await serveLastfm(page, [listener]);
    await page.goto("/");
    await page.getByLabel("last.fm username").fill(listener.username);
    await page.getByLabel("API key").fill(API_KEY);
    await page.getByRole("button", { name: "Import" }).click();
    await expect(timeline(page)).toBeVisible({ timeout: 60_000 });
}

/** Moves the Focus Day to `date`, counting back from the last Day. */
async function focusOn(page: Page, date: string) {
    const slider = page.getByRole("slider", { name: "Focus Day" });
    const days = (Date.parse(LAST_DAY) - Date.parse(date)) / 86_400_000;
    await slider.press("End");
    for (let step = 0; step < days; step++) await slider.press("ArrowLeft");
}

/** Steps the Focus Day back until it lands on a Day with Climbers, so the panel lists some. */
async function toClimbingDay(page: Page) {
    const slider = page.getByRole("slider", { name: "Focus Day" });
    const nobody = page.getByText("Nobody climbed on this Day.");
    for (let step = 0; step < 60 && (await nobody.isVisible()); step++) {
        await slider.press("ArrowLeft");
        await page.waitForTimeout(50);
    }
}

/** Puts the pointer on an Artist's line just before the Focus Day, where their label's dot rides it. */
async function hoverLine(page: Page, artist: string) {
    const label = timeline(page)
        .getByRole("group", { name: "Artist labels" })
        .locator("g", { hasText: artist });
    const dot = (await label.locator("circle").boundingBox())!;
    await page.mouse.move(dot.x - 6, dot.y + dot.height / 2, { steps: 5 });
}

/** Lets the chart's glides and the panel's transitions settle before a capture. */
const settle = (page: Page) => page.waitForTimeout(1500);

test.beforeEach(async ({ page }) => {
    await importSample(page);
});

test("the timeline", async ({ page }) => {
    // Show the whole history with the playhead partway through it, playing with its Soundtrack.
    await page.getByRole("switch", { name: "Hide the future" }).click();
    await page.getByRole("switch", { name: "Soundtrack" }).click();
    await focusOn(page, "2025-11-20");
    await page.getByRole("button", { name: "Play" }).click();
    await expect(page.getByRole("status", { name: "Soundtrack" })).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shot("timeline") });
});

test("a hovered line", async ({ page }) => {
    await focusOn(page, "2025-12-14");
    await toClimbingDay(page);
    await settle(page);
    await hoverLine(page, "Moth & Lantern");
    const card = page.getByRole("region", { name: "Hovered line" });
    await expect(card.getByRole("list", { name: "Track plays" })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(card).toBeVisible();
    await page.screenshot({ path: shot("hovered-line") });
});

test("the Spotlight", async ({ page }) => {
    await focusOn(page, "2025-12-14");
    await toClimbingDay(page);
    const search = page.getByRole("combobox", { name: "Spotlight an Artist" });
    await search.fill("Juniper Kite");
    await search.press("Enter");
    await expect(page.getByRole("figure", { name: "Spotlight" })).toBeVisible();
    await page.getByRole("radio", { name: "Dynamic" }).click();
    await settle(page);
    await page.screenshot({ path: shot("spotlight") });
});
