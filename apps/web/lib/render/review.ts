import type { Item, ItemSpans, ItemType, ResponseStatus, ResponseValue, Warning } from "@waypoint/spec";
import type { PersistedResponse, ReviewItemInit, ReviewSegment } from "@/components/review/types";
import type { ItemDetail, SyntheticAnchor } from "../documents";
import { renderDocument } from "./document";
import { renderInlineMarkdownToSafeHtml, renderMarkdownToSafeHtml } from "./pipeline";

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
  // Synthetic items have no `wp:` block in the source (they are DB-only, §5.7),
  // so they never pair with a rendered segment — exclude them from the in-place
  // walk. They surface through {@link buildSyntheticInits} in a dedicated section.
  const ordered = [...dbItems].filter((d) => !d.synthetic).sort((a, b) => a.orderIndex - b.orderIndex);

  const segments: ReviewSegment[] = [];
  const carded = new Set<Warning>();
  let dbIndex = 0;

  for (const segment of base.segments) {
    if (segment.kind === "prose") {
      segments.push({
        kind: "prose",
        html: segment.html,
        source: segment.source,
        sourceStart: segment.sourceStart,
      });
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
      optionLabelsHtml: (spec.options ?? []).map((o) => renderInlineMarkdownToSafeHtml(o.label)),
      rationaleHtml: spec.rationale ? renderMarkdownToSafeHtml(spec.rationale) : undefined,
      persisted: toPersisted(db?.response ?? null),
      warnings,
    });
  }

  // Anything not surfaced on a card (unpaired tags, orphan closes, doc-level) is
  // shown in the banner so no warning silently disappears.
  const docWarnings = base.warnings.filter((w) => !carded.has(w));

  return { segments, docWarnings, isConventioned: base.isConventioned };
}

/**
 * Synthetic items live only in the DB (no `wp:` block in `raw_md`), so they have
 * no real byte spans. The interactive cards never read spans; this placeholder
 * satisfies the {@link Item} shape the card renderers expect.
 */
const SYNTHETIC_SPANS: ItemSpans = {
  block: { start: 0, end: 0 },
  questionOpen: { start: 0, end: 0 },
};

/**
 * Build interactive-card inits for a document's synthetic (adoptive-import)
 * items (§5.7). They render as ordinary Question/Choice cards — same autosave
 * target (`PUT /api/items/:id/response`), same focus/progress model — in a
 * dedicated "Structured review" section, each carrying the source quote it was
 * anchored to. Prompt and option markdown are sanitized here, server-side.
 */
export function buildSyntheticInits(dbItems: ItemDetail[]): ReviewItemInit[] {
  return dbItems
    .filter((db) => db.synthetic)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((db) => {
      const type: ItemType = db.type === "choice" ? "choice" : "text";
      const options = (db.config?.options ?? []).map((o) => ({
        label: o.label,
        checked: false,
        marker: { start: 0, end: 0 },
      }));
      const item: Item = {
        wpId: db.wpId ?? "",
        type,
        select: type === "choice" ? db.config?.select ?? "single" : undefined,
        promptMd: db.promptMd ?? "",
        options: type === "choice" ? options : undefined,
        spans: SYNTHETIC_SPANS,
      };
      return {
        itemId: db.id,
        item,
        promptHtml: renderMarkdownToSafeHtml(db.promptMd ?? ""),
        optionLabelsHtml: options.map((o) => renderInlineMarkdownToSafeHtml(o.label)),
        persisted: toPersisted(db.response ?? null),
        warnings: [],
        synthetic: { anchorExact: (db.anchor as SyntheticAnchor | null)?.exact ?? "" },
      };
    });
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
