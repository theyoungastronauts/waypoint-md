import type { ResponseValue } from "@waypoint/spec";
import { responseHasContent } from "./review-status";
import type { DocumentDetail, SyntheticAnchor } from "./documents";

/**
 * Synthetic (adoptive-import) items export into an appended `## Waypoint
 * responses` section, never into spliced `wp:` blocks (§5.7, §11): the source
 * has no answer anchors, so their responses live below the document body.
 *
 * This composes *after* `applyReview`, so the splice writer never sees a
 * synthetic item. The section is appended **only when a synthetic item has a
 * real response** — a document with no synthetic activity exports exactly what
 * `applyReview` produced, keeping the byte-fidelity invariant (`applyReview(raw,
 * {}) === raw`) intact and the document body byte-identical to its source.
 *
 * Pure functions of their inputs — no DB, no env — so the append mechanics and
 * the "only when warranted" rule are directly testable.
 */

/** One answered synthetic item, ready to render into the appended section. */
export interface SyntheticEntry {
  promptMd: string;
  anchorExact: string;
  type: string;
  value: ResponseValue | null;
  status: string | null;
}

const ANCHOR_DISPLAY_CAP = 200;
const HEADING_CAP = 120;

const SECTION_PREAMBLE =
  "<!-- Waypoint adoptive-import responses (SPEC v1 §8). The document above is " +
  "byte-identical to its imported source; these structured items live only here. -->";

/**
 * Collect the synthetic items that carry a real response (§5.7). Items with no
 * answer content are excluded — an unanswered synthetic item contributes nothing
 * to the export, which is why an untouched adopted doc appends no section.
 */
export function buildSyntheticEntries(detail: DocumentDetail): SyntheticEntry[] {
  const entries: SyntheticEntry[] = [];
  for (const item of detail.items) {
    if (!item.synthetic) continue;
    const value = item.response?.value ?? null;
    if (!responseHasContent(value)) continue;
    entries.push({
      promptMd: item.promptMd ?? "",
      anchorExact: (item.anchor as SyntheticAnchor | null)?.exact ?? "",
      type: item.type,
      value,
      status: item.response?.status ?? null,
    });
  }
  return entries;
}

/**
 * Append the `## Waypoint responses` section to an already-written annotated
 * body. With no entries the body is returned unchanged (byte-identical). The
 * source body always remains a byte-exact prefix of the result — only a blank
 * line and the appended section follow it.
 */
export function appendSyntheticResponses(body: string, entries: SyntheticEntry[]): string {
  if (entries.length === 0) return body;
  const separator = body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${separator}${renderSyntheticSection(entries)}`;
}

/** Render the appended section markdown for a non-empty entry list. */
export function renderSyntheticSection(entries: SyntheticEntry[]): string {
  const blocks = entries.map((entry, i) => {
    const parts = [`### ${i + 1}. ${headingText(entry.promptMd)}`];
    if (entry.anchorExact) parts.push(asBlockquote(entry.anchorExact));
    parts.push(answerBody(entry));
    return parts.join("\n\n");
  });
  return `## Waypoint responses\n\n${SECTION_PREAMBLE}\n\n${blocks.join("\n\n")}\n`;
}

/** The reviewer's answer rendered as one or more markdown paragraphs. */
function answerBody(entry: SyntheticEntry): string {
  const parts: string[] = [];
  if (entry.type === "choice") {
    const selected = entry.value?.selected ?? [];
    if (selected.length > 0) parts.push(`**Selected:** ${selected.join(", ")}`);
    const other = entry.value?.other?.trim();
    if (other) parts.push(other);
  } else {
    const text = entry.value?.text?.trim();
    if (text) parts.push(text);
  }

  if (entry.status === "flagged") parts.push("_Flagged for follow-up._");
  else if (entry.status === "skipped") parts.push("_Skipped._");

  // buildSyntheticEntries only admits items with content, so parts is non-empty.
  return parts.join("\n\n");
}

/** First non-empty prompt line, lightly de-marked, for the item heading. */
function headingText(prompt: string): string {
  const line = prompt.split("\n").find((l) => l.trim().length > 0) ?? "";
  const plain = line
    .replace(/[*_`~]/g, "")
    .replace(/^#+\s*/, "")
    .trim();
  return plain.length > HEADING_CAP ? `${plain.slice(0, HEADING_CAP - 1)}…` : plain;
}

/** The anchor quote as a markdown blockquote, capped for display. */
function asBlockquote(quote: string): string {
  const capped =
    quote.length > ANCHOR_DISPLAY_CAP ? `${quote.slice(0, ANCHOR_DISPLAY_CAP).trimEnd()}…` : quote;
  return capped
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}
