import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke config (§17 item 5). Runs the import → answer → export happy
 * path (plus the browser-only bits: keyboard nav, a selection comment, and the
 * mobile bottom sheet) against a REAL running server — `next dev` booted here,
 * writing to a throwaway data dir so the smoke never touches real data. This is
 * wired to `pnpm test:e2e`, deliberately separate from `pnpm test` (the fast
 * unit/route standing gate).
 */

const PORT = Number(process.env.WAYPOINT_E2E_PORT ?? 3123);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Fresh SQLite + upload store per run, in the OS temp dir.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "waypoint-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      // Pixel 5 is a Chromium-based mobile device (touch + narrow viewport), so
      // the smoke needs only the one browser engine installed.
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    // cwd defaults to this config's directory (apps/web), so `./drizzle`
    // migrations resolve and `pnpm exec` finds the local `next` binary.
    command: `pnpm exec next dev --port ${PORT} --hostname 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      WAYPOINT_DATA_DIR: DATA_DIR,
      // Force AI features off so the smoke is deterministic regardless of a
      // developer's local ANTHROPIC_API_KEY (override wins; §14 degradation).
      ANTHROPIC_API_KEY: "",
      // Open mode — no login wall in front of the smoke.
      WAYPOINT_TOKEN: "",
    },
  },
});
