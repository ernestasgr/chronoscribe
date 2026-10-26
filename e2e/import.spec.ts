import { expect, test, type Page } from "@playwright/test";
import {
  LASTFM_ORIGIN,
  scrobbles,
  respondRecentTracks,
  type FixtureUser,
} from "../test-support/lastfm";

const API_KEY = "fixture-key";

// 1,500 Scrobbles, so the import takes two pages of 1000.
const bristol: FixtureUser = {
  username: "Bristol",
  history: [
    ...scrobbles("Massive Attack", 600, "2026-07-01T08:00:00Z"),
    ...scrobbles("Portishead", 500, "2026-07-02T08:00:00Z"),
    ...scrobbles("Tricky", 100, "2026-07-02T20:00:00Z"),
    ...scrobbles("Portishead", 150, "2026-07-03T08:00:00Z"),
    ...scrobbles("Tricky", 100, "2026-07-03T12:00:00Z"),
    ...scrobbles("Massive Attack", 50, "2026-07-04T08:00:00Z"),
  ],
  nowPlaying: { artist: "Burial", track: "Archangel", album: "Untrue" },
};

test.use({ timezoneId: "UTC" });

async function serveLastfm(page: Page, users: FixtureUser[]) {
  const lastfmRequests: URL[] = [];
  // Anything leaving the machine other than to the fake last.fm is refused.
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await page.route(`${LASTFM_ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    lastfmRequests.push(url);
    const { status, body } = respondRecentTracks(url, users, API_KEY);
    return route.fulfill({ status, json: body, headers: { "access-control-allow-origin": "*" } });
  });
  return lastfmRequests;
}

async function importBristol(page: Page) {
  await page.goto("/");
  await page.getByLabel("last.fm username").fill("Bristol");
  await page.getByLabel("API key").fill(API_KEY);
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: "Bristol", exact: true })).toBeVisible();
}

async function focusOn(page: Page, date: string) {
  const slider = page.getByRole("slider", { name: "Focus Day" });
  const day = (Date.parse(date) - Date.parse("2026-07-01")) / 86_400_000;
  await slider.fill(String(day));
  await expect(page.getByRole("region", { name: "Focus Day" }).getByRole("heading")).toHaveText(
    date,
  );
}

async function topX(page: Page) {
  return page.getByRole("list", { name: "Top X" }).getByRole("listitem").allTextContents();
}

test("imports a Listener and shows the Top X for a chosen Day", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
  const lastfmRequests = await serveLastfm(page, [bristol]);

  await importBristol(page);
  expect(lastfmRequests.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);

  await focusOn(page, "2026-07-03");
  await expect
    .poll(() => topX(page))
    .toEqual(["#1 Portishead · 650", "#2 Massive Attack · 600", "#3 Tricky · 200"]);

  // Massive Attack draws level on 4 July, but Portishead reached 650 first.
  await focusOn(page, "2026-07-04");
  await expect
    .poll(() => topX(page))
    .toEqual(["#1 Portishead · 650", "#2 Massive Attack · 650", "#3 Tricky · 200"]);
});

test("X is a setting that survives a reload", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
  await serveLastfm(page, [bristol]);

  await importBristol(page);

  await page.getByRole("spinbutton", { name: "X" }).fill("2");
  await focusOn(page, "2026-07-03");
  await expect.poll(() => topX(page)).toEqual(["#1 Portishead · 650", "#2 Massive Attack · 600"]);

  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "X" })).toHaveValue("2");
  await focusOn(page, "2026-07-03");
  await expect.poll(() => topX(page)).toEqual(["#1 Portishead · 650", "#2 Massive Attack · 600"]);
});
