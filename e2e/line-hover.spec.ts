import { expect, test, type Page } from "@playwright/test";
import { bristol, focusOn, importListener, serveLastfm } from "./app";

test.use({ timezoneId: "UTC" });

const chart = (page: Page) => page.getByRole("figure", { name: "Timeline" });
const card = (page: Page) => page.getByRole("region", { name: "Hovered line" });

/** Puts the pointer on an Artist's line at the Focus Day, where their label's dot rides it. */
async function hoverLineAtFocusDay(page: Page, artist: string) {
    const label = chart(page)
        .getByRole("group", { name: "Artist labels" })
        .locator("g", { hasText: artist });
    const dot = (await label.locator("circle").boundingBox())!;
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
}

/** Each Track plays row as "track count". */
const trackPlays = (page: Page) =>
    card(page)
        .getByRole("list", { name: "Track plays" })
        .getByRole("listitem")
        .evaluateAll((rows) =>
            rows.map((row) => [...row.children].map((cell) => cell.textContent).join(" ")),
        );

test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");
});

test("hovering a line shows that Day's Daily plays, Standing and Track plays", async ({ page }) => {
    await focusOn(page, "2026-07-01", "2026-07-01");
    await hoverLineAtFocusDay(page, "Massive Attack");

    await expect(card(page).getByRole("heading", { name: "Massive Attack" })).toBeVisible();
    await expect(card(page)).toContainText("2026-07-01");
    await expect(card(page).getByRole("definition")).toHaveText(["600", "#1", "600"]);
    // 600 Scrobbles of 7 tracks in turn: the first five reach 86, and got there first.
    await expect
        .poll(() => trackPlays(page))
        .toEqual([
            "Massive Attack track 0 86",
            "Massive Attack track 1 86",
            "Massive Attack track 2 86",
            "Massive Attack track 3 86",
            "Massive Attack track 4 86",
            "Massive Attack track 5 85",
            "Massive Attack track 6 85",
        ]);
});

test("a Day the Artist didn't play says so", async ({ page }) => {
    await hoverLineAtFocusDay(page, "Tricky");

    await expect(card(page).getByRole("heading", { name: "Tricky" })).toBeVisible();
    await expect(card(page)).toContainText("2026-07-10");
    await expect(card(page).getByText("No Scrobbles this Day")).toBeVisible();
});

test("the card stays open while the pointer crosses onto it, and closes once it leaves both", async ({
    page,
}) => {
    await focusOn(page, "2026-07-03", "2026-07-01");
    await hoverLineAtFocusDay(page, "Portishead");
    await expect(card(page).getByRole("heading", { name: "Portishead" })).toBeVisible();

    const box = (await card(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.waitForTimeout(400);
    await expect(card(page)).toBeVisible();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
    await expect(card(page)).toBeHidden();
});

test("hovering opens no card while the history plays", async ({ page }) => {
    await focusOn(page, "2026-07-01", "2026-07-01");
    await page.getByRole("button", { name: "Play" }).click();
    await hoverLineAtFocusDay(page, "Massive Attack");
    await page.mouse.move(10, 10);
    await hoverLineAtFocusDay(page, "Massive Attack");

    await expect(card(page)).toBeHidden();
});
