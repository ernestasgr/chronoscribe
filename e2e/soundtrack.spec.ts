import { expect, test, type Page } from "@playwright/test";
import { scrobbles, type FixtureUser } from "../test-support/lastfm";
import { focusDay, focusOn, importListener, serveLastfm } from "./app";

test.use({ timezoneId: "UTC" });

const FIRST_DAY = "2026-07-02";

// In 1-week Windows from 2 July: Portishead's Window, then Tricky's, then an empty one.
const wildBunch: FixtureUser = {
    username: "WildBunch",
    history: [
        ...scrobbles("Portishead", 10, "2026-07-02T08:00:00Z"),
        ...scrobbles("Massive Attack", 4, "2026-07-08T08:00:00Z"),
        ...scrobbles("Tricky", 10, "2026-07-09T08:00:00Z"),
    ],
};

// Air's Sexy Boy and Talisman tie at 3 plays, and Bonobo's Kerala has 4: the artist pick takes Air's
// top track, the track pick takes Kerala.
const pickUser: FixtureUser = {
    username: "PickUser",
    history: [
        ...plays("Air", "Sexy Boy", 3, "2026-07-02T08:00:00Z"),
        ...plays("Air", "Talisman", 3, "2026-07-02T09:00:00Z"),
        ...plays("Bonobo", "Kerala", 4, "2026-07-02T10:00:00Z"),
    ],
};

/** `count` plays of one track, a minute apart from `startIso`. */
function plays(artist: string, track: string, count: number, startIso: string) {
    return scrobbles(artist, count, startIso).map((scrobble) => ({ ...scrobble, track }));
}

/** Imports `user` with the page's clock faked and stopped, so only `runFor` moves time. */
async function openWithClock(page: Page, user: FixtureUser = wildBunch) {
    await page.clock.install({ time: new Date("2026-07-31T12:00:00Z") });
    await serveLastfm(page, [user]);
    await importListener(page, user.username);
    await page.clock.pauseAt(new Date("2026-07-31T13:00:00Z"));
}

const heading = (page: Page) => focusDay(page).getByRole("heading", { level: 2 });
const soundtrack = (page: Page) => page.getByRole("status", { name: "Soundtrack" });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test("while playing, the Player names each Window's Soundtrack", async ({ page }) => {
    await openWithClock(page);
    const toggle = page.getByRole("switch", { name: "Soundtrack" });
    await expect(toggle).not.toBeChecked();
    await expect(page.getByRole("spinbutton", { name: "Window size" })).toHaveValue("30");

    await toggle.click();
    await button(page, "1w Windows").click();
    await focusOn(page, FIRST_DAY, FIRST_DAY);
    await expect(soundtrack(page)).toBeHidden();

    // At the default 0.1 s per Day, half a second plays 5 Days, still in the first Window.
    await button(page, "Play").click();
    await page.clock.runFor(500);
    await expect(heading(page)).toHaveText("2026-07-07");
    await expect(soundtrack(page)).toHaveText("♪ Portishead track 0 — Portishead");

    // Crossing into 9 July's Window brings in its Soundtrack.
    await page.clock.runFor(300);
    await expect(heading(page)).toHaveText("2026-07-10");
    await expect(soundtrack(page)).toHaveText("♪ Tricky track 0 — Tricky");

    // The empty Window from 16 July keeps the one before.
    await page.clock.runFor(700);
    await expect(heading(page)).toHaveText("2026-07-17");
    await expect(soundtrack(page)).toHaveText("♪ Tricky track 0 — Tricky");

    // Paused, the line goes; switched off, it stays gone while playing.
    await button(page, "Pause").click();
    await expect(soundtrack(page)).toBeHidden();
    await toggle.click();
    await button(page, "Play").click();
    await page.clock.runFor(200);
    await expect(soundtrack(page)).toBeHidden();
});

test("the Soundtrack switch and Window size survive a reload", async ({ page }) => {
    await openWithClock(page);
    await page.getByRole("switch", { name: "Soundtrack" }).click();
    await page.getByRole("spinbutton", { name: "Window size" }).fill("90");
    await expect(page.getByRole("button", { name: "90d Windows" })).toHaveAttribute(
        "aria-pressed",
        "true",
    );

    await page.reload();
    await expect(page.getByRole("switch", { name: "Soundtrack" })).toBeChecked();
    await expect(page.getByRole("spinbutton", { name: "Window size" })).toHaveValue("90");
});

test("the Pick chooses the Soundtrack by its Artist or outright, and survives a reload", async ({
    page,
}) => {
    await openWithClock(page, pickUser);
    await page.getByRole("switch", { name: "Soundtrack" }).click();
    await button(page, "1w Windows").click();
    await focusOn(page, FIRST_DAY, FIRST_DAY);
    const pick = page.getByRole("combobox", { name: "Pick" });
    await expect(pick).toHaveValue("artist");

    await button(page, "Play").click();
    await expect(soundtrack(page)).toHaveText("♪ Sexy Boy — Air");

    await pick.selectOption("track");
    await expect(soundtrack(page)).toHaveText("♪ Kerala — Bonobo");

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Pick" })).toHaveValue("track");
});
