import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;

/**
 * AUD-FE-01 E2E harness. Runs against `vite dev` (not a production build) —
 * the app only registers its own service worker when import.meta.env.PROD is
 * true (main.tsx), so dev mode leaves that worker slot free for MSW's, which
 * webServer's VITE_E2E=1 activates instead. No backend/DB is started; every
 * request the app makes is intercepted by MSW (src/mocks/handlers.ts).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { VITE_E2E: "1" },
  },
});
