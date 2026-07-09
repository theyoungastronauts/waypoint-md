import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Exercises the migration bootstrap directly (the same drizzle folder the app
 * runs on boot): a fresh SQLite file must come up with the seven §6 tables plus
 * the publish feature's `publications` table and its FTS5 index + sync triggers.
 */
const EXPECTED_TABLES = [
  "projects",
  "documents",
  "items",
  "responses",
  "comments",
  "chat_messages",
  "settings",
  "publications",
  "attachments",
];

const EXPECTED_TRIGGERS = ["publications_fts_ai", "publications_fts_ad", "publications_fts_au"];

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

  it("creates the core tables plus publications on a fresh boot", () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);

    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table);
    }
  });

  it("creates the publications FTS index and its content-sync triggers", () => {
    const ftsRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'publications_fts'")
      .all() as Array<{ name: string }>;
    expect(ftsRows).toHaveLength(1);

    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .all() as Array<{ name: string }>;
    const names = triggers.map((t) => t.name);
    for (const trigger of EXPECTED_TRIGGERS) {
      expect(names).toContain(trigger);
    }
  });
});
