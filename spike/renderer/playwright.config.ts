// SPIKE: runs the renderer benchmark in Chromium against the spike's own dev server.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "bench.spec.ts",
  timeout: 300_000,
  workers: 1,
  use: { baseURL: "http://localhost:5299", ...devices["Desktop Chrome"], viewport: { width: 1280, height: 640 } },
  webServer: { command: "npx vite", url: "http://localhost:5299", reuseExistingServer: true },
});
