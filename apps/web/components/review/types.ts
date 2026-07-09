import type { Item, ItemType, ResponseStatus, ResponseValue, Warning } from "@waypoint/spec";

/**
 * Client-side review types (§9). Deliberately free of any DB import so these
 * types and helpers are safe in the browser bundle. The server component builds
 * {@link ReviewSegment}s and hands them to the client review view.
 */

/** A normalized, editing-friendly response draft — every field always present. */
export interface Draft {
  text: string;
  selected: string[];
  other: string;
  status: ResponseStatus | null;
}

/** The persisted response shape the server sends for an item (null = untouched). */
export interface PersistedResponse {
  value: { text?: string; selected?: string[]; other?: string } | null;
  status: ResponseStatus | null;
}

/** One `wp:` item hydrated for interactive review. */
export interface ReviewItemInit {
  /** The DB item id — the `PUT /api/items/:id/response` autosave target. */
  itemId: string;
  /** The parsed item (prompt, options, embedded draft from `raw_md`). */
  item: Item;
  /** Prompt markdown pre-rendered to sanitized HTML on the server. */
  promptHtml: string;
  /**
   * Choice-option labels pre-rendered to sanitized inline HTML, aligned with
   * `item.options` (W2). The label source string stays the canonical value used
   * for selection + byte-fidelity; this is display-only.
   */
  optionLabelsHtml: string[];
  /**
   * The choice's `wp:rationale` ("why I suggested this") pre-rendered to
   * sanitized HTML, when present (SPEC 1.1.0). Rendered read-only under the
   * options; it is author context, never the reviewer's editable answer.
   */
  rationaleHtml?: string;
  /** Persisted reviewer response, or null (then the embedded draft is used). */
  persisted: PersistedResponse | null;
  /** Parse warnings scoped to this item (e.g. multi-checked single) — §5.3. */
  warnings: Warning[];
  /**
   * Present only for synthetic (adoptive-import) items (§5.7): the verbatim
   * source quote the item was anchored to. Drives the "from the document" context
   * on the card; absent on ordinary `wp:` items.
   */
  synthetic?: { anchorExact: string };
}

/** A prose run, pre-rendered to sanitized HTML, plus its source slice (§10). */
export interface ReviewProseSegment {
  kind: "prose";
  html: string;
  /** Source-markdown slice the prose was rendered from (anchor mapping). */
  source: string;
  /** Absolute offset of `source` in `raw_md`. */
  sourceStart: number;
}

/** Document content as an ordered list of prose runs and interactive items (§9). */
export type ReviewSegment = ReviewProseSegment | ({ kind: "item" } & ReviewItemInit);

const EMPTY_DRAFT: Draft = { text: "", selected: [], other: "", status: null };

/**
 * Seed a {@link Draft} from the effective initial response: the persisted
 * reviewer answer if present, else the draft embedded in `raw_md` (§5.2 —
 * pre-filled drafts render; the responses table is not touched until the first
 * edit). Handoff requirement from the Phase 3 review.
 */
export function initialDraft(init: ReviewItemInit): Draft {
  const persisted = init.persisted;
  if (persisted) {
    return {
      text: persisted.value?.text ?? "",
      selected: persisted.value?.selected ?? [],
      other: persisted.value?.other ?? "",
      status: persisted.status ?? null,
    };
  }
  const embedded = init.item.response;
  if (embedded) {
    // SPEC 1.1.0 split: a choice's `wp:answer` no longer holds the agent's
    // rationale (that moved to `wp:rationale`, rendered read-only), so the
    // elaboration box defaults empty on a choice — the reviewer's own words go
    // there. Text questions keep their suggested-draft prefill (§5.2).
    const seedOther = init.item.type === "choice" ? "" : (embedded.other ?? "");
    return {
      text: embedded.text ?? "",
      selected: embedded.selected ?? [],
      other: seedOther,
      status: embedded.status ?? null,
    };
  }
  return { ...EMPTY_DRAFT };
}

/** Draft → a {@link ResponseValue} for status/progress derivation. */
export function draftToValue(draft: Draft): ResponseValue {
  const value: ResponseValue = {};
  if (draft.text.trim().length > 0) value.text = draft.text;
  if (draft.selected.length > 0) value.selected = draft.selected;
  if (draft.other.trim().length > 0) value.other = draft.other;
  if (draft.status) value.status = draft.status;
  return value;
}

/** How an "insert into answer" applies model text to the current draft (§14). */
export type InsertMode = "append" | "replace";

/**
 * Merge assistant text into the answer field of a draft (§14 "insert into
 * answer"). Text items receive it in `text`; choice items receive it in the
 * elaboration (`other`) field — a selection is never overwritten by prose.
 * `append` adds after the existing answer (blank line separated); `replace`, or
 * appending into an empty field, sets the field outright. Pure — tested directly.
 */
export function applyInsert(current: Draft, type: ItemType, text: string, mode: InsertMode): Draft {
  const field: "text" | "other" = type === "text" ? "text" : "other";
  const base = current[field];
  const next =
    mode === "replace" || base.trim().length === 0
      ? text
      : `${base.replace(/\s+$/, "")}\n\n${text}`;
  return { ...current, [field]: next };
}

/** The autosave request body for an item (§8). */
export interface ResponsePutBody {
  value: { text?: string; selected?: string[]; other?: string };
  status: ResponseStatus | null;
}

/**
 * Serialize a draft for `PUT /api/items/:id/response`. Choice items always send
 * their exact checkbox state (an empty array means "uncheck everything") so the
 * splice writer can produce clean, faithful diffs; text/elaboration fields are
 * sent only when non-empty.
 */
export function draftToBody(type: ItemType, draft: Draft): ResponsePutBody {
  const value: ResponsePutBody["value"] = {};
  if (type === "text") {
    if (draft.text.trim().length > 0) value.text = draft.text;
  } else {
    value.selected = draft.selected;
    if (draft.other.trim().length > 0) value.other = draft.other;
  }
  return { value, status: draft.status };
}
