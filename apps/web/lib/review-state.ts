import {
  type ResponseStatus,
  type ResponseValue,
  type ReviewComment,
  type ReviewState,
} from "@waypoint/spec";
import { responseHasContent } from "./review-status";
import type { DocumentDetail } from "./documents";

/**
 * Assemble the {@link ReviewState} that `applyReview` splices into an export
 * (§11). This is the bridge from persisted review data (the `responses` and
 * `comments` tables) to the pure spec writer: the export is a function of
 * `(raw_md, review state)` and nothing else.
 *
 * `reviewedAt` is caller-supplied so the writer stays pure — the export route
 * stamps "now"; the writer only records it when the review is non-empty (an
 * untouched doc still exports byte-identically, ignoring the timestamp).
 *
 * Synthetic items (Phase 8 adoptive import) are deliberately excluded: they
 * have no answer anchors in `raw_md` and export into an appended section, never
 * spliced blocks.
 */
export function buildReviewState(detail: DocumentDetail, reviewedAt: string): ReviewState {
  const responses: Record<string, ResponseValue> = {};
  for (const item of detail.items) {
    if (!item.wpId || item.synthetic) continue;
    const stored = item.response;
    // No response row means the item was never touched: leave any pre-filled
    // draft in the source exactly as it was (§5.2).
    if (!stored) continue;

    const value: ResponseValue = { ...(stored.value ?? {}) };
    const status = asStatus(stored.status);
    if (status) value.status = status;

    // A response row that exists but carries no answer content is an explicit
    // clear (W1): the reviewer emptied a pre-filled draft. Mark it so the writer
    // writes an empty interior rather than resurrecting the draft. The existence
    // of the DB row is the sentinel — distinct from "never touched" above.
    if (!responseHasContent(value)) {
      value.cleared = true;
    }

    responses[item.wpId] = value;
  }

  const comments: ReviewComment[] = detail.comments.map((c) => {
    const review: ReviewComment = { id: c.id, anchor: c.anchor, bodyMd: c.bodyMd };
    if (c.suggestionMd) review.suggestionMd = c.suggestionMd;
    return review;
  });

  const state: ReviewState = { reviewedAt };
  if (Object.keys(responses).length > 0) state.responses = responses;
  if (comments.length > 0) state.comments = comments;
  return state;
}

const VALID_STATUSES = new Set<ResponseStatus>(["answered", "flagged", "skipped"]);

function asStatus(value: string | null): ResponseStatus | undefined {
  return value && VALID_STATUSES.has(value as ResponseStatus) ? (value as ResponseStatus) : undefined;
}

/** Which export a filename is for: annotated (`.review.md`) or digest (`.digest.md`). */
export type ExportKind = "annotated" | "digest";

/**
 * The download filename for an export (§11): `<name>.review.md` for the
 * annotated file, `<name>.digest.md` for the digest. `<name>` is the source
 * file stem when known, else a slug of the title, else the document id.
 */
export function exportFilename(
  detail: Pick<DocumentDetail, "id" | "title" | "sourcePath">,
  kind: ExportKind = "annotated",
): string {
  const fromPath = detail.sourcePath ? basename(detail.sourcePath) : null;
  const base = fromPath || slugify(detail.title) || detail.id;
  const suffix = kind === "digest" ? "digest" : "review";
  return `${base}.${suffix}.md`;
}

/** File stem (no directory, no extension) of a source path. */
function basename(sourcePath: string): string | null {
  const last = sourcePath.split(/[\\/]/).pop();
  if (!last) return null;
  const stem = last.replace(/\.[^.]+$/, "");
  return stem.length > 0 ? stem : null;
}

/** Filesystem-safe slug from a title; null when nothing usable remains. */
function slugify(title: string | null): string | null {
  if (!title) return null;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : null;
}
