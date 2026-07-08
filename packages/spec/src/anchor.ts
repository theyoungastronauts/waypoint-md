/**
 * Comment-anchor helpers (§5.4). Quote-based anchors carry the selected text
 * (`exact`) plus short `prefix`/`suffix` context, capped so the exported comment
 * stays small and stable. The caps and the `exact-hash` fallback live here so a
 * single implementation is shared by the splice writer ({@link ./apply}) and the
 * UI that constructs anchors from a selection — they must agree byte-for-byte or
 * an exported anchor would fail to re-match on parse.
 */

import type { CommentAnchor } from "./types.js";

/** Max length of `prefix` / `suffix` context strings (§5.4). */
export const PREFIX_SUFFIX_CAP = 32;

/** Max length of the stored `exact` selection before the hash fallback (§5.4). */
export const EXACT_CAP = 200;

/**
 * Small non-cryptographic hash (FNV-1a, 32-bit) for the `exact-hash` fallback on
 * selections over the {@link EXACT_CAP}. Only needs to be deterministic and
 * collision-resistant enough to disambiguate anchors — not secure. Shared so the
 * writer and the UI produce identical hashes for the same selection.
 */
export function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Enforce the §5.4 caps on an anchor, idempotently: trim `prefix`/`suffix` to
 * 32 chars, and when `exact` exceeds 200 chars, truncate it and attach an
 * `exact-hash` of the *full* selection so the comment still round-trips. Passing
 * an already-capped anchor back through returns an equivalent anchor, so callers
 * can cap early (client) and the writer can cap again (defense-in-depth) without
 * drift.
 */
export function capCommentAnchor(anchor: CommentAnchor): CommentAnchor {
  const capped: CommentAnchor = { exact: anchor.exact };

  if (anchor.exact.length > EXACT_CAP) {
    capped.exactHash = anchor.exactHash ?? fnv1aHex(anchor.exact);
    capped.exact = anchor.exact.slice(0, EXACT_CAP);
  } else if (anchor.exactHash) {
    // Preserve a caller-supplied hash even when `exact` is already short (it may
    // have been truncated upstream); never invent one for a short selection.
    capped.exactHash = anchor.exactHash;
  }

  if (anchor.prefix) {
    // The most useful context sits closest to the selection: keep the tail of
    // the prefix and the head of the suffix when trimming.
    capped.prefix = anchor.prefix.slice(-PREFIX_SUFFIX_CAP);
  }
  if (anchor.suffix) {
    capped.suffix = anchor.suffix.slice(0, PREFIX_SUFFIX_CAP);
  }

  return capped;
}
