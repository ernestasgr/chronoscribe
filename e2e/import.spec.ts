import { expect, test, type Page } from "@playwright/test";
import { bristol, focusOn, importListener, serveLastfm, topX } from "./app";

test.use({ timezoneId: "UTC" });

const focusOnBristol = (page: Page, date: string) => focusOn(page, date, "2026-07-01");

test("imports a Listener and shows the Top X for a chosen Day", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
  const lastfmRequests = await serveLastfm(page, [bristol]);

  await importListener(page, "Bristol");
  expect(lastfmRequests.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);

  await focusOnBristol(page, "2026-07-03");
  await expect
    .poll(() => topX(page))
    .toEqual(["#1 Portishead · 650", "#2 Massive Attack · 600", "#3 Tricky · 200"]);

  // Massive Attack draws level on 4 July, but Portishead reached 650 first.
  await focusOnBristol(page, "2026-07-04");
  await expect
    .poll(() => topX(page))
    .toEqual(["#1 Portishead · 650", "#2 Massive Attack · 650", "#3 Tricky · 200"]);
});

test("X is a setting that survives a reload", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
  await serveLastfm(page, [bristol]);

  await importListener(page, "Bristol");

  await page.getByRole("spinbutton", { name: "X" }).fill("2");
  await focusOnBristol(page, "2026-07-03");
  await expect.poll(() => topX(page)).toEqual(["#1 Portishead · 650", "#2 Massive Attack · 600"]);

  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "X" })).toHaveValue("2");
  await focusOnBristol(page, "2026-07-03");
  await expect.poll(() => topX(page)).toEqual(["#1 Portishead · 650", "#2 Massive Attack · 600"]);
});
