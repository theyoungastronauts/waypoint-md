import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { settings } from "./db/schema";

/**
 * The `settings` key/value store (§6) — model choice, theme, and other
 * non-secret runtime preferences. Never holds secrets (§15): tokens and API
 * keys live in env only.
 */

/** Read a setting; null when it has never been written. */
export function getSetting(key: string): string | null {
  const row = getDb().select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

/** Create or replace a setting (last write wins). */
export function setSetting(key: string, value: string): void {
  getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}
