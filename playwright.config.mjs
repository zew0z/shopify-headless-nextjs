import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.mjs",
  timeout: 60_000,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
});
