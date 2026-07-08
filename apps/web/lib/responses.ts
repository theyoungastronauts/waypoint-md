import type { ResponseValue } from "@waypoint/spec";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { items, responses } from "./db/schema";

/** The persisted answer body (no status — that lives in its own column). */
export type ResponseBody = Pick<ResponseValue, "text" | "selected" | "other">;

export interface StoredResponse {
  itemId: string;
  value: ResponseBody | null;
  status: string | null;
  updatedAt: string;
}

/**
 * Upsert the reviewer's answer for one item — the autosave target behind
 * `PUT /api/items/:id/response` (§8). One row per item (the item id is the
 * primary key), so this is a create-or-replace. Returns null when the item does
 * not exist so the route can 404.
 *
 * `raw_md` is never touched: all review state lives here and is spliced into the
 * export on demand (§6 invariant).
 */
export function upsertResponse(
  itemId: string,
  value: ResponseBody,
  status: string | null,
): StoredResponse | null {
  const db = getDb();
  const item = db.select({ id: items.id }).from(items).where(eq(items.id, itemId)).get();
  if (!item) return null;

  const updatedAt = new Date().toISOString();
  db
    .insert(responses)
    .values({ itemId, value, status, updatedAt })
    .onConflictDoUpdate({
      target: responses.itemId,
      set: { value, status, updatedAt },
    })
    .run();

  return { itemId, value, status, updatedAt };
}
