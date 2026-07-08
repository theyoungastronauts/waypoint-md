"use client";

import { useEffect, useMemo, useRef } from "react";
import { buildAnchorFromRenderedSelection, renderedRangeFromSource } from "@/lib/anchor/source-map";
import { type Rect, useComments } from "./comments-store";

/**
 * A prose run that supports selection comments (§10). It renders the sanitized
 * server HTML, watches for a text selection within itself (mouse or long-press)
 * to offer a floating "Comment" button, and wraps any anchored comments in
 * clickable `<mark>` highlights.
 *
 * All source↔rendered mapping goes through the pure {@link ../../lib/anchor/source-map}
 * module: the DOM here only supplies rendered text and selection offsets. The
 * sanitized HTML is server-rendered (`dangerouslySetInnerHTML`) so prose is
 * visible before hydration; the highlight effect then re-derives `<mark>`s from a
 * clean copy of that HTML whenever the comment set changes. Because the `html`
 * prop is stable, React never reclaims the node and clobbers the marks.
 */
export function CommentableProse({
  html,
  source,
  sourceStart,
}: {
  html: string;
  source: string;
  sourceStart: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { highlightsFor, showButton, viewComment } = useComments();

  const highlights = highlightsFor(sourceStart);
  // A stable dependency so the wrapping effect only re-runs when the set changes.
  const highlightKey = useMemo(
    () => highlights.map((h) => `${h.commentId}:${h.localStart}-${h.localEnd}`).join("|"),
    [highlights],
  );

  // (Re)apply comment highlights over a clean copy of the server HTML. Resetting
  // to `html` first clears any prior marks before re-wrapping the current set.
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.innerHTML = html;

    const renderedText = container.textContent ?? "";
    for (const hl of highlights) {
      const range = renderedRangeFromSource(renderedText, source, hl.localStart, hl.localEnd);
      if (range) wrapRenderedRange(container, range.start, range.end, hl.commentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, highlightKey, source]);

  // Open a comment when its highlight is clicked (event delegation survives
  // re-wrapping).
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest?.("mark[data-wp-comment]") as HTMLElement | null;
      if (!mark || !container.contains(mark)) return;
      const id = mark.dataset.wpComment;
      if (id) viewComment(id, toRect(mark.getBoundingClientRect()));
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [viewComment]);

  // Offer a "Comment" button whenever a non-empty selection lands in this run.
  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSelectionChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(evaluateSelection, 150); // debounce; also covers long-press
    };
    const evaluateSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;

      const pre = document.createRange();
      pre.selectNodeContents(container);
      pre.setEnd(range.startContainer, range.startOffset);
      const selStart = pre.toString().length;
      const selText = range.toString();
      if (selText.trim().length === 0) return;

      const built = buildAnchorFromRenderedSelection({
        renderedText: container.textContent ?? "",
        selStart,
        selEnd: selStart + selText.length,
        segSource: source,
        segBase: sourceStart,
      });
      if (!built) return;
      showButton(built, toRect(range.getBoundingClientRect()));
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [source, sourceStart, showButton]);

  return (
    <div
      ref={ref}
      className="wp-prose"
      data-wp-prose
      // Server-rendered so prose is visible before hydration; the effect above
      // re-derives highlights from this same HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function toRect(r: DOMRect): Rect {
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Wrap the rendered character range `[start, end)` of `container` in `<mark>`
 * elements. Splits per text node (never crossing element boundaries), so a range
 * spanning inline formatting produces several contiguous, all-clickable marks.
 */
function wrapRenderedRange(container: HTMLElement, start: number, end: number, commentId: string): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  const ops: Array<{ node: Text; from: number; to: number }> = [];
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.nodeValue?.length ?? 0;
    const nodeStart = offset;
    const nodeEnd = offset + len;
    offset = nodeEnd;
    if (nodeEnd > start && nodeStart < end) {
      ops.push({ node, from: Math.max(start, nodeStart) - nodeStart, to: Math.min(end, nodeEnd) - nodeStart });
    }
    node = walker.nextNode() as Text | null;
  }
  // Apply last-to-first so a split never invalidates an earlier node's offsets.
  for (const op of ops.reverse()) {
    const range = document.createRange();
    range.setStart(op.node, op.from);
    range.setEnd(op.node, op.to);
    const mark = document.createElement("mark");
    mark.className = "wp-comment-mark";
    mark.dataset.wpComment = commentId;
    try {
      range.surroundContents(mark);
    } catch {
      // Range crossed a boundary unexpectedly — skip this fragment rather than throw.
    }
  }
}
