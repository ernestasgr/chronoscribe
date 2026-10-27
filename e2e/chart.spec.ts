import { expect, test, type Locator, type Page } from "@playwright/test";
import { bristol, focusDay, importListener, serveLastfm } from "./app";

test.use({ timezoneId: "UTC" });

const chart = (page: Page) => page.getByRole("figure", { name: "Timeline" });
const timeAxis = (page: Page) => chart(page).getByRole("group", { name: "Time axis" });
const marker = (page: Page) => chart(page).getByRole("group", { name: "Focus Day marker" });

/** The first and last dates labelled on the time axis. */
async function axisSpan(page: Page): Promise<[string, string]> {
    const dates = await timeAxis(page).locator("text").allTextContents();
    return [dates[0]!, dates.at(-1)!];
}

/** How many Days a span covers. */
const days = ([from, to]: [string, string]) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

/** Where on `target` a time-axis label sits, halfway down. */
async function under(page: Page, date: string, target: Locator) {
    const label = (await timeAxis(page).getByText(date, { exact: true }).boundingBox())!;
    const box = (await target.boundingBox())!;
    return { x: label.x + label.width / 2 - box.x, y: box.height / 2 };
}

test("clicking a Day on the chart makes it the Focus Day", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");

    await expect(marker(page)).toHaveText("2026-07-10");
    await chart(page).click({ position: await under(page, "2026-07-03", chart(page)) });

    await expect(focusDay(page).getByRole("heading", { level: 2 })).toHaveText("2026-07-03");
    await expect(focusDay(page).getByText("250 Scrobbles")).toBeVisible();
    await expect(marker(page)).toHaveText("2026-07-03");
});

test("the wheel zooms and dragging pans the time axis only", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");
    const standingAxis = () =>
        chart(page).getByRole("group", { name: "Standing axis" }).locator("text").allTextContents();
    const standings = await standingAxis();
    const [firstShown, lastShown] = await axisSpan(page);

    const box = (await chart(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -500);
    await expect
        .poll(async () => days(await axisSpan(page)))
        .toBeLessThan(days([firstShown, lastShown]) / 2);
    expect(await standingAxis()).toEqual(standings);

    const zoomed = await axisSpan(page);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await axisSpan(page))[0] < zoomed[0]).toBe(true);
    expect(days(await axisSpan(page))).toBeCloseTo(days(zoomed), -1);
    // A drag isn't a click: the Focus Day stays put, now out of view.
    await expect(focusDay(page).getByRole("heading", { level: 2 })).toHaveText("2026-09-30");
    await expect(marker(page)).toBeHidden();
});
