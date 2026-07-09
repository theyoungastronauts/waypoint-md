import { parseDocument, type ResponseValue, type ReviewState } from "@waypoint/spec";
import type { AttachmentMeta } from "./attachments";
import type { DocumentDetail, ItemDetail } from "./documents";
import { exportBaseName } from "./review-state";

/**
 * Attachment export materialization (§6, decision B-4). Attachments are
 * **additive** to the export — they never enter `applyReview`'s splice paths, so
 * the byte-fidelity invariant (`applyReview(raw, {}) === raw`) is untouched. What
 * this module does instead:
 *
 *   1. materializes each attachment into a sibling `<name>.attachments/` folder
 *      (the CLI writes the bytes; here we only name the target), and
 *   2. appends a reference line **inside the answer interior** of each item that
 *      has attachments — i.e. it enriches the review state's answer/elaboration
 *      value so `applyReview` writes the reference as ordinary reviewer answer
 *      content. It targets the `wp:answer` interior only; a `wp:rationale` block
 *      (author input, never in the response value) is never touched.
 *
 * A document with no attachments produces an unchanged review state, so its
 * export stays byte-identical.
 */

/** The sibling folder a document's attachments materialize into (`<name>.attachments`). */
export function attachmentFolderName(baseName: string): string {
  return `${baseName}.attachments`;
}

/** Relative path of one materialized attachment: `<name>.attachments/<exportName>`. */
export function attachmentRelPath(baseName: string, meta: AttachmentMeta): string {
  return `${attachmentFolderName(baseName)}/${meta.exportName}`;
}

/** Alt text for the image reference — the original filename stem, else "attachment". */
function altText(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const stem = base.replace(/\.[^.]+$/, "").trim();
  return stem.length > 0 ? stem : "attachment";
}

/** One reference line as it appears inside the answer interior on export. */
export function attachmentReferenceLine(baseName: string, meta: AttachmentMeta): string {
  return `_Attachment: ![${altText(meta.filename)}](${attachmentRelPath(baseName, meta)})_`;
}

/** Non-synthetic items that carry at least one attachment, keyed for enrichment. */
function itemsWithAttachments(detail: DocumentDetail): ItemDetail[] {
  return detail.items.filter((it) => !it.synthetic && it.wpId && it.attachments.length > 0);
}

/**
 * Enrich a review state so items with attachments carry their reference lines in
 * the answer interior (decision B-4). The reference is appended after any
 * existing answer content in the item's `wp:answer` field — `other` for a choice
 * item, `text` for a text item — with a blank line separator.
 *
 * The append never loses author content. When the reviewer already has a
 * response for the item, the reference is added after it. When the item is
 * *untouched* (no response row — e.g. the reviewer only pasted an image), the
 * pre-filled source draft is recovered from the parsed document and preserved,
 * so `applyReview` sees "draft + reference" rather than a bare reference that
 * would clobber the draft. An item whose draft the reviewer explicitly cleared
 * (a response row with no content) keeps that intent — the cleared draft is not
 * resurrected. Returns the review unchanged when the document has no attachments.
 */
export function enrichReviewWithAttachments(review: ReviewState, detail: DocumentDetail): ReviewState {
  const withAttachments = itemsWithAttachments(detail);
  if (withAttachments.length === 0) return review;

  const baseName = exportBaseName(detail);
  const responses: Record<string, ResponseValue> = { ...(review.responses ?? {}) };

  // Embedded source drafts, so appending to an untouched item preserves the
  // author's pre-filled answer instead of overwriting it.
  const embedded = new Map(
    parseDocument(detail.rawMd).items.filter((i) => i.wpId).map((i) => [i.wpId, i.response ?? null]),
  );

  for (const item of withAttachments) {
    const wpId = item.wpId as string;
    const field: "text" | "other" = item.type === "choice" ? "other" : "text";
    const refs = item.attachments.map((a) => attachmentReferenceLine(baseName, a)).join("\n\n");

    const existing: ResponseValue = { ...(responses[wpId] ?? {}) };
    // Fall back to the embedded draft only when the item is genuinely untouched
    // (no response row at all) — a cleared row (`wpId in responses`, empty field)
    // means the reviewer removed the draft on purpose, so don't bring it back.
    let prev = existing[field];
    if (prev === undefined && !(wpId in responses)) {
      prev = embedded.get(wpId)?.[field];
    }
    const base = (prev ?? "").trimEnd();
    existing[field] = base.length > 0 ? `${base}\n\n${refs}` : refs;
    // The interior now has content; the explicit-empty sentinel no longer applies.
    delete existing.cleared;
    responses[wpId] = existing;
  }

  return { ...review, responses };
}

/**
 * Per-item attachment relative paths for the digest `**Attachments:**` field
 * (decision B-4), keyed by `wp_id`. Only non-synthetic items with attachments
 * appear. Empty map when the document has none.
 */
export function attachmentPathsByWpId(detail: DocumentDetail): Map<string, string[]> {
  const baseName = exportBaseName(detail);
  const byWpId = new Map<string, string[]>();
  for (const item of itemsWithAttachments(detail)) {
    byWpId.set(
      item.wpId as string,
      item.attachments.map((a) => attachmentRelPath(baseName, a)),
    );
  }
  return byWpId;
}
