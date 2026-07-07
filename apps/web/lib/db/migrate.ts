import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "./client";

/**
 * Resolve the committed drizzle migrations folder. In dev / `next start` the
 * cwd is apps/web, so `./drizzle` works; the Docker image sets an absolute
 * WAYPOINT_MIGRATIONS_DIR because the standalone server runs from a different cwd.
 */
export function migrationsFolder(): string {
  return process.env.WAYPOINT_MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle");
}

/** Apply pending migrations. Called on boot from instrumentation.ts (§6). */
export function runMigrations(): void {
  migrate(getDb(), { migrationsFolder: migrationsFolder() });
}
