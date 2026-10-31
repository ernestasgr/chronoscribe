import { defineConfig, devices } from "@playwright/test";
import { FIXTURE_CLIENT_ID } from "./test-support/spotify";

/**
 * Each build the tests need gets its own server, on its own port, so a dev server running with
 * a real Client ID is never reused: one built with the fake Spotify's, and one built without.
 */
const SPOTIFY = "http://127.0.0.1:5280";
const NO_SPOTIFY = "http://127.0.0.1:5281";

/** The tests that run against the build without Spotify, where the switch only names the Soundtrack. */
const WITHOUT_SPOTIFY = /(no-spotify|soundtrack)\.spec\.ts$/;

const server = (url: string, clientId: string) => ({
    command: `pnpm exec vite --port ${new URL(url).port}`,
    url,
    reuseExistingServer: !process.env.CI,
    env: { VITE_SPOTIFY_CLIENT_ID: clientId },
});

export default defineConfig({
    testDir: "e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    use: { trace: "retain-on-failure" },
    projects: [
        {
            name: "chromium",
            testIgnore: WITHOUT_SPOTIFY,
            use: { ...devices["Desktop Chrome"], baseURL: SPOTIFY },
        },
        {
            name: "no-spotify",
            testMatch: WITHOUT_SPOTIFY,
            use: { ...devices["Desktop Chrome"], baseURL: NO_SPOTIFY },
        },
    ],
    webServer: [server(SPOTIFY, FIXTURE_CLIENT_ID), server(NO_SPOTIFY, "")],
});
