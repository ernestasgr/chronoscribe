import { expect, test, type Page } from "@playwright/test";
import { scrobbles, type FixtureUser } from "../test-support/lastfm";
import { bristol, focusDay, focusOn, importListener, serveLastfm } from "./app";

test.use({ timezoneId: "UTC" });

const pad = (i: number) => String(i).padStart(2, "0");

// 1 July: Act 01–12 hold #1–#12. 2 July: Late debuts last, at #13. 3 July: Late takes #1.
const deep: FixtureUser = {
    username: "Deep",
    history: [
        ...Array.from({ length: 12 }, (_, i) =>
            scrobbles(`Act ${pad(i + 1)}`, 13 - i, `2026-07-01T08:${pad(i)}:00Z`),
        ).flat(),
        ...scrobbles("Late", 1, "2026-07-02T08:00:00Z"),
        ...scrobbles("Late", 100, "2026-07-03T08:00:00Z"),
    ],
};

const spotlight = (page: Page) => page.getByRole("figure", { name: "Spotlight" });
const timeline = (page: Page) => page.getByRole("figure", { name: "Timeline" });
const card = (page: Page) => page.getByRole("region", { name: "Hovered line" });
const search = (page: Page) => page.getByRole("combobox", { name: "Spotlight an Artist" });

const axisLabels = (figure: ReturnType<typeof spotlight>) =>
    figure.getByRole("group", { name: "Standing axis" }).locator("text").allTextContents();
const timeAxis = (figure: ReturnType<typeof spotlight>) =>
    figure.getByRole("group", { name: "Time axis" }).locator("text").allTextContents();
const labelled = (figure: ReturnType<typeof spotlight>) =>
    figure
        .getByRole("group", { name: "Artist labels" })
        .locator("g:visible text")
        .allTextContents();

/** Puts the pointer on an Artist's line at the Focus Day, where their label's dot rides it. */
async function hoverLineAtFocusDay(
    figure: ReturnType<typeof spotlight>,
    page: Page,
    artist: string,
) {
    const label = figure
        .getByRole("group", { name: "Artist labels" })
        .locator("g", { hasText: artist });
    const dot = (await label.locator("circle").boundingBox())!;
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
}

async function spotlightFromSearch(page: Page, artist: string) {
    await search(page).fill(artist);
    await search(page).press("Enter");
    await expect(spotlight(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
});

test("the search opens the Spotlight on one line, the panel shows the Artist outside the Top X, and Esc closes it", async ({
    page,
}) => {
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");
    await page.getByRole("spinbutton", { name: "X" }).fill("2");
    await focusOn(page, "2026-07-03", "2026-07-01");
    const window = await timeAxis(timeline(page));

    await spotlightFromSearch(page, "Tricky");

    await expect(page.getByRole("heading", { name: "Tricky", exact: true })).toBeVisible();
    // Tricky is never worse than #3, so the axis stops at its floor of #10.
    await expect.poll(() => axisLabels(spotlight(page))).toEqual(["#1", "#2", "#5", "#10"]);
    await expect.poll(() => labelled(spotlight(page))).toEqual(["Tricky"]);
    await expect(focusDay(page).getByRole("group", { name: "Spotlit Artist" })).toHaveText(
        "#3 Tricky +100",
    );
    for (const name of ["Y axis", "Below the Top X", "Lines drawn"])
        await expect(page.getByRole("combobox", { name })).toBeDisabled();
    await expect(page.getByRole("spinbutton", { name: "X" })).toBeDisabled();
    await expect(page.getByRole("combobox", { name: "Line shape" })).toBeEnabled();

    await page.keyboard.press("Escape");

    await expect(timeline(page)).toBeVisible();
    await expect(focusDay(page).getByRole("heading", { level: 2 })).toHaveText("2026-07-03");
    expect(await timeAxis(timeline(page))).toEqual(window);
    await expect(focusDay(page).getByRole("group", { name: "Spotlit Artist" })).toBeHidden();
});

test("a line card's Spotlight opens it on that line, whose own card then opens there", async ({
    page,
}) => {
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");
    await focusOn(page, "2026-07-03", "2026-07-01");
    await hoverLineAtFocusDay(timeline(page), page, "Tricky");

    await card(page).getByRole("button", { name: "Spotlight", exact: true }).click();

    await expect(spotlight(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tricky", exact: true })).toBeVisible();
    await expect(
        focusDay(page).getByRole("list", { name: "Top X" }).locator("li[aria-current=true]"),
    ).toContainText("Tricky");
    await page.mouse.move(10, 10);
    await hoverLineAtFocusDay(spotlight(page), page, "Tricky");
    await expect(card(page).getByRole("heading", { name: "Tricky" })).toBeVisible();

    await page.getByRole("button", { name: "Close the Spotlight" }).click();
    await expect(timeline(page)).toBeVisible();
});

test("the axis reaches the worst Standing after the debut, only up to the playhead while the future is hidden", async ({
    page,
}) => {
    await serveLastfm(page, [deep]);
    await importListener(page, "Deep");

    await spotlightFromSearch(page, "Late");

    await expect.poll(() => axisLabels(spotlight(page))).toEqual(["#1", "#2", "#5", "#10", "#13"]);
    await focusOn(page, "2026-07-01", "2026-07-01");
    // Before the debut: no line, and an axis that doesn't give away where Late starts.
    await expect.poll(() => axisLabels(spotlight(page))).toEqual(["#1", "#2", "#5", "#10"]);
    await expect.poll(() => labelled(spotlight(page))).toEqual([]);
    await expect(focusDay(page).getByRole("group", { name: "Spotlit Artist" })).toHaveText(
        "unranked Late +0",
    );
});

test("a Pinned Artist's chip and a Focus Day row open the Spotlight on their Artist", async ({
    page,
}) => {
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");
    await page.getByRole("combobox", { name: "Search Artists" }).fill("Tricky");
    await page.getByRole("combobox", { name: "Search Artists" }).press("Enter");

    await page
        .getByRole("list", { name: "Pinned Artists" })
        .getByRole("button", { name: "Spotlight Tricky" })
        .click();
    await expect(page.getByRole("heading", { name: "Tricky", exact: true })).toBeVisible();

    await focusDay(page)
        .getByRole("list", { name: "Top X" })
        .getByRole("button", { name: "Portishead" })
        .click();
    await expect(page.getByRole("heading", { name: "Portishead", exact: true })).toBeVisible();
    await expect.poll(() => labelled(spotlight(page))).toEqual(["Portishead"]);
});

test("the dynamic Spotlight follows the Spotlit Artist in a band of their Neighbours, and a Neighbour's card moves the Spotlight to them", async ({
    page,
}) => {
    await serveLastfm(page, [deep]);
    await importListener(page, "Deep");
    const neighbours = page.getByRole("spinbutton", { name: "Neighbours" });
    await expect(neighbours).toBeDisabled();
    await spotlightFromSearch(page, "Late");
    const mode = page.getByRole("radiogroup", { name: "Spotlight mode" });
    await expect(mode.getByRole("radio", { name: "Static" })).toBeChecked();
    await expect(neighbours).toBeDisabled();

    await mode.getByRole("radio", { name: "Dynamic" }).click();
    await expect(neighbours).toBeEnabled();
    await neighbours.fill("2");
    await focusOn(page, "2026-07-02", "2026-07-01");

    // 2 July: Late debuts at #13, under Act 11 and Act 12; nobody is ranked below.
    await expect
        .poll(() => axisLabels(spotlight(page)))
        .toEqual(["#11", "#12", "#13", "#14", "#15"]);
    await expect.poll(() => labelled(spotlight(page))).toEqual(["Act 11", "Act 12", "Late"]);

    await hoverLineAtFocusDay(spotlight(page), page, "Act 12");
    await expect(card(page).getByRole("heading", { name: "Act 12" })).toBeVisible();
    await card(page).getByRole("button", { name: "Spotlight", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Act 12", exact: true })).toBeVisible();
    await expect(mode.getByRole("radio", { name: "Dynamic" })).toBeChecked();
    await expect
        .poll(() => axisLabels(spotlight(page)))
        .toEqual(["#10", "#11", "#12", "#13", "#14"]);
    await expect
        .poll(() => labelled(spotlight(page)))
        .toEqual(["Act 10", "Act 11", "Act 12", "Late"]);

    await page.reload();
    await expect(page.getByRole("spinbutton", { name: "Neighbours" })).toHaveValue("2");
    await expect(page.getByRole("spinbutton", { name: "Neighbours" })).toBeDisabled();
});
