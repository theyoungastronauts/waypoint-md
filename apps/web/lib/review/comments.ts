import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { mediaComments } from "../db/schema";
import { parseRegion, type Region } from "./region";
import { isValidTimecodeMs } from "./timecode";

/**
 * Media comments (§ media spec Phase C, decision C-2): a note on a render, either
 * anchored to a moment (and optionally to a box on that frame) or general.
 *
 * Two rules shape the module:
 *   - **Bodies are plain text.** The public page renders no markdown and no
 *     HTML; a body is stored exactly as typed and escaped wherever it is shown.
 *     Nothing here interprets it, so there is no sanitizer to get wrong.
 *   - **Authors are never taken from input.** `authorName` is copied from the
 *     review link at write time (so a later revoke does not orphan the
 *     attribution), and the route that accepts a public comment has no name
 *     field at all.
 */

/** Longest body accepted, in UTF-8 bytes (decision C-2). */
export const MAX_COMMENT_BYTES = 4096;

export interface MediaCommentRow {
  id: string;
  publicationId: string;
  reviewLinkId: string | null;
  authorName: string;
  timecodeMs: number | null;
  region: unknown;
  bodyText: string;
  createdAt: string;
  resolvedAt: string | null;
}

/** A comment as every consumer sees it: the page, the digest, and the CLI. */
export interface MediaCommentView {
  id: string;
  /** 1-based position in digest order — what `waypoint resolve <id> c3` names. */
  ordinal: number;
  authorName: string;
  timecodeMs: number | null;
  region: Region | null;
  body: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  /** True when the comment arrived through a public review link. */
  viaLink: boolean;
}

export interface AddMediaCommentInput {
  publicationId: string;
  /** Null for an author-side note made on the tailnet. */
  reviewLinkId: string | null;
  authorName: string;
  timecodeMs?: number | null;
  region?: unknown;
  body: string;
}

/** Why a comment was refused; the route maps each to a status and a message. */
export type AddCommentFailure = "empty_body" | "body_too_long" | "invalid_timecode" | "invalid_region";

export type AddCommentResult =
  | { ok: true; row: MediaCommentRow }
  | { ok: false; reason: AddCommentFailure };

/**
 * Store one comment after validating it. Validation lives here rather than only
 * in a zod schema because both doors — the public route and the authoring route
 * — must agree byte for byte about what a storable comment is.
 */
export function addMediaComment(input: AddMediaCommentInput): AddCommentResult {
  const body = input.body.trim();
  if (body.length === 0) return { ok: false, reason: "empty_body" };
  if (Buffer.byteLength(body, "utf8") > MAX_COMMENT_BYTES) {
    return { ok: false, reason: "body_too_long" };
  }

  const timecodeMs = input.timecodeMs ?? null;
  if (timecodeMs !== null && !isValidTimecodeMs(timecodeMs)) {
    return { ok: false, reason: "invalid_timecode" };
  }

  let region: Region | null = null;
  if (input.region !== undefined && input.region !== null) {
    region = parseRegion(input.region);
    if (!region) return { ok: false, reason: "invalid_region" };
  }

  const db = getDb();
  const [row] = db
    .insert(mediaComments)
    .values({
      publicationId: input.publicationId,
      reviewLinkId: input.reviewLinkId,
      authorName: input.authorName,
      timecodeMs,
      region,
      bodyText: body,
    })
    .returning()
    .all();
  return { ok: true, row: row as MediaCommentRow };
}

/**
 * Digest order (decision C-5), and the order every list is rendered in: general
 * notes first, then by timecode ascending, ties broken by creation time and then
 * by id. Total and deterministic — the ordinals an agent resolves against have
 * to mean the same thing on two consecutive calls.
 */
export function orderComments(rows: MediaCommentRow[]): MediaCommentRow[] {
  return [...rows].sort((a, b) => {
    if (a.timecodeMs === null && b.timecodeMs !== null) return -1;
    if (a.timecodeMs !== null && b.timecodeMs === null) return 1;
    if (a.timecodeMs !== null && b.timecodeMs !== null && a.timecodeMs !== b.timecodeMs) {
      return a.timecodeMs - b.timecodeMs;
    }
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Every comment on one publication, in digest order. */
export function listMediaComments(publicationId: string): MediaCommentRow[] {
  const db = getDb();
  const rows = db
    .select()
    .from(mediaComments)
    .where(eq(mediaComments.publicationId, publicationId))
    .all() as MediaCommentRow[];
  return orderComments(rows);
}

/** One comment, scoped to its publication so an id from elsewhere cannot match. */
export function getMediaComment(publicationId: string, commentId: string): MediaCommentRow | null {
  const db = getDb();
  const row = db
    .select()
    .from(mediaComments)
    .where(and(eq(mediaComments.id, commentId), eq(mediaComments.publicationId, publicationId)))
    .get() as MediaCommentRow | undefined;
  return row ?? null;
}

/** How many notes on a publication are still open (what `status` reports). */
export function countUnresolved(publicationId: string): number {
  const db = getDb();
  const rows = db
    .select({ id: mediaComments.id })
    .from(mediaComments)
    .where(
      and(eq(mediaComments.publicationId, publicationId), isNull(mediaComments.resolvedAt)),
    )
    .all();
  return rows.length;
}

/**
 * Open-note counts for many publications at once — what `waypoint status
 * --publications` prints beside each render. One query rather than one per row,
 * because the registry listing is the hot path that calls it.
 */
export function countUnresolvedByPublication(publicationIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (publicationIds.length === 0) return counts;

  const db = getDb();
  const rows = db
    .select({ publicationId: mediaComments.publicationId, id: mediaComments.id })
    .from(mediaComments)
    .where(
      and(
        inArray(mediaComments.publicationId, publicationIds),
        isNull(mediaComments.resolvedAt),
      ),
    )
    .all();
  for (const row of rows) {
    counts.set(row.publicationId, (counts.get(row.publicationId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Resolve or unresolve a note (author side only — the token gate is the whole of
 * the authorization, per decision C-2). Idempotent in both directions; returns
 * null when the comment is not on that publication.
 */
export function setCommentResolved(
  publicationId: string,
  commentId: string,
  resolved: boolean,
): MediaCommentRow | null {
  const existing = getMediaComment(publicationId, commentId);
  if (!existing) return null;
  if (resolved === (existing.resolvedAt !== null)) return existing;

  const db = getDb();
  const [row] = db
    .update(mediaComments)
    .set({ resolvedAt: resolved ? new Date().toISOString() : null })
    .where(eq(mediaComments.id, commentId))
    .returning()
    .all();
  return (row as MediaCommentRow) ?? null;
}

/** Views for an already-ordered list, numbering the ordinals from 1. */
export function toCommentViews(ordered: MediaCommentRow[]): MediaCommentView[] {
  return ordered.map((row, i) => ({
    id: row.id,
    ordinal: i + 1,
    authorName: row.authorName,
    timecodeMs: row.timecodeMs,
    region: parseRegion(row.region),
    body: row.bodyText,
    createdAt: row.createdAt,
    resolved: row.resolvedAt !== null,
    resolvedAt: row.resolvedAt,
    viaLink: row.reviewLinkId !== null,
  }));
}
