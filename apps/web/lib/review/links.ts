import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { constantTimeEqual } from "../auth";
import { getDb } from "../db/client";
import { reviewLinks } from "../db/schema";
import { getPublication, type PublicationRow } from "../publications";

/**
 * Review links (§ media spec Phase C, decision C-1): the capability that makes a
 * media publication reviewable by one named person, off the tailnet.
 *
 * Three properties define the model:
 *   - **The name is bound to the link.** A comment's author comes from the link
 *     the request arrived on, never from the body, so attribution cannot be
 *     spoofed by anyone who has the URL.
 *   - **The link is scoped to a group, not a publication.** Jay's v1 link opens
 *     v2 when the studio publishes it, because a version stack is one
 *     conversation. A link with no group opens exactly its own publication.
 *   - **Everything that fails, fails as 404.** An unknown token, a revoked one,
 *     and one aimed at another group are indistinguishable from the outside:
 *     the public surface never confirms that a publication exists.
 */

/** Token size in bytes; rendered hex, so the `?k=` value is 64 characters. */
const TOKEN_BYTES = 32;

export interface ReviewLinkRow {
  id: string;
  publicationId: string;
  reviewerName: string;
  token: string;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
}

/** A link as the authoring UI shows it — the token included, since it is the URL. */
export interface ReviewLinkView {
  id: string;
  reviewerName: string;
  token: string;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  revoked: boolean;
}

export function toReviewLinkView(row: ReviewLinkRow): ReviewLinkView {
  return {
    id: row.id,
    reviewerName: row.reviewerName,
    token: row.token,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    lastSeenAt: row.lastSeenAt,
    revoked: row.revokedAt !== null,
  };
}

/** Mint a link for one named reviewer against one publication. */
export function createReviewLink(publicationId: string, reviewerName: string): ReviewLinkRow {
  const db = getDb();
  const [row] = db
    .insert(reviewLinks)
    .values({
      publicationId,
      reviewerName: reviewerName.trim(),
      token: randomBytes(TOKEN_BYTES).toString("hex"),
    })
    .returning()
    .all();
  return row as ReviewLinkRow;
}

/** Every link minted against one publication, oldest first. */
export function listReviewLinks(publicationId: string): ReviewLinkRow[] {
  const db = getDb();
  return db
    .select()
    .from(reviewLinks)
    .where(eq(reviewLinks.publicationId, publicationId))
    .orderBy(asc(reviewLinks.createdAt))
    .all() as ReviewLinkRow[];
}

/**
 * Kill one link. Idempotent: an already-revoked link keeps its first timestamp,
 * and the publication plus every comment made through the link are untouched
 * (decision Q5 — revoking a leaked URL must not cost the review).
 * Returns null when the link does not belong to that publication.
 */
export function revokeReviewLink(publicationId: string, linkId: string): ReviewLinkRow | null {
  const db = getDb();
  const existing = db
    .select()
    .from(reviewLinks)
    .where(and(eq(reviewLinks.id, linkId), eq(reviewLinks.publicationId, publicationId)))
    .get() as ReviewLinkRow | undefined;
  if (!existing) return null;
  if (existing.revokedAt) return existing;

  const [row] = db
    .update(reviewLinks)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(reviewLinks.id, linkId))
    .returning()
    .all();
  return (row as ReviewLinkRow) ?? null;
}

/** Record that a link was used, so a stale one is visible in the authoring UI. */
export function touchLastSeen(linkId: string, now = new Date().toISOString()): void {
  const db = getDb();
  db.update(reviewLinks).set({ lastSeenAt: now }).where(eq(reviewLinks.id, linkId)).run();
}

/** What a valid `?k=` buys: the link that authorized it and the row it opens. */
export interface ReviewAccess {
  link: ReviewLinkRow;
  publication: PublicationRow;
}

/**
 * Resolve a `?k=` token against the publication it was used on, or null.
 *
 * The lookup is by exact token (the column is uniquely indexed), and the value
 * that comes back is then compared with {@link constantTimeEqual} — the index
 * match alone would be a byte-by-byte comparison inside SQLite, so the explicit
 * compare is what actually pins the timing behaviour of the check the app makes.
 *
 * A publication is openable when it is the link's own, or when both carry the
 * same non-null `group_slug` (decision C-1). It must also be a finalized,
 * unrevoked media publication: an unfinalized row has no bytes on R2 and a
 * revoked one had them deleted, so in both cases there is nothing to review.
 */
export function resolveReviewAccess(
  token: string | null | undefined,
  publicationId: string,
): ReviewAccess | null {
  if (typeof token !== "string" || token.length === 0) return null;

  const db = getDb();
  const link = db.select().from(reviewLinks).where(eq(reviewLinks.token, token)).get() as
    | ReviewLinkRow
    | undefined;
  if (!link) return null;
  if (!constantTimeEqual(link.token, token)) return null;
  if (link.revokedAt !== null) return null;

  const target = getPublication(publicationId);
  if (!target) return null;
  if (!isReviewable(target)) return null;

  if (target.id === link.publicationId) return { link, publication: target };

  const origin = getPublication(link.publicationId);
  if (!origin) return null;
  if (!origin.groupSlug || origin.groupSlug !== target.groupSlug) return null;
  return { link, publication: target };
}

/** A publication a review link may open: media, uploaded, and not revoked. */
export function isReviewable(row: PublicationRow): boolean {
  return row.kind === "media" && row.finalizedAt !== null && row.revokedAt === null;
}
