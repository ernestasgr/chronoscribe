import { expect, test, type Page } from "@playwright/test";
import type { FixtureUser } from "../test-support/lastfm";
import { API_KEY, bristol, importListener, serveLastfm } from "./app";

const hidden: FixtureUser = { username: "Hidden", history: [], hidden: true };

async function submitSetup(page: Page, username: string, apiKey = API_KEY) {
    await page.goto("/");
    await page.getByLabel("last.fm username").fill(username);
    await page.getByLabel("API key").fill(apiKey);
    await page.getByRole("button", { name: "Import" }).click();
}

const probesOf = (requests: URL[]) =>
    requests.filter((url) => url.searchParams.get("limit") === "1");

test.describe("in Vilnius", () => {
    test.use({ timezoneId: "Europe/Vilnius" });

    test("the setup form offers the browser's timezone", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("combobox", { name: "Timezone" })).toHaveValue(
            "Europe/Vilnius",
        );
    });
});

test("an unknown username is named under the username field", async ({ page }) => {
    const requests = await serveLastfm(page, [bristol]);

    await submitSetup(page, "Nobody");

    await expect(page.getByLabel("last.fm username")).toHaveAccessibleDescription(
        "No last.fm user named Nobody",
    );
    await expect(page.getByLabel("last.fm username")).toHaveAttribute("aria-invalid", "true");
    expect(requests.map((url) => url.searchParams.get("limit"))).toEqual(["1"]);
});

test("an invalid API key is flagged under the key, with a link to create one", async ({ page }) => {
    await serveLastfm(page, [bristol]);

    await submitSetup(page, "Bristol", "wrong-key");

    await expect(page.getByLabel("API key")).toHaveAccessibleDescription(
        /This API key isn't valid/,
    );
    await expect(page.getByRole("link", { name: "Create an API key" })).toHaveAttribute(
        "href",
        "https://www.last.fm/api/account/create",
    );
});

test("a private history says so and how to unhide it", async ({ page }) => {
    await serveLastfm(page, [hidden]);

    await submitSetup(page, "Hidden");

    const username = page.getByLabel("last.fm username");
    await expect(username).toHaveAccessibleDescription(/Hidden's listening history is private/);
    await expect(username).toHaveAccessibleDescription(/Hide recent listening information/);
});

test.describe("Settings", () => {
    test.use({ timezoneId: "UTC" });

    test("a new API key is probed before it is saved", async ({ page }) => {
        await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
        const requests = await serveLastfm(page, [bristol]);
        await importListener(page, "Bristol");
        await page.getByRole("button", { name: "Settings" }).click();
        const key = page.getByRole("textbox", { name: "API key" });

        await key.fill("wrong-key");
        await page.getByRole("button", { name: "Save key" }).click();
        await expect(key).toHaveAccessibleDescription(/This API key isn't valid/);
        expect(probesOf(requests).at(-1)?.searchParams.get("api_key")).toBe("wrong-key");

        await page.reload();
        await page.getByRole("button", { name: "Settings" }).click();
        await expect(key).toHaveValue(API_KEY);

        await key.fill(` ${API_KEY} `);
        await page.getByRole("button", { name: "Save key" }).click();
        await expect(page.getByRole("status").filter({ hasText: "API key saved" })).toBeVisible();
        expect(probesOf(requests)).toHaveLength(3);
    });

    test("a new timezone rebuilds the Days with no re-import", async ({ page }) => {
        await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
        const requests = await serveLastfm(page, [bristol]);
        await importListener(page, "Bristol");
        const fetched = requests.length;
        const slider = page.getByRole("slider", { name: "Focus Day" });
        const focusDate = page.getByRole("region", { name: "Focus Day" }).getByRole("heading", {
            level: 2,
        });
        await slider.press("Home");
        await expect(focusDate).toHaveText("2026-07-01");

        await page.getByRole("button", { name: "Settings" }).click();
        // 08:00 UTC on 1 July is 22:00 on 30 June in Honolulu.
        await expect(slider).toHaveAttribute("aria-valuemax", "9");
        await page.getByRole("combobox", { name: "Timezone" }).selectOption("Pacific/Honolulu");

        // The rebuild has landed once 30 June adds a Day; Home pressed before then finds 1 July.
        await expect(slider).toHaveAttribute("aria-valuemax", "10");
        await slider.press("Home");
        await expect(focusDate).toHaveText("2026-06-30");
        await page.reload();
        await page.getByRole("slider", { name: "Focus Day" }).press("Home");
        await expect(focusDate).toHaveText("2026-06-30");
        expect(requests).toHaveLength(fetched);
    });
});
