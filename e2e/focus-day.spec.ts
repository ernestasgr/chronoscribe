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
        ...scrobbles("Modern Talking", 1, "2026-07-02T09:00:00Z"),
    ],
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

test("on a wide screen, a long Artist name stays in its Top X column, clear of the Climbers", async ({
    page,
}) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    await page.setViewportSize({ width: 1920, height: 1000 });
    await serveLastfm(page, [longNames]);
    await importListener(page, "Longnames");

    await focusOn(page, "2026-07-02", "2026-07-01");
    const topX = (await focusDay(page).getByRole("list", { name: "Top X" }).boundingBox())!;
    const heading = (await focusDay(page)
        .getByRole("heading", { name: "Climbers" })
        .boundingBox())!;
    expect(topX.x + topX.width).toBeLessThanOrEqual(heading.x);
});
