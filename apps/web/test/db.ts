import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Test-only helper (never imported by the app). Points the singleton DB client
 * at a throwaway SQLite file and runs the committed migrations against it.
 *
 * Env is set before any route handler calls `getDb()` (handlers resolve the DB
 * lazily), so each test file gets an isolated database. Call the returned
 * cleanup in `afterAll`.
 */
export async function setupTestDb(): Promise<() => void> {
  const dir = mkdtempSync(path.join(tmpdir(), "waypoint-web-test-"));
  process.env.WAYPOINT_DATA_DIR = dir;
  // Migrations resolve their folder from cwd (apps/web) or this override; tests
  // run from the repo root, so point at the committed drizzle folder explicitly.
  process.env.WAYPOINT_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "..", "drizzle");

  const { runMigrations } = await import("../lib/db/migrate");
  runMigrations();

  return () => {
    rmSync(dir, { recursive: true, force: true });
  };
}
