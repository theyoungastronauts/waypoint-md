import {
  responseIsEmpty,
  type ResponseStatus,
  type ResponseValue,
  type ReviewComment,
  type ReviewState,
} from "@waypoint/spec";
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
    if (!stored) continue;

    const value: ResponseValue = { ...(stored.value ?? {}) };
    const status = asStatus(stored.status);
    if (status) value.status = status;
    if (responseIsEmpty(value)) continue;

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

/** The `<name>.review.md` filename for an annotated export (§11). */
export function exportFilename(detail: Pick<DocumentDetail, "id" | "title" | "sourcePath">): string {
  const fromPath = detail.sourcePath ? basename(detail.sourcePath) : null;
  const base = fromPath || slugify(detail.title) || detail.id;
  return `${base}.review.md`;
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
