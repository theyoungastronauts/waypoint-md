/**
 * `applyReview` — the splice writer (§11).
 *
 * The export is a pure function of `(raw, review)`. It never re-serializes the
 * markdown AST (that would normalize formatting and produce noisy diffs).
 * Instead it computes a set of edits against byte offsets from the parser and
 * applies them in descending order, so earlier edits never shift later spans:
 *
 *   - replace the interior of a `wp:answer` block with the response text;
 *   - flip `[ ]`/`[x]` checkbox markers to match the selection;
 *   - write the `status` attribute on the answer-open comment;
 *   - insert `wp:comment` blocks after the source block that contains the anchor;
 *   - stamp `waypoint_status` / `reviewed_at` into the frontmatter.
 *
 * The #1 non-negotiable: `applyReview(raw, {})` returns `raw` byte-for-byte.
 */

import { parseInternal, reviewIsEmpty } from "./parse.js";
import { encodeAttr } from "./html.js";
import type { Item, ResponseValue, ReviewComment, ReviewState, Span } from "./types.js";

/** Caps from §5.4. */
const PREFIX_SUFFIX_CAP = 32;
const EXACT_CAP = 200;

interface Splice {
  start: number;
  end: number;
  replacement: string;
}

/** The public splice writer (§11). */
export function applyReview(raw: string, review: ReviewState): string {
  // Fast path guarantees byte-identity for the empty state — the #1 invariant.
  if (reviewIsEmpty(review)) return raw;

  const parsed = parseInternal(raw);
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const splices: Splice[] = [];

  const responses = review.responses ?? {};
  for (const item of parsed.items) {
    const response = responses[item.wpId];
    if (response) collectItemSplices(raw, item, response, eol, splices);
  }

  collectCommentSplices(raw, review.comments ?? [], parsed.analysis.blocks, eol, splices);
  collectFrontmatterStamp(raw, parsed.spans.frontmatter, eol, review, splices);

  return applySplices(raw, splices);
}

function collectItemSplices(raw: string, item: Item, response: ResponseValue, eol: string, splices: Splice[]): void {
  // 1. Answer interior — the free-text answer (text Q) or elaboration (choice Q).
  const content = item.type === "text" ? response.text : response.other;
  if (item.spans.answerInterior && typeof content === "string" && content.trim().length > 0) {
    const interior = item.spans.answerInterior;
    const desired = `${eol}${content}${eol}`;
    if (raw.slice(interior.start, interior.end) !== desired) {
      splices.push({ start: interior.start, end: interior.end, replacement: desired });
    }
  }

  // 2. Checkbox markers — only when a selection is explicitly provided.
  if (item.type === "choice" && item.options && Array.isArray(response.selected)) {
    const selected = new Set(response.selected);
    for (const option of item.options) {
      const wantChecked = selected.has(option.label);
      if (wantChecked === option.checked) continue; // clean diff: don't touch unchanged boxes
      splices.push({ start: option.marker.start, end: option.marker.end, replacement: wantChecked ? "[x]" : "[ ]" });
    }
  }

  // 3. Status attribute on the answer-open comment.
  if (item.spans.answerOpen) {
    const open = item.spans.answerOpen;
    const desired = response.status ? `<!-- wp:answer status="${response.status}" -->` : `<!-- wp:answer -->`;
    if (raw.slice(open.start, open.end) !== desired) {
      splices.push({ start: open.start, end: open.end, replacement: desired });
    }
  }
}

function collectCommentSplices(
  raw: string,
  comments: readonly ReviewComment[],
  blocks: readonly Span[],
  eol: string,
  splices: Splice[],
): void {
  // Group comments by insertion offset so several comments on one block stack
  // cleanly under a single splice (descending-order apply keeps their order).
  const byOffset = new Map<number, string[]>();
  for (const comment of comments) {
    const offset = anchorInsertionOffset(raw, comment, blocks);
    if (offset === null) continue; // unanchored — Phase 6 surfaces these; nothing to splice
    const parts = byOffset.get(offset) ?? [];
    parts.push(`${eol}${eol}${serializeComment(comment, eol)}`);
    byOffset.set(offset, parts);
  }
  for (const [offset, parts] of byOffset) {
    splices.push({ start: offset, end: offset, replacement: parts.join("") });
  }
}

/** Offset just past the block that contains the comment's anchor (§5.4, §11). */
function anchorInsertionOffset(raw: string, comment: ReviewComment, blocks: readonly Span[]): number | null {
  const { exact, prefix, suffix } = comment.anchor;
  let matchOffset = -1;
  if (prefix || suffix) {
    const combined = `${prefix ?? ""}${exact}${suffix ?? ""}`;
    const idx = raw.indexOf(combined);
    if (idx >= 0) matchOffset = idx + (prefix?.length ?? 0);
  }
  if (matchOffset < 0) matchOffset = raw.indexOf(exact);
  if (matchOffset < 0) return null;

  let containing: Span | null = null;
  for (const block of blocks) {
    if (matchOffset >= block.start && matchOffset < block.end) {
      containing = block;
      break;
    }
  }
  return containing ? containing.end : raw.length;
}

function serializeComment(comment: ReviewComment, eol: string): string {
  const { anchor } = comment;
  let exact = anchor.exact;
  let exactHash = anchor.exactHash;
  if (exact.length > EXACT_CAP) {
    exactHash = exactHash ?? hashExact(exact);
    exact = exact.slice(0, EXACT_CAP);
  }

  let attrs = `id="${encodeAttr(comment.id)}" exact="${encodeAttr(exact)}"`;
  if (anchor.prefix) attrs += ` prefix="${encodeAttr(anchor.prefix.slice(0, PREFIX_SUFFIX_CAP))}"`;
  if (anchor.suffix) attrs += ` suffix="${encodeAttr(anchor.suffix.slice(0, PREFIX_SUFFIX_CAP))}"`;
  if (exactHash) attrs += ` exact-hash="${encodeAttr(exactHash)}"`;

  const lines = [`<!-- wp:comment ${attrs} -->`, comment.bodyMd];
  if (comment.suggestionMd !== undefined) {
    lines.push("<!-- wp:suggestion -->", comment.suggestionMd, "<!-- /wp:suggestion -->");
  }
  lines.push("<!-- /wp:comment -->");
  return lines.join(eol);
}

/**
 * Small non-cryptographic hash (FNV-1a, 32-bit) for the `exact-hash` fallback
 * on selections over the 200-char cap. Only needs to be deterministic and
 * collision-resistant enough to disambiguate anchors — not secure.
 */
function hashExact(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function collectFrontmatterStamp(
  raw: string,
  frontmatter: Span | null,
  eol: string,
  review: ReviewState,
  splices: Splice[],
): void {
  const statusValue = review.status ?? "completed";
  const stampLines = [`waypoint_status: ${statusValue}`];
  if (review.reviewedAt) stampLines.push(`reviewed_at: ${review.reviewedAt}`);

  if (frontmatter) {
    const block = raw.slice(frontmatter.start, frontmatter.end);
    const blockEol = block.includes("\r\n") ? "\r\n" : "\n";
    const lines = block.split(blockEol);
    // lines[0] and the last line are the `---` fences.
    const body = lines.slice(1, -1).filter((line) => !/^\s*(waypoint_status|reviewed_at)\s*:/.test(line));
    const rebuilt = ["---", ...body, ...stampLines, "---"].join(blockEol);
    splices.push({ start: frontmatter.start, end: frontmatter.end, replacement: rebuilt });
  } else {
    const rebuilt = ["---", ...stampLines, "---"].join(eol) + eol + eol;
    splices.push({ start: 0, end: 0, replacement: rebuilt });
  }
}

/** Apply edits in descending order so an edit never invalidates a later span. */
function applySplices(raw: string, splices: Splice[]): string {
  const ordered = [...splices].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = raw;
  for (const splice of ordered) {
    result = result.slice(0, splice.start) + splice.replacement + result.slice(splice.end);
  }
  return result;
}
