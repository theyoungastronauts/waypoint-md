import { mediaExtension } from "../publish/media-types";
import { mediaUrls } from "../publish/paths";
import type { PublicationRow } from "../publications";
import { toCommentViews, type MediaCommentRow, type MediaCommentView } from "./comments";
import type { ReviewLinkRow } from "./links";
import { listGroupVersions, toVersionEntries, type VersionEntry } from "./versions";

/**
 * The shapes the public review surface serves (§ media spec Phase C, decision
 * C-3). One module builds them so the server component and the two `/api/r/*`
 * routes cannot drift — and so there is a single place to check what a reviewer
 * is allowed to see.
 *
 * What is deliberately absent is as important as what is here: no origin, no
 * source host, no R2 folder, no manifest, no sibling review links, no other
 * reviewer's token. A reviewer sees the render, the notes on it, and the other
 * versions of the same material.
 */

/** A comment as the public page sees it — no link id, no resolve timestamp. */
export interface PublicComment {
  id: string;
  ordinal: number;
  authorName: string;
  timecodeMs: number | null;
  region: MediaCommentView["region"];
  body: string;
  createdAt: string;
  /** Rendered dimmed: the note has been acted on (author side). */
  resolved: boolean;
}

export interface PublicPublication {
  id: string;
  title: string;
  contentType: string | null;
  group: string | null;
  label: string | null;
  /** The public R2 URL the player points at. */
  fileUrl: string;
  createdAt: string;
}

export interface PublicReviewPayload {
  /** The name bound to the link — displayed, never editable (decision Q4). */
  reviewer: { name: string };
  publication: PublicPublication;
  /** Every reviewable version of the same material, oldest first. */
  versions: VersionEntry[];
}

export function toPublicPublication(row: PublicationRow): PublicPublication {
  const urls = mediaUrls(
    row.publicBase,
    row.r2Folder,
    row.sanitizedName,
    mediaExtension(row.contentType),
    false,
  );
  return {
    id: row.id,
    title: row.title,
    contentType: row.contentType,
    group: row.groupSlug,
    label: row.label,
    fileUrl: urls.file,
    createdAt: row.createdAt,
  };
}

export function toPublicReviewPayload(
  row: PublicationRow,
  link: ReviewLinkRow,
): PublicReviewPayload {
  return {
    reviewer: { name: link.reviewerName },
    publication: toPublicPublication(row),
    versions: toVersionEntries(listGroupVersions(row), row.id),
  };
}

export function toPublicComments(rows: MediaCommentRow[]): PublicComment[] {
  return toCommentViews(rows).map((view) => ({
    id: view.id,
    ordinal: view.ordinal,
    authorName: view.authorName,
    timecodeMs: view.timecodeMs,
    region: view.region,
    body: view.body,
    createdAt: view.createdAt,
    resolved: view.resolved,
  }));
}
