import type { ResponseStatus, ResponseValue, Warning } from "@waypoint/spec";
import type { PersistedResponse, ReviewSegment } from "@/components/review/types";
import type { ItemDetail } from "../documents";
import { renderDocument } from "./document";
import { renderMarkdownToSafeHtml } from "./pipeline";

export interface ReviewRender {
  /** Prose + interactive-item segments in document order (§9). */
  segments: ReviewSegment[];
  /** Warnings not tied to a specific card (shown in the document banner). */
  docWarnings: Warning[];
  isConventioned: boolean;
}

/**
 * Build the interactive review segments (§9). This extends the Phase 3
 * segmentation seam ({@link renderDocument}) rather than replacing it: the same
 * walk decides prose-vs-item; here we additionally pair each rendered item with
 * its persisted DB row (for the autosave target id and the current response),
 * pre-render the prompt to sanitized HTML, and route each parse warning either
 * onto its card (item-scoped) or into the document banner.
 *
 * Rendered items and DB rows come from the same parse of the same immutable
 * `raw_md`, so they align in document order; pairing is sequential by
 * `order_index`.
 */
export function renderReviewDocument(rawMd: string, dbItems: ItemDetail[]): ReviewRender {
  const base = renderDocument(rawMd);
  const ordered = [...dbItems].sort((a, b) => a.orderIndex - b.orderIndex);

  const segments: ReviewSegment[] = [];
  const carded = new Set<Warning>();
  let dbIndex = 0;

  for (const segment of base.segments) {
    if (segment.kind === "prose") {
      segments.push({ kind: "prose", html: segment.html });
      continue;
    }

    const spec = segment.item;
    const db = ordered[dbIndex++];
    const warnings = base.warnings.filter((w) => w.wpId && w.wpId === spec.wpId);
    warnings.forEach((w) => carded.add(w));

    segments.push({
      kind: "item",
      itemId: db?.id ?? "",
      item: spec,
      promptHtml: renderMarkdownToSafeHtml(spec.promptMd),
      persisted: toPersisted(db?.response ?? null),
      warnings,
    });
  }

  // Anything not surfaced on a card (unpaired tags, orphan closes, doc-level) is
  // shown in the banner so no warning silently disappears.
  const docWarnings = base.warnings.filter((w) => !carded.has(w));

  return { segments, docWarnings, isConventioned: base.isConventioned };
}

const VALID_STATUSES = new Set<ResponseStatus>(["answered", "flagged", "skipped"]);

function toPersisted(
  stored: { value: ResponseValue | null; status: string | null } | null,
): PersistedResponse | null {
  if (!stored) return null;
  const status = stored.status && VALID_STATUSES.has(stored.status as ResponseStatus)
    ? (stored.status as ResponseStatus)
    : null;
  const value = stored.value
    ? { text: stored.value.text, selected: stored.value.selected, other: stored.value.other }
    : null;
  return { value, status };
}
