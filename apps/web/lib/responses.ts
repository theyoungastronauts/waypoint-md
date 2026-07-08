import type { ResponseValue } from "@waypoint/spec";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { documents, items, responses } from "./db/schema";
import { responseHasContent } from "./review-status";

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
 *
 * Side effect (W4): the first real answer on a `pending` document advances it to
 * `in_review`, so the queue's in-review bucket populates through normal use. The
 * transition fires here (not only in the UI) so an API/CLI answer advances it too.
 */
export function upsertResponse(
  itemId: string,
  value: ResponseBody,
  status: string | null,
): StoredResponse | null {
  const db = getDb();
  const item = db
    .select({ id: items.id, documentId: items.documentId })
    .from(items)
    .where(eq(items.id, itemId))
    .get();
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

  // Advance pending → in_review on the first real touch (content or a status).
  // Empty saves — e.g. clearing a draft — do not count as engagement.
  if (responseHasContent(value) || status !== null) {
    const doc = db
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, item.documentId))
      .get();
    if (doc?.status === "pending") {
      db
        .update(documents)
        .set({ status: "in_review", updatedAt })
        .where(eq(documents.id, item.documentId))
        .run();
    }
  }

  return { itemId, value, status, updatedAt };
}
