/// <reference types="vitest/config" />
// SPIKE: serves the renderer comparison page and runs the geometry test.
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5299, strictPort: true, fs: { allow: ["../.."] } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
