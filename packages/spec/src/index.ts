/**
 * @waypoint/spec — the Waypoint review convention (SPEC v1).
 *
 * Public surface: a deterministic parser and a byte-faithful splice writer for
 * the markdown review convention documented in `docs/SPEC.md`. See §5 (the
 * convention), §11 (export/round-trip), and §17 (invariants).
 */

export { SPEC_VERSION, SPEC_MARKER } from "./types.js";
export type {
  Span,
  Frontmatter,
  ItemType,
  ChoiceSelect,
  ResponseStatus,
  ChoiceOption,
  ItemSpans,
  ItemResponse,
  Item,
  CommentAnchor,
  CommentSpans,
  Comment,
  WarningCode,
  Warning,
  SpanIndex,
  ParseResult,
  ResponseValue,
  ReviewComment,
  ReviewState,
} from "./types.js";

export {
  parseDocument,
  extractReviewState,
  reviewIsEmpty,
  responseIsEmpty,
} from "./parse.js";

export { applyReview } from "./apply.js";

// HTML-attribute helpers are part of the convention's contract (§5.4) and are
// reused by the UI when constructing comment anchors.
export { encodeAttr, decodeAttr } from "./html.js";
