/**
 * DOM-selection → source-markdown mapping (§10) — the core of Phase 6.
 *
 * A selection comment must anchor to the **source markdown**, not the rendered
 * DOM: the exported `exact`/`prefix`/`suffix` are source substrings, so the
 * splice writer can re-locate the anchor by string match (§5.4, §11). But the
 * user selects *rendered* text, where markup like `**bold**`, `[link](url)`, and
 * entities has been stripped or transformed. This module bridges the two.
 *
 * The bridge is a deterministic **alignment** between the rendered text (as the
 * browser reports it) and the source slice it was rendered from. Rendered text
 * is, character for character, a subsequence of the source with markup removed,
 * so a greedy two-pointer walk yields an exact per-character offset map. The map
 * disambiguates repeated text positionally: the Nth rendered occurrence aligns
 * to the Nth source occurrence, which is what makes "select text that appears
 * twice" resolve to the right place.
 *
 * Everything here is pure (strings and numbers in, anchors out) and unit-tested;
 * the DOM parts (reading a Selection, wrapping <mark> ranges) live in the client
 * components and feed this module the plain-string inputs it needs.
 */

import { capCommentAnchor, PREFIX_SUFFIX_CAP, type CommentAnchor } from "@waypoint/spec";

/** A half-open `[start, end)` offset range. */
export interface Range {
  start: number;
  end: number;
}

/**
 * Align rendered text to its source slice. Returns `map` of length
 * `rendered.length + 1`, where `map[i]` is the source offset of the i-th
 * rendered character (and `map[rendered.length]` is the offset just past the
 * last consumed source character). Returns `null` when the rendered text is not
 * a subsequence of the source — the alignment ran out of source before
 * consuming every rendered character (exotic or mismatched content). Callers
 * degrade gracefully rather than store a bad anchor.
 */
export function alignRenderedToSource(rendered: string, source: string): number[] | null {
  const map = new Array<number>(rendered.length + 1);
  let s = 0;
  for (let r = 0; r < rendered.length; r++) {
    const ch = rendered[r];
    // Skip source-only characters (markup: `*_`[]()#>` fences, entities' tails,
    // escape backslashes, …) until the source character matches the rendered one.
    while (s < source.length && source[s] !== ch) s++;
    if (s >= source.length) return null;
    map[r] = s;
    s++;
  }
  map[rendered.length] = s;
  return map;
}

/**
 * Map a rendered-text `[selStart, selEnd)` selection to the source range it
 * covers. The end is the position just past the **last selected character**, so
 * trailing markup after the selection (e.g. a closing `_`) is never swept in.
 * Interior markup between two selected characters is included, because the
 * source range genuinely spans it.
 */
export function sourceRangeFromRendered(
  rendered: string,
  source: string,
  selStart: number,
  selEnd: number,
): Range | null {
  if (selStart < 0 || selEnd > rendered.length || selStart >= selEnd) return null;
  const map = alignRenderedToSource(rendered, source);
  if (!map) return null;
  // Each rendered char maps to exactly one source char, so +1 lands just past
  // the last selected character without pulling in following markup.
  return { start: map[selStart], end: map[selEnd - 1] + 1 };
}

/**
 * Inverse of {@link sourceRangeFromRendered}: given a source `[srcStart, srcEnd)`
 * range, find the rendered-text range that covers it — used to wrap matched
 * anchors in `<mark>` highlights. Returns `null` when no rendered character
 * falls inside the source range (e.g. the range is entirely markup).
 */
export function renderedRangeFromSource(
  rendered: string,
  source: string,
  srcStart: number,
  srcEnd: number,
): Range | null {
  const map = alignRenderedToSource(rendered, source);
  if (!map) return null;
  let start = -1;
  let end = -1;
  for (let i = 0; i < rendered.length; i++) {
    if (map[i] >= srcStart && map[i] < srcEnd) {
      if (start === -1) start = i;
      end = i + 1;
    }
  }
  return start === -1 ? null : { start, end };
}

/**
 * Locate an anchor within a source string, mirroring the splice writer's match
 * order (§11): try `prefix + exact + suffix` first so repeated `exact` text is
 * disambiguated by its context, then fall back to `exact` alone. Returns the
 * source range of `exact`, or `null` when the anchor no longer matches (the
 * "unanchored" degradation). Keeping this identical to the writer means: if a
 * comment highlights, it also exports to the right block.
 */
export function locateAnchorInSource(source: string, anchor: CommentAnchor): Range | null {
  const { exact, prefix, suffix } = anchor;
  if (!exact) return null;
  let start = -1;
  if (prefix || suffix) {
    const combined = `${prefix ?? ""}${exact}${suffix ?? ""}`;
    const idx = source.indexOf(combined);
    if (idx >= 0) start = idx + (prefix?.length ?? 0);
  }
  if (start < 0) start = source.indexOf(exact);
  if (start < 0) return null;
  return { start, end: start + exact.length };
}

/** A constructed anchor plus its absolute source offsets (for highlighting). */
export interface BuiltAnchor {
  anchor: CommentAnchor;
  sourceStart: number;
  sourceEnd: number;
}

/**
 * Construct a capped, export-ready {@link CommentAnchor} from a rendered-text
 * selection over one prose segment. `segSource` is the source slice the segment
 * was rendered from and `segBase` is that slice's absolute offset in `raw_md`.
 *
 * Whitespace at the selection edges is trimmed (in rendered space) so anchors
 * don't start or end on a space. `prefix`/`suffix` are the 32 source characters
 * on either side of the selection, so `prefix + exact + suffix` is a contiguous
 * source substring the writer can re-match. Returns `null` when the selection
 * can't be aligned or reduces to nothing.
 */
export function buildAnchorFromRenderedSelection(params: {
  renderedText: string;
  selStart: number;
  selEnd: number;
  segSource: string;
  segBase: number;
}): BuiltAnchor | null {
  const { renderedText, segSource, segBase } = params;
  let { selStart, selEnd } = params;

  while (selStart < selEnd && /\s/.test(renderedText[selStart])) selStart++;
  while (selEnd > selStart && /\s/.test(renderedText[selEnd - 1])) selEnd--;
  if (selStart >= selEnd) return null;

  const range = sourceRangeFromRendered(renderedText, segSource, selStart, selEnd);
  if (!range) return null;

  const exact = segSource.slice(range.start, range.end);
  if (exact.trim().length === 0) return null;

  const prefix = segSource.slice(Math.max(0, range.start - PREFIX_SUFFIX_CAP), range.start);
  const suffix = segSource.slice(range.end, range.end + PREFIX_SUFFIX_CAP);

  const anchor = capCommentAnchor({
    exact,
    prefix: prefix.length > 0 ? prefix : undefined,
    suffix: suffix.length > 0 ? suffix : undefined,
  });

  return { anchor, sourceStart: segBase + range.start, sourceEnd: segBase + range.end };
}
