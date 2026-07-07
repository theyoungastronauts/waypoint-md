import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/**
 * Resolve the data directory (SQLite file + raw uploads) from WAYPOINT_DATA_DIR,
 * defaulting to ~/.waypoint/data (§16). Created if missing.
 */
export function resolveDataDir(): string {
  const dir =
    process.env.WAYPOINT_DATA_DIR ?? path.join(os.homedir(), ".waypoint", "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export type Sqlite = Database.Database;
export type Db = ReturnType<typeof drizzle<typeof schema>>;

let sqlite: Sqlite | null = null;
let db: Db | null = null;

/** Open (once) the better-sqlite3 connection with WAL mode enabled (§6). */
export function getSqlite(): Sqlite {
  if (!sqlite) {
    const file = path.join(resolveDataDir(), "waypoint.db");
    sqlite = new Database(file);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
  }
  return sqlite;
}

/** The drizzle client, cached for the process lifetime. */
export function getDb(): Db {
  if (!db) {
    db = drizzle(getSqlite(), { schema });
  }
  return db;
}
