import { defineConfig, devices } from "@playwright/test";

// A dedicated port so tests never talk to some other dev server by accident.
const PORT = Number(process.env.E2E_PORT ?? 5312);

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  // More than three at once (the default is half the cores) starves the one dev server
  // and workerd, and tests time out at random.
  workers: 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `pnpm exec vite dev --port ${PORT} --strictPort`,
    env: { GG_DEV_LOGS: "0" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
