import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    use: { baseURL: "http://localhost:5273", trace: "retain-on-failure" },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
        command: "pnpm dev",
        url: "http://localhost:5273",
        reuseExistingServer: !process.env.CI,
    },
});
