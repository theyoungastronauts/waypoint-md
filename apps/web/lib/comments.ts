import { capCommentAnchor, type CommentAnchor } from "@waypoint/spec";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { comments, documents } from "./db/schema";

/**
 * Selection-comment persistence (§10, §5.4). Comments live entirely in the DB —
 * `raw_md` stays immutable — and are spliced into the export on demand
 * ({@link buildReviewState} → `applyReview`). Anchors are capped on the way in
 * with the shared spec helper so a stored anchor always satisfies §5.4 caps,
 * regardless of what the client sent.
 */

export interface CommentRow {
  id: string;
  documentId: string;
  anchor: CommentAnchor;
  bodyMd: string;
  suggestionMd: string | null;
  createdAt: string;
}

export interface CreateCommentInput {
  anchor: CommentAnchor;
  bodyMd: string;
  suggestionMd?: string | null;
}

/**
 * Insert a comment for a document. Returns null when the document does not
 * exist, so the route can 404 rather than orphan a row. The anchor is capped to
 * the §5.4 limits before storage.
 */
export function createComment(documentId: string, input: CreateCommentInput): CommentRow | null {
  const db = getDb();
  const doc = db.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).get();
  if (!doc) return null;

  const anchor = capCommentAnchor(input.anchor);
  const [row] = db
    .insert(comments)
    .values({
      documentId,
      anchor,
      bodyMd: input.bodyMd,
      suggestionMd: input.suggestionMd ?? null,
    })
    .returning()
    .all();

  return toCommentRow(row);
}

export interface UpdateCommentPatch {
  bodyMd?: string;
  /** `null` removes the suggestion; omitted leaves it unchanged. */
  suggestionMd?: string | null;
}

/**
 * Edit a comment's body and/or suggestion. The anchor is immutable — re-anchoring
 * means a new comment — so it is not patchable here. Returns null when absent.
 */
export function updateComment(id: string, patch: UpdateCommentPatch): CommentRow | null {
  const db = getDb();
  const set: Record<string, unknown> = {};
  if (patch.bodyMd !== undefined) set.bodyMd = patch.bodyMd;
  if (patch.suggestionMd !== undefined) set.suggestionMd = patch.suggestionMd;
  if (Object.keys(set).length === 0) {
    const existing = db.select().from(comments).where(eq(comments.id, id)).get();
    return existing ? toCommentRow(existing) : null;
  }

  const [row] = db.update(comments).set(set).where(eq(comments.id, id)).returning().all();
  return row ? toCommentRow(row) : null;
}

/** Delete a comment. Returns true when a row was removed. */
export function deleteComment(id: string): boolean {
  const db = getDb();
  const rows = db.delete(comments).where(eq(comments.id, id)).returning({ id: comments.id }).all();
  return rows.length > 0;
}

function toCommentRow(row: typeof comments.$inferSelect): CommentRow {
  return {
    id: row.id,
    documentId: row.documentId,
    anchor: row.anchor as CommentAnchor,
    bodyMd: row.bodyMd,
    suggestionMd: row.suggestionMd,
    createdAt: row.createdAt,
  };
}
