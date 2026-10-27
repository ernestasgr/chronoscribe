import { expect, test, type Page } from "@playwright/test";
import { bristol, focusDay, focusOn, importListener, serveLastfm } from "./app";

test.use({ timezoneId: "UTC" });

const FIRST_DAY = "2026-07-01";

/** Imports Bristol with the page's clock faked and stopped, so only `runFor` moves time. */
async function openWithClock(page: Page) {
    await page.clock.install({ time: new Date("2026-07-31T12:00:00Z") });
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");
    await page.clock.pauseAt(new Date("2026-07-31T13:00:00Z"));
}

const heading = (page: Page) => focusDay(page).getByRole("heading", { level: 2 });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
/** Hands the keyboard back to the page, out of whichever control has it. */
const blur = (page: Page) =>
    page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test("Space plays the history at the chosen speed and pauses it", async ({ page }) => {
    await openWithClock(page);
    await focusOn(page, FIRST_DAY, FIRST_DAY);
    await blur(page);

    // At the default 0.1 s per Day, half a second plays 5 Days.
    await page.keyboard.press(" ");
    await expect(button(page, "Pause")).toBeVisible();
    await page.clock.runFor(500);
    await expect(heading(page)).toHaveText("2026-07-06");
    await expect(focusDay(page).getByText("0 Scrobbles")).toBeVisible();

    await page.keyboard.press(" ");
    await expect(button(page, "Play")).toBeVisible();
    await page.clock.runFor(1000);
    await expect(heading(page)).toHaveText("2026-07-06");
    const labels = page.getByRole("group", { name: "Artist labels" });
    await expect(labels.getByText("Portishead", { exact: true })).toBeVisible();
    await expect(labels.getByText("Tricky", { exact: true })).toBeVisible();

    // At 0.02 s per Day, a second plays past the last Day, and playback stops there.
    await page.getByLabel("Speed").fill("0.02");
    await button(page, "Play").click();
    await page.clock.runFor(1000);
    await expect(heading(page)).toHaveText("2026-07-31");
    await expect(button(page, "Play")).toBeVisible();
});

/** How many painted pixels the chart's canvas has right of the Focus Day marker. */
const paintedAhead = (page: Page) =>
    page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>("figure canvas")!;
        const marker = document.querySelector('[aria-label="Focus Day marker"] line')!;
        const scale = canvas.width / canvas.getBoundingClientRect().width;
        const markerX = marker.getBoundingClientRect().left - canvas.getBoundingClientRect().left;
        const left = Math.ceil((markerX + 3) * scale);
        const { data } = canvas
            .getContext("2d")!
            .getImageData(left, 0, canvas.width - left, canvas.height);
        return data.filter((_, i) => i % 4 === 3 && data[i]! > 0).length;
    });

test("the future is hidden ahead of the playhead until switched off", async ({ page }) => {
    await openWithClock(page);
    await focusOn(page, "2026-07-02", FIRST_DAY);
    const hide = page.getByRole("switch", { name: "Hide the future" });
    await expect(hide).toBeChecked();
    expect(await paintedAhead(page)).toBe(0);

    await hide.click();
    await expect.poll(() => paintedAhead(page)).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByRole("switch", { name: "Hide the future" })).not.toBeChecked();
});

test("stepping glides by the step size, which survives a reload", async ({ page }) => {
    await openWithClock(page);
    await focusOn(page, "2026-07-03", FIRST_DAY);

    await button(page, "1w").click();
    await blur(page);
    await page.keyboard.press(".");
    await page.clock.runFor(100);
    await expect(heading(page)).not.toHaveText("2026-07-10");
    await page.clock.runFor(900);
    await expect(heading(page)).toHaveText("2026-07-10");

    // Steps taken during a glide add up, and stop at the first Day.
    await page.keyboard.press(",");
    await page.keyboard.press(",");
    await page.clock.runFor(1000);
    await expect(heading(page)).toHaveText(FIRST_DAY);

    await button(page, "30d").click();
    await button(page, "Step forward").click();
    await page.clock.runFor(1000);
    await expect(heading(page)).toHaveText("2026-07-31");
    await page.getByRole("spinbutton", { name: "Step size" }).fill("2");
    await button(page, "Step back").click();
    await page.clock.runFor(1000);
    await expect(heading(page)).toHaveText("2026-07-29");
    await expect(focusDay(page).getByText("0 Scrobbles")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("spinbutton", { name: "Step size" })).toHaveValue("2");
});
