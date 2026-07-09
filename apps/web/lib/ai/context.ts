import type { Frontmatter, Item, ResponseValue } from "@waypoint/spec";

/**
 * Lean, cost-aware context assembly for the sidebar (§14). The model gets:
 *   1. the document frontmatter,
 *   2. a compact index of **all** items with their current answers,
 *   3. the full text of the focused item's surrounding section, and
 *   4. (the last N chat turns — supplied separately by the route as messages).
 *
 * The full document body is included only when the document is small; otherwise
 * the body is windowed around the focused item (or the top of the document when
 * nothing is focused). This keeps the per-question cost low on large documents
 * (§14, §19 "sidebar cost creep") while the always-present item index still lets
 * the model reason about the whole document at a glance.
 *
 * This module is a pure function of its inputs — no DB, no env, no network — so
 * the windowing thresholds and focused-section extraction are directly testable.
 */

/** At or below this size the whole document body is sent verbatim. */
export const SMALL_DOC_CHARS = 6000;
/** When windowing, characters of context kept before the focused block. */
export const WINDOW_BEFORE = 1200;
/** When windowing, characters of context kept after the focused block. */
export const WINDOW_AFTER = 2400;
/** Per-item answer summary cap in the index (keeps the index compact). */
export const INDEX_ANSWER_CAP = 240;

/** The current persisted answer for one item (as the route reads it from the DB). */
export interface ItemAnswer {
  value: ResponseValue | null;
  status: string | null;
}

export interface ContextInput {
  rawMd: string;
  frontmatter: Frontmatter;
  /** Parsed items (carry prompt text, options, and byte spans). */
  items: Item[];
  /** Current answers keyed by `wp_id`. */
  answers: Map<string, ItemAnswer>;
  /** The `wp_id` of the focused item, or null when nothing is focused. */
  focusedWpId: string | null;
}

export interface AssembledContext {
  /** The full context block to hand to the model as the system-side document context. */
  contextText: string;
  /** True when the body was windowed rather than sent whole (for logging/tests). */
  windowed: boolean;
  /** Echoed back for logging. */
  focusedWpId: string | null;
}

/** The sidebar's role instruction. Kept short — the document context does the work. */
export const SYSTEM_PROMPT = [
  "You are Waypoint's document review assistant. You help a reviewer work through a",
  "markdown review document: understanding its questions, weighing options, and",
  "drafting answers. You are given the document's frontmatter, a compact index of",
  "every item with the reviewer's current answers, and the full text of the section",
  "around the item the reviewer is focused on (marked with → in the index).",
  "",
  "Guidelines:",
  "- Be concise and practical. Prefer a direct answer over preamble.",
  "- Ground everything in the document. Do not invent facts, decisions, or context",
  "  that are not present; if something is missing, say so.",
  "- When the reviewer asks you to draft or improve an answer to a question, reply",
  "  with text suitable to paste directly into the answer field — no meta commentary,",
  "  no \"here is a draft\" preamble.",
  "- When the reviewer asks you to explain a question, say plainly what it is asking",
  "  and what a good answer would need to cover.",
  "- When you propose a concrete answer the reviewer could use for the focused item,",
  "  put ONLY that answer inside a fenced code block whose language is `wpsuggest`",
  "  (```wpsuggest). Keep any explanation or reasoning OUTSIDE the fence. This lets",
  "  the reviewer drop just the suggested answer into the focused field in one click.",
].join("\n");

/** Assemble the lean document context for a chat request (§14). */
export function assembleContext(input: ContextInput): AssembledContext {
  const { rawMd, frontmatter, items, answers, focusedWpId } = input;

  const focusedItem = focusedWpId ? items.find((it) => it.wpId === focusedWpId) ?? null : null;

  const sections: string[] = [];

  const fm = frontmatterBlock(frontmatter);
  if (fm) sections.push(`## Document\n${fm}`);

  sections.push(`## Items (${items.length}, with current answers)\n${itemIndex(items, answers, focusedWpId)}`);

  const small = rawMd.length <= SMALL_DOC_CHARS;
  if (small) {
    sections.push(`## Full document\n${rawMd.trim()}`);
  } else if (focusedItem) {
    sections.push(`## Section around the focused item\n${extractSection(rawMd, focusedItem.spans.block)}`);
  } else {
    sections.push(`## Document excerpt (start)\n${topWindow(rawMd)}`);
  }

  return { contextText: sections.join("\n\n"), windowed: !small, focusedWpId };
}

/** Frontmatter as a few labeled lines (only the fields that carry meaning). */
function frontmatterBlock(fm: Frontmatter): string {
  const lines: string[] = [];
  if (typeof fm.title === "string" && fm.title.trim()) lines.push(`Title: ${fm.title.trim()}`);
  if (typeof fm.project === "string" && fm.project.trim()) lines.push(`Project: ${fm.project.trim()}`);
  if (typeof fm.source === "string" && fm.source.trim()) lines.push(`Source: ${fm.source.trim()}`);
  return lines.join("\n");
}

/** The compact index: one line per item, focused item flagged with →. */
function itemIndex(
  items: Item[],
  answers: Map<string, ItemAnswer>,
  focusedWpId: string | null,
): string {
  if (items.length === 0) return "(no structured items in this document)";
  return items
    .map((item) => {
      const marker = item.wpId === focusedWpId ? "→" : "-";
      const type = item.type === "choice" ? `choice/${item.select ?? "single"}` : "text";
      const head = firstLine(item.promptMd);
      const answer = summarizeAnswer(item, answers.get(item.wpId));
      return `${marker} [${item.wpId}] (${type}) ${head} — ${answer}`;
    })
    .join("\n");
}

/** A one-line, lightly de-marked summary of a prompt. */
function firstLine(md: string, cap = 100): string {
  const line = (md.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
  const plain = line
    .replace(/[*_`~]/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
  return truncate(plain, cap);
}

/** A compact rendering of the current answer for the index. */
function summarizeAnswer(item: Item, answer: ItemAnswer | undefined): string {
  const value = answer?.value ?? null;
  const parts: string[] = [];

  if (item.type === "choice") {
    if (value?.selected && value.selected.length > 0) parts.push(`selected: ${value.selected.join(" | ")}`);
    if (value?.other && value.other.trim()) parts.push(`note: ${value.other.trim()}`);
  } else if (value?.text && value.text.trim()) {
    parts.push(value.text.trim());
  }

  const status = answer?.status;
  if (status && status !== "answered") parts.push(`[${status}]`);

  if (parts.length === 0) return status === "answered" ? "answered (empty)" : "unanswered";
  return truncate(parts.join(" "), INDEX_ANSWER_CAP);
}

/** Byte offsets of every ATX heading line-start in `raw`. */
function headingOffsets(raw: string): number[] {
  const offsets: number[] = [];
  const re = /^#{1,6}[ \t]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) offsets.push(m.index);
  return offsets;
}

/**
 * The heading-delimited section containing `block`, clamped to a character
 * window around the block when the section itself is large. Snapped to line
 * boundaries; ellipsis markers show where the section was trimmed.
 */
function extractSection(raw: string, block: { start: number; end: number }): string {
  const heads = headingOffsets(raw);
  const sectionStart = heads.filter((o) => o <= block.start).at(-1) ?? 0;
  const sectionEnd = heads.find((o) => o >= block.end) ?? raw.length;

  const budget = WINDOW_BEFORE + WINDOW_AFTER + (block.end - block.start);
  if (sectionEnd - sectionStart <= budget) {
    return raw.slice(sectionStart, sectionEnd).trim();
  }

  // Section is large — window around the focused block, snapped to lines.
  const from = snapToLineStart(raw, Math.max(sectionStart, block.start - WINDOW_BEFORE));
  const to = snapToLineEnd(raw, Math.min(sectionEnd, block.end + WINDOW_AFTER));
  const head = from > sectionStart ? "…\n" : "";
  const tail = to < sectionEnd ? "\n…" : "";
  return `${head}${raw.slice(from, to).trim()}${tail}`;
}

/** The leading window of a document, snapped to a line boundary. */
function topWindow(raw: string): string {
  const to = snapToLineEnd(raw, WINDOW_BEFORE + WINDOW_AFTER);
  const tail = to < raw.length ? "\n…" : "";
  return `${raw.slice(0, to).trim()}${tail}`;
}

function snapToLineStart(raw: string, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, raw.length));
  const nl = raw.lastIndexOf("\n", clamped);
  return nl === -1 ? 0 : nl + 1;
}

function snapToLineEnd(raw: string, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, raw.length));
  const nl = raw.indexOf("\n", clamped);
  return nl === -1 ? raw.length : nl;
}

function truncate(s: string, cap: number): string {
  return s.length > cap ? `${s.slice(0, cap - 1)}…` : s;
}
