/**
 * @waypoint/spec — public type surface for the SPEC v1 review convention.
 *
 * Offsets are indices into the raw document string (JS UTF-16 code units).
 * Because parsing and the splice writer both operate on the same string,
 * slicing/splicing with these offsets is byte-preserving: any region the
 * writer never touches is emitted exactly as it came in (§11 invariant).
 */

/** Semver of the review convention. `docs/SPEC.md` is the public contract (§4). */
export const SPEC_VERSION = "1.0.0";

/** Frontmatter opt-in marker value (`waypoint: 1` in §5.1). */
export const SPEC_MARKER = 1;

/** A half-open `[start, end)` range of offsets into the raw document. */
export interface Span {
  start: number;
  end: number;
}

/** Document frontmatter (§5.1). Unknown keys are preserved on parse. */
export interface Frontmatter {
  waypoint?: number;
  title?: string;
  project?: string;
  source?: string;
  [key: string]: unknown;
}

/** Question kind (§5.2 / §5.3). */
export type ItemType = "text" | "choice";

/** Selection cardinality for choice questions (§5.3). */
export type ChoiceSelect = "single" | "multi";

/** Per-item response status (§5.5). Absent = untouched. */
export type ResponseStatus = "answered" | "flagged" | "skipped";

/** A single task-list option on a choice question (§5.3). */
export interface ChoiceOption {
  /** Canonical value: the source-markdown label text, trimmed. Used in `selected`. */
  label: string;
  /** Whether the box is `[x]`/`[X]` in the source. */
  checked: boolean;
  /** Span of the `[ ]` / `[x]` marker itself (3 chars) for the splice writer. */
  marker: Span;
}

/** Byte spans for a single `wp:question` block (§11). */
export interface ItemSpans {
  /** Whole block, from the question-open comment to the question-close comment. */
  block: Span;
  /** The `<!-- wp:question ... -->` open comment. */
  questionOpen: Span;
  /** The `<!-- /wp:question -->` close comment, if present. */
  questionClose?: Span;
  /** The `<!-- wp:answer ... -->` open comment, if present. */
  answerOpen?: Span;
  /** The `<!-- /wp:answer -->` close comment, if present. */
  answerClose?: Span;
  /** Interior of the answer block (between the answer open/close comments). */
  answerInterior?: Span;
}

/** The current response embedded in the document (drafts, checked boxes, status). */
export interface ItemResponse {
  /** Free-text answer (text questions). */
  text?: string;
  /** Selected option labels, in document order (choice questions). */
  selected?: string[];
  /** Elaboration / "other" text from the answer block (choice questions). */
  other?: string;
  /** Answer status from the answer-open comment. */
  status?: ResponseStatus;
}

/** A parsed `wp:question` item (§5.2 / §5.3). */
export interface Item {
  wpId: string;
  type: ItemType;
  /** Present for choice questions. */
  select?: ChoiceSelect;
  /** Prompt markdown (the visible question text), trimmed. */
  promptMd: string;
  /** Present for choice questions. */
  options?: ChoiceOption[];
  spans: ItemSpans;
  /** Current response embedded in the source (pre-filled drafts, checks, status). */
  response?: ItemResponse;
}

/** Quote-based anchor for a comment (§5.4, W3C-annotation style). */
export interface CommentAnchor {
  /** The exact selected text (source markdown). Capped at 200 chars on export. */
  exact: string;
  /** Up to 32 chars of preceding context. */
  prefix?: string;
  /** Up to 32 chars of following context. */
  suffix?: string;
  /** Hash of the full selection when `exact` was truncated (over the 200 cap). */
  exactHash?: string;
}

/** Byte spans for a single `wp:comment` block (§5.4). */
export interface CommentSpans {
  block: Span;
  open: Span;
  close?: Span;
  suggestionOpen?: Span;
  suggestionClose?: Span;
}

/** A parsed `wp:comment` (§5.4). */
export interface Comment {
  id: string;
  anchor: CommentAnchor;
  bodyMd: string;
  suggestionMd?: string;
  spans: CommentSpans;
}

/** Machine-readable warning categories (§5.6 — degrade, never hard-fail). */
export type WarningCode =
  | "missing-id"
  | "duplicate-id"
  | "missing-type"
  | "unknown-type"
  | "unclosed-question"
  | "orphan-question-close"
  | "answer-outside-question"
  | "duplicate-answer"
  | "orphan-answer-close"
  | "unclosed-answer"
  | "no-options"
  | "multi-checked-single"
  | "nested-comment"
  | "suggestion-outside-comment"
  | "orphan-suggestion"
  | "orphan-comment-close"
  | "unclosed-comment";

/** A non-fatal parse warning (§5.6). */
export interface Warning {
  code: WarningCode;
  message: string;
  /** The `wp_id` the warning relates to, when applicable. */
  wpId?: string;
  /** Offset into the raw document where the problem was found, when applicable. */
  offset?: number;
}

/** Byte-offset index for every wp block and interior (§5.6). */
export interface SpanIndex {
  frontmatter: Span | null;
  items: ItemSpans[];
  comments: CommentSpans[];
}

/** The full result of `parseDocument` (§5.6). */
export interface ParseResult {
  frontmatter: Frontmatter;
  items: Item[];
  comments: Comment[];
  spans: SpanIndex;
  warnings: Warning[];
}

/**
 * A reviewer's answer to one item, keyed by `wp_id` in {@link ReviewState}.
 * Text questions carry `text`; choice questions carry `selected` (option
 * labels) and/or `other` (elaboration). `status` maps to the answer-open
 * comment's `status` attribute (§5.5).
 */
export interface ResponseValue {
  text?: string;
  selected?: string[];
  other?: string;
  status?: ResponseStatus;
}

/** A reviewer-authored comment to splice into the export (§5.4). */
export interface ReviewComment {
  id: string;
  anchor: CommentAnchor;
  bodyMd: string;
  suggestionMd?: string;
}

/**
 * The complete review state applied by {@link applyReview}. An empty object
 * (no meaningful responses, no comments) produces a byte-identical export —
 * the #1 non-negotiable (§11).
 */
export interface ReviewState {
  /** Responses keyed by `wp_id`. */
  responses?: Record<string, ResponseValue>;
  /** Comments to splice after their anchored source blocks. */
  comments?: ReviewComment[];
  /**
   * Timestamp stamped as `reviewed_at` in the frontmatter when the review is
   * non-empty. Caller-supplied so `applyReview` stays a pure, deterministic
   * function of its inputs.
   */
  reviewedAt?: string;
  /** Value for the `waypoint_status` frontmatter stamp. Defaults to `completed`. */
  status?: string;
}
