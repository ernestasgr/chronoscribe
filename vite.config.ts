/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    worker: { format: "es" },
    // Spotify accepts only 127.0.0.1, not localhost, as a local redirect address.
    server: { host: "127.0.0.1", port: 5273, strictPort: true },
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
    },
});
