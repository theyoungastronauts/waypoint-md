import { parseDocument, type Item, type Warning } from "@waypoint/spec";
import { renderMarkdownToSafeHtml } from "./pipeline";

/** A run of ordinary prose, pre-rendered to sanitized HTML. */
export interface ProseSegment {
  kind: "prose";
  html: string;
}

/** A `wp:question` block, surfaced as a parsed item for a card renderer. */
export interface ItemSegment {
  kind: "item";
  item: Item;
}

export type DocumentSegment = ProseSegment | ItemSegment;

export interface RenderedDocument {
  /** Prose and item segments in document order — render in-place (§9). */
  segments: DocumentSegment[];
  /** Parse warnings for this document (surfaced, never fatal). */
  warnings: Warning[];
  /** True when the document opted into the convention (`waypoint: 1`). */
  isConventioned: boolean;
}

/**
 * Split a document into ordered prose and item segments so `wp:` questions
 * render exactly where they sit in the source (§9). Prose runs go through the
 * sanitizing pipeline; item blocks are handed to the caller as parsed {@link
 * Item}s (rendered inert in Phase 3, interactive in Phase 4).
 *
 * The segmentation is the stable seam: Phase 4 swaps the item renderer without
 * touching this walk.
 */
export function renderDocument(rawMd: string): RenderedDocument {
  const parsed = parseDocument(rawMd);
  const items = [...parsed.items].sort((a, b) => a.spans.block.start - b.spans.block.start);
  const segments: DocumentSegment[] = [];
  let cursor = 0;

  const pushProse = (text: string) => {
    if (text.trim().length === 0) return;
    segments.push({ kind: "prose", html: renderMarkdownToSafeHtml(text) });
  };

  for (const item of items) {
    const { start, end } = item.spans.block;
    // Defensive: skip any item whose span overlaps what we've already emitted.
    if (start < cursor) continue;
    pushProse(rawMd.slice(cursor, start));
    segments.push({ kind: "item", item });
    cursor = end;
  }
  pushProse(rawMd.slice(cursor));

  return {
    segments,
    warnings: parsed.warnings,
    isConventioned: parsed.frontmatter.waypoint === 1,
  };
}
