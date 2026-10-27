import { expect, test, type Page } from "@playwright/test";
import { scrobbles, type FixtureUser } from "../test-support/lastfm";
import { bristol, focusOn, importListener, serveLastfm } from "./app";

test.use({ timezoneId: "UTC" });

// A plays 40 times on 1 July and 400 more on 3 July; B trails on 2 July.
const grower: FixtureUser = {
    username: "Grower",
    history: [
        ...scrobbles("A", 40, "2026-07-01T08:00:00Z"),
        ...scrobbles("B", 5, "2026-07-02T08:00:00Z"),
        ...scrobbles("A", 400, "2026-07-03T08:00:00Z"),
    ],
};

const chart = (page: Page) => page.getByRole("figure", { name: "Timeline" });
const option = (page: Page, name: string) => page.getByRole("combobox", { name });
const axisLabels = (page: Page, name: string) =>
    chart(page).getByRole("group", { name }).locator("text").allTextContents();

const OPTIONS = {
    "Y axis": ["Standing", "Scrobbles"],
    "Below the Top X": ["gutter", "slide off", "log axis"],
    "Line shape": ["S-curves", "straight", "monotone", "Catmull-Rom", "smoothed (basis)"],
    "Lines drawn": ["30-Day warm-up", "no warm-up", "at least 7 Days in Top X"],
};

/** The label of each chart option's selected choice. */
const chosen = (page: Page) =>
    Promise.all(
        Object.keys(OPTIONS).map((name) =>
            option(page, name).evaluate((select: HTMLSelectElement) =>
                select.selectedOptions[0]!.textContent!.trim(),
            ),
        ),
    );

test("chart options offer the spec's choices, start at its defaults and survive a reload", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");

    for (const [name, labels] of Object.entries(OPTIONS))
        await expect(option(page, name).locator("option")).toHaveText(labels);
    expect(await chosen(page)).toEqual(["Standing", "gutter", "S-curves", "30-Day warm-up"]);

    await option(page, "Below the Top X").selectOption({ label: "log axis" });
    await option(page, "Line shape").selectOption({ label: "Catmull-Rom" });
    await option(page, "Lines drawn").selectOption({ label: "at least 7 Days in Top X" });
    await option(page, "Y axis").selectOption({ label: "Scrobbles" });

    await page.reload();
    await expect(chart(page)).toBeVisible();
    expect(await chosen(page)).toEqual([
        "Scrobbles",
        "log axis",
        "Catmull-Rom",
        "at least 7 Days in Top X",
    ]);
    await expect(chart(page).getByRole("group", { name: "Scrobbles axis" })).toBeVisible();
});

test("the Scrobbles axis eases to the most Scrobbles drawn up to the playhead", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-07-04T12:00:00Z"));
    await serveLastfm(page, [grower]);
    await importListener(page, "Grower");

    await option(page, "Y axis").selectOption({ label: "Scrobbles" });
    await expect(chart(page).getByRole("group", { name: "Standing axis" })).toBeHidden();
    await expect.poll(async () => (await axisLabels(page, "Scrobbles axis")).at(-1)).toBe("400");

    await focusOn(page, "2026-07-01", "2026-07-01");
    await expect.poll(async () => (await axisLabels(page, "Scrobbles axis")).at(-1)).toBe("40");
});

test("the Standing axis follows the Below the Top X option", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");
    await page.getByRole("spinbutton", { name: "X" }).fill("2");

    await expect.poll(() => axisLabels(page, "Standing axis")).toEqual(["#1", "#2", "below"]);
    await option(page, "Below the Top X").selectOption({ label: "slide off" });
    await expect.poll(() => axisLabels(page, "Standing axis")).toEqual(["#1", "#2"]);
    await option(page, "Below the Top X").selectOption({ label: "log axis" });
    await expect.poll(() => axisLabels(page, "Standing axis")).toEqual(["#1", "#2", "#3"]);
});
