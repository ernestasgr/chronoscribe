import { defineConfig, devices } from "@playwright/test";

/** Captures the README's screenshots over a made-up history; run it with `pnpm screenshots`. */
const ORIGIN = "http://127.0.0.1:5282";

export default defineConfig({
    testDir: "screenshots",
    use: {
        ...devices["Desktop Chrome"],
        baseURL: ORIGIN,
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 2,
        timezoneId: "UTC",
        colorScheme: "light",
    },
    webServer: {
        command: `pnpm exec vite --port ${new URL(ORIGIN).port}`,
        url: ORIGIN,
        reuseExistingServer: false,
        // Built without Spotify, so the screenshots show no sign-in to an account.
        env: { VITE_SPOTIFY_CLIENT_ID: "" },
    },
});
