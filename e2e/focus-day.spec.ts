import { expect, test, type Page } from "@playwright/test";
import { scrobbles, type FixtureUser } from "../test-support/lastfm";
import { bristol, focusDay, focusOn, importListener, serveLastfm } from "./app";

const pad = (i: number) => String(i).padStart(2, "0");

// 1 July: Big 00–54 hold #1–#55 on 3 Scrobbles each, Tail 00–09 hold #56–#65 on 1 each.
// 2 July: New debuts at #2, Big 54 jumps to #1, and Tail 08 and Tail 09 jump within the tail.
const longtail: FixtureUser = {
    username: "Longtail",
    history: [
        ...Array.from({ length: 55 }, (_, i) =>
            scrobbles(`Big ${pad(i)}`, 3, `2026-07-01T08:${pad(i)}:00Z`),
        ).flat(),
        ...Array.from({ length: 10 }, (_, i) =>
            scrobbles(`Tail ${pad(i)}`, 1, `2026-07-01T10:${pad(i)}:00Z`),
        ).flat(),
        ...scrobbles("Big 54", 2, "2026-07-02T08:00:00Z"),
        ...scrobbles("New", 4, "2026-07-02T08:30:00Z"),
        ...scrobbles("Tail 08", 2, "2026-07-02T09:00:00Z"),
        ...scrobbles("Tail 09", 1, "2026-07-02T10:00:00Z"),
    ],
};

// Long names don't widen Top X: they're truncated, as the Climbers beside them need the room.
const longNames: FixtureUser = {
    username: "Longnames",
    history: [
        ...scrobbles(
            "Huey Lewis & The News Greatest Hits Live In Concert",
            40,
            "2026-07-01T08:00:00Z",
        ),
        ...scrobbles("Modern Talking", 30, "2026-07-01T09:00:00Z"),
        ...scrobbles(
            "Huey Lewis & The News Greatest Hits Live In Concert",
            3,
            "2026-07-02T08:00:00Z",
        ),
        ...scrobbles("Kim Wilde", 2, "2026-07-01T10:00:00Z"),
        ...scrobbles("Modern Talking", 1, "2026-07-02T09:00:00Z"),
        ...scrobbles("Kim Wilde", 35, "2026-07-02T10:00:00Z"),
    ],
};

const at = (day: string, minutes: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + minutes * 60_000).toISOString();
const many = (i: number) => `Many ${String(i).padStart(3, "0")}`;

// 1 July: Many 000–299 hold #1–#300 on 1 Scrobble each, in the order they played.
// 2 July: each plays once more, last first, so Many 299–150 climb from ↑299 down to ↑1.
const crowd: FixtureUser = {
    username: "Crowd",
    history: [
        ...Array.from({ length: 300 }, (_, i) => scrobbles(many(i), 1, at("2026-07-01", i))),
        ...Array.from({ length: 300 }, (_, i) => scrobbles(many(299 - i), 1, at("2026-07-02", i))),
    ].flat(),
};

test.use({ timezoneId: "UTC" });

const climbers = (page: Page) =>
    focusDay(page).getByRole("list", { name: "Climbers" }).getByRole("listitem").allTextContents();

const dailyPlaysBars = (page: Page) =>
    focusDay(page)
        .getByRole("list", { name: "Top X" })
        .getByRole("meter", { name: "Daily plays" })
        .evaluateAll((bars) => bars.map((bar) => bar.getAttribute("aria-valuenow")));

test("the Focus Day panel reports the Day's Scrobbles, Daily plays and Climbers", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");

    await focusOn(page, "2026-07-03", "2026-07-01");
    await expect(focusDay(page).getByText("250 Scrobbles")).toBeVisible();
    // Portishead, Massive Attack and Tricky, in Top X order
    await expect.poll(() => dailyPlaysBars(page)).toEqual(["150", "0", "100"]);
    await expect.poll(() => climbers(page)).toEqual(["#1 Portishead ↑1"]);

    // Every Day through today is on the timeline, even with nothing played.
    await focusOn(page, "2026-07-10", "2026-07-01");
    await expect(focusDay(page).getByText("0 Scrobbles")).toBeVisible();
    await expect.poll(() => climbers(page)).toEqual([]);
});

test("Climbers fold the long tail by default, and the mode survives a reload", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-02T12:00:00Z"));
    await serveLastfm(page, [longtail]);
    await importListener(page, "Longtail");

    await focusOn(page, "2026-07-02", "2026-07-01");
    const mode = page.getByRole("combobox", { name: "Climbers" });
    await expect(mode).toHaveValue("fold");
    await expect.poll(() => climbers(page)).toEqual(["#2 New ↑64 debut", "#1 Big 54 ↑54"]);
    const summary = focusDay(page).getByText("2 long-tail jumps beyond #50 (1 on a single play)");
    await expect(summary).toBeVisible();
    await summary.click();
    await expect
        .poll(() =>
            focusDay(page)
                .getByRole("list", { name: "Long-tail Climbers" })
                .getByRole("listitem")
                .allTextContents(),
        )
        .toEqual(["#57 Tail 08 ↑7", "#58 Tail 09 ↑7"]);

    await mode.selectOption({ label: "within Top 50" });
    await expect.poll(() => climbers(page)).toEqual(["#2 New ↑64 debut", "#1 Big 54 ↑54"]);
    await expect(summary).toBeHidden();

    await mode.selectOption({ label: "all (raw)" });
    await expect
        .poll(() => climbers(page))
        .toEqual(["#2 New ↑64 debut", "#1 Big 54 ↑54", "#57 Tail 08 ↑7", "#58 Tail 09 ↑7"]);

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Climbers" })).toHaveValue("all");
    await focusOn(page, "2026-07-02", "2026-07-01");
    await expect.poll(() => climbers(page)).toHaveLength(4);
});

test("a long list of Climbers scrolls in its own box, showing the rows scrolled to", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-07-02T12:00:00Z"));
    await serveLastfm(page, [crowd]);
    await importListener(page, "Crowd");
    await page.getByRole("combobox", { name: "Climbers" }).selectOption({ label: "all (raw)" });

    await focusOn(page, "2026-07-02", "2026-07-01");
    const list = focusDay(page).getByRole("list", { name: "Climbers" });
    const rows = list.getByRole("listitem");
    await expect(rows.first()).toHaveText("#1 Many 299 ↑299");
    await expect(rows.first()).toHaveAttribute("aria-setsize", "150");
    expect(await rows.count()).toBeLessThan(150);

    await list.hover();
    await page.mouse.wheel(0, 10_000);
    await expect(list.getByRole("button", { name: "Spotlight Many 150" })).toBeInViewport();
    await expect(rows.last()).toHaveText("#150 Many 150 ↑1");
    await expect(rows.last()).toHaveAttribute("aria-posinset", "150");
});

test("on a wide screen, the columns sit side by side with room between them, and no row overflows", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await page.setViewportSize({ width: 1920, height: 1000 });
    await serveLastfm(page, [longNames]);
    await importListener(page, "Longnames");

    await focusOn(page, "2026-07-02", "2026-07-01");
    const topX = focusDay(page).getByRole("list", { name: "Top X" });
    const climbersHeading = focusDay(page).getByRole("heading", { name: "Climbers" });
    const climbersList = focusDay(page).getByRole("list", { name: "Climbers" });
    await expect(climbersList).toBeVisible();

    const column = (await topX.boundingBox())!;
    const heading = (await climbersHeading.boundingBox())!;
    expect(heading.x - (column.x + column.width)).toBeGreaterThanOrEqual(24);
    // The Climbers list starts just under its heading, not down where the Top X list ends.
    const list = (await climbersList.boundingBox())!;
    expect(list.y - heading.y).toBeLessThan(60);

    const overflowing = await focusDay(page)
        .locator('[aria-label="Top X"] > li, [aria-label="Climbers"] > li')
        .evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth).length);
    expect(overflowing).toBe(0);
});
