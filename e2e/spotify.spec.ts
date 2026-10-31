import { expect, test, type Page } from "@playwright/test";
import { bristol, importListener, serveLastfm } from "./app";
import { fakePlayer, serveSpotify } from "./spotify";

const soundtrackSwitch = (page: Page) => page.getByRole("switch", { name: "Soundtrack" });
const spotifyStatus = (page: Page) =>
    page.getByRole("region", { name: "Spotify" }).getByRole("status");

async function openSettings(page: Page) {
    await page.getByRole("button", { name: "Settings" }).click();
}

test("the Soundtrack switch signs in to Spotify, and Disconnect signs out", async ({
    page,
    baseURL,
}) => {
    await serveLastfm(page, [bristol]);
    await serveSpotify(page, baseURL);
    await importListener(page, "Bristol");
    await openSettings(page);
    await expect(spotifyStatus(page)).toHaveText(
        "Not connected. Turning the Soundtrack on signs you in.",
    );

    // Off to Spotify's sign-in page and back to the root, with the code taken out of the address.
    await soundtrackSwitch(page).click();
    await page.waitForURL((url) => url.searchParams.size === 0 && url.pathname === "/");
    await expect(page.getByRole("heading", { name: "Bristol", exact: true })).toBeVisible();
    expect(page.url()).toBe(new URL("/", baseURL).toString());

    await expect(soundtrackSwitch(page)).toBeChecked();
    await openSettings(page);
    await expect(spotifyStatus(page)).toHaveText("Connected. This tab is ready to play.");
    expect(await fakePlayer(page)).toMatchObject({ connected: true });

    // The Play button's click unlocks the tab's audio.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await fakePlayer(page))?.activations).toBe(1);

    // A reload stays connected without visiting Spotify's sign-in page again.
    await page.reload();
    await openSettings(page);
    await expect(spotifyStatus(page)).toHaveText("Connected. This tab is ready to play.");

    await page.getByRole("button", { name: "Disconnect Spotify" }).click();
    await expect(spotifyStatus(page)).toHaveText(
        "Not connected. Turning the Soundtrack on signs you in.",
    );
    expect(await fakePlayer(page)).toMatchObject({ connected: false });
    await page.reload();
    await openSettings(page);
    await expect(spotifyStatus(page)).toHaveText(
        "Not connected. Turning the Soundtrack on signs you in.",
    );
});

test("an account not on the allowlist turns the Soundtrack off and says why", async ({
    page,
    baseURL,
}) => {
    await serveLastfm(page, [bristol]);
    await serveSpotify(page, baseURL, { allowlisted: false });
    await importListener(page, "Bristol");

    await soundtrackSwitch(page).click();

    await expect(page.getByRole("alert")).toContainText(
        "This Spotify account isn't on Chronoscribe's allowlist",
    );
    await expect(soundtrackSwitch(page)).not.toBeChecked();
    await openSettings(page);
    await expect(spotifyStatus(page)).toHaveText(
        "Not connected. Turning the Soundtrack on signs you in.",
    );
    // The chart keeps working.
    await expect(page.getByRole("list", { name: "Top X" })).toBeVisible();
});
