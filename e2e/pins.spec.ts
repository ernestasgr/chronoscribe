import { expect, test, type Page } from "@playwright/test";
import { bristol, focusOn, importListener, serveLastfm } from "./app";

test.use({ timezoneId: "UTC" });

const search = (page: Page) => page.getByRole("combobox", { name: "Search Artists" });

/** The names the search offers for what has been typed. */
const offered = (page: Page) =>
    page
        .locator("#artist-search-results option")
        .evaluateAll((options) => options.map((option) => option.getAttribute("value")));

const chips = (page: Page) =>
    page.getByRole("list", { name: "Pinned Artists" }).getByRole("listitem").allTextContents();

const labelled = (page: Page) =>
    page
        .getByRole("figure", { name: "Timeline" })
        .getByRole("group", { name: "Artist labels" })
        .locator("g:visible text")
        .allTextContents();

test("a pinned Artist gets a chip with their Standing and a line, and stays pinned through a reload", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");
    await page.getByRole("spinbutton", { name: "X" }).fill("1");
    await focusOn(page, "2026-07-03", "2026-07-01");

    await search(page).fill("t");
    await expect.poll(() => offered(page)).toEqual(["Portishead", "Massive Attack", "Tricky"]);
    await search(page).fill("Tricky");
    await search(page).press("Enter");

    await expect.poll(() => chips(page)).toEqual(["Tricky #3"]);
    await expect(search(page)).toHaveValue("");
    // Outside the Top X, Tricky's line is still drawn and labelled at the Focus Day.
    await expect.poll(() => labelled(page)).toEqual(["Portishead", "Tricky"]);

    await focusOn(page, "2026-07-01", "2026-07-01");
    await expect.poll(() => chips(page)).toEqual(["Tricky unranked"]);

    await page.reload();
    await focusOn(page, "2026-07-03", "2026-07-01");
    await expect.poll(() => chips(page)).toEqual(["Tricky #3"]);

    await page.getByRole("button", { name: "Unpin Tricky" }).click();
    await expect.poll(() => chips(page)).toEqual([]);
    await expect.poll(() => labelled(page)).toEqual(["Portishead"]);
});
