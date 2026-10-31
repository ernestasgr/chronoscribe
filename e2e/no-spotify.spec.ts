import { expect, test } from "@playwright/test";
import { bristol, importListener, serveLastfm } from "./app";

// This project's build has no VITE_SPOTIFY_CLIENT_ID.
test("without a Spotify Client ID, there is no Spotify and the switch stays in the app", async ({
    page,
    baseURL,
}) => {
    await serveLastfm(page, [bristol]);
    await importListener(page, "Bristol");

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Timezone")).toBeVisible();
    await expect(page.getByRole("region", { name: "Spotify" })).toHaveCount(0);

    await page.getByRole("switch", { name: "Soundtrack" }).click();
    await expect(page.getByRole("switch", { name: "Soundtrack" })).toBeChecked();
    expect(page.url()).toBe(new URL("/", baseURL).toString());
});
