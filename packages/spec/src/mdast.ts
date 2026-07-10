/**
 * The one place we touch the markdown AST. remark-parse (+ GFM + frontmatter)
 * gives us, entirely from `position` offsets:
 *   - exclusion ranges (code fences, inline code, frontmatter) so `wp:` tags
 *     inside code never parse (§5.6);
 *   - task-list options with their checkbox marker spans (§5.3);
 *   - top-level block spans, so comments can be inserted after the block that
 *     contains their anchor (§5.4, §11).
 *
 * We never re-serialize the tree — offsets index straight back into `raw`.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import type { Span } from "./types.js";

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);

/** A GFM task-list option located in the source. */
export interface TaskItem {
  start: number;
  end: number;
  checked: boolean;
  /** Span of the `[ ]` / `[x]` marker (3 chars). */
  marker: Span;
  /** Source-markdown label text, trimmed. */
  label: string;
  /** Start offset of the parent list — used to bound the choice prompt. */
  listStart: number;
}

/** Everything the parser and splice writer need from the AST. */
export interface DocumentAnalysis {
  /** Frontmatter block span (`---\n…\n---`), if present. */
  frontmatter: Span | null;
  /** Raw YAML body between the frontmatter fences, if present. */
  frontmatterText: string | null;
  /** Ranges where `wp:` comments must be ignored (code + frontmatter). */
  excluded: Span[];
  /** All GFM task-list options in the document. */
  taskItems: TaskItem[];
  /** Top-level block spans, in document order. */
  blocks: Span[];
}

function off(value: number | undefined): number {
  // remark always populates offsets when parsing from a string; guard for types.
  return value ?? 0;
}

export function analyzeDocument(raw: string): DocumentAnalysis {
  const tree = processor.parse(raw) as Root;

  let frontmatter: Span | null = null;
  let frontmatterText: string | null = null;
  const excluded: Span[] = [];
  const blocks: Span[] = [];
  const taskItems: TaskItem[] = [];

  for (const child of tree.children) {
    if (!child.position) continue;
    const span = { start: off(child.position.start.offset), end: off(child.position.end.offset) };
    blocks.push(span);
    if (child.type === "yaml") {
      frontmatter = span;
      frontmatterText = child.value;
      excluded.push(span);
    }
  }

  visit(tree, (node) => {
    if (!node.position) return;
    if (node.type === "code" || node.type === "inlineCode") {
      excluded.push({ start: off(node.position.start.offset), end: off(node.position.end.offset) });
    }
  });

  visit(tree, "listItem", (node, _index, parent) => {
    if (node.checked === null || node.checked === undefined || !node.position) return;
    const start = off(node.position.start.offset);
    const end = off(node.position.end.offset);
    // Locate the checkbox in the list item's OWN source, not from a child node's
    // offset. When a label begins with an inline construct (inline code, bold,
    // link, strike), remark leaves the paragraph offset on the "[", so deriving
    // the marker from the child swallows the "[ ] " prefix — flipping it would
    // then splice over the bullet and corrupt the document. The checkbox is
    // always the first "[ ]"/"[x]" after the bullet, so scan for it directly.
    const markerMatch = /\[[ xX]\]/.exec(raw.slice(start, end));
    if (!markerMatch) return;
    const markerStart = start + markerMatch.index;
    const markerEnd = markerStart + 3;
    // The label runs to the end of the list item's FIRST block — the paragraph
    // holding the checkbox and its text — so a soft-wrapped label that spans
    // several source lines is captured in full. Using the paragraph end (not the
    // whole list item) still keeps a nested sub-list or a following block, which
    // are later children, out of the label. Falls back to the first line only
    // when position info is missing. (Bounding to the marker's own line, as the
    // F-1 fix once did, truncated multi-line labels — this restores them without
    // touching the marker span, so checkbox-flip fidelity is unaffected.)
    const firstBlockEnd = node.children?.[0]?.position?.end?.offset;
    let labelEnd: number;
    if (firstBlockEnd != null) {
      labelEnd = Math.min(off(firstBlockEnd), end);
    } else {
      const newline = raw.indexOf("\n", markerEnd);
      labelEnd = newline !== -1 && newline < end ? newline : end;
    }
    taskItems.push({
      start,
      end,
      checked: node.checked === true,
      marker: { start: markerStart, end: markerEnd },
      label: raw.slice(markerEnd, labelEnd).trim(),
      listStart: parent?.position ? off(parent.position.start.offset) : start,
    });
  });

  return { frontmatter, frontmatterText, excluded, taskItems, blocks };
}
