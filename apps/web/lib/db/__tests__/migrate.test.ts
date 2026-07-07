import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Exercises the migration bootstrap directly (the same drizzle folder the app
 * runs on boot): a fresh SQLite file must come up with all seven §6 tables.
 */
const EXPECTED_TABLES = [
  "projects",
  "documents",
  "items",
  "responses",
  "comments",
  "chat_messages",
  "settings",
];

const migrationsFolder = path.join(import.meta.dirname, "..", "..", "..", "drizzle");

describe("database migrations", () => {
  let dir: string;
  let db: Database.Database;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "waypoint-migrate-"));
    db = new Database(path.join(dir, "waypoint.db"));
    db.pragma("journal_mode = WAL");
    migrate(drizzle(db), { migrationsFolder });
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates all seven §6 tables on a fresh boot", () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);

    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table);
    }
  });
});
