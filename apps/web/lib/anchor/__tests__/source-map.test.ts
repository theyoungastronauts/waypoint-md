import { describe, expect, it } from "vitest";
import { applyReview, parseDocument, type CommentAnchor } from "@waypoint/spec";
import {
  alignRenderedToSource,
  buildAnchorFromRenderedSelection,
  locateAnchorInSource,
  renderedRangeFromSource,
  sourceRangeFromRendered,
} from "../source-map";

/** Build an anchor from a whole-segment rendered selection by rendered offsets. */
function anchorFor(rendered: string, source: string, from: number, to: number, base = 0) {
  return buildAnchorFromRenderedSelection({
    renderedText: rendered,
    selStart: from,
    selEnd: to,
    segSource: source,
    segBase: base,
  });
}

describe("alignRenderedToSource", () => {
  it("maps plain text one-to-one", () => {
    const map = alignRenderedToSource("abc", "abc");
    expect(map).toEqual([0, 1, 2, 3]);
  });

  it("skips source-only markup characters (bold)", () => {
    // rendered "ab" from source "a**b**"
    const map = alignRenderedToSource("ab", "a**b**");
    expect(map).toEqual([0, 3, 4]); // 'a'@0, 'b'@3, end just past 'b'
  });

  it("returns null when rendered is not a subsequence of source", () => {
    expect(alignRenderedToSource("abcX", "abc")).toBeNull();
  });
});

describe("sourceRangeFromRendered", () => {
  it("does not sweep in trailing markup after the last selected char", () => {
    // source "_italic_ x" renders "italic x"; selecting exactly "italic"
    const source = "_italic_ x";
    const rendered = "italic x";
    const range = sourceRangeFromRendered(rendered, source, 0, 6)!;
    expect(source.slice(range.start, range.end)).toBe("italic"); // no trailing "_"
  });

  it("includes interior markup spanned by the selection", () => {
    const source = "a **b** c";
    const rendered = "a b c";
    const range = sourceRangeFromRendered(rendered, source, 0, 5)!;
    expect(source.slice(range.start, range.end)).toBe("a **b** c");
  });

  it("rejects an empty or inverted range", () => {
    expect(sourceRangeFromRendered("abc", "abc", 2, 2)).toBeNull();
    expect(sourceRangeFromRendered("abc", "abc", 2, 1)).toBeNull();
  });
});

describe("buildAnchorFromRenderedSelection — exact is SOURCE markdown, not rendered", () => {
  it("selection inside a link stores the source label text", () => {
    const source = "See [the docs](https://x.com) now";
    const rendered = "See the docs now";
    const built = anchorFor(rendered, source, 4, 12)!; // "the docs"
    expect(built.anchor.exact).toBe("the docs");
    // prefix+exact+suffix must be a contiguous source substring (writer re-matches it).
    const { prefix, exact, suffix } = built.anchor;
    expect(source.includes(`${prefix ?? ""}${exact}${suffix ?? ""}`)).toBe(true);
  });

  it("selection spanning bold keeps the ** markers in exact (source, not rendered)", () => {
    const source = "a **b** c";
    const rendered = "a b c";
    const built = anchorFor(rendered, source, 0, 5)!;
    expect(built.anchor.exact).toBe("a **b** c");
  });

  it("trims whitespace at the selection edges", () => {
    const source = "keep the word here";
    const rendered = source;
    const built = anchorFor(rendered, source, 4, 13)!; // " the word" with a leading space
    expect(built.anchor.exact).toBe("the word");
  });

  it("returns null for a whitespace-only selection", () => {
    expect(anchorFor("a   b", "a   b", 1, 4)).toBeNull();
  });

  it("reports absolute source offsets using segBase", () => {
    const built = anchorFor("hello world", "hello world", 6, 11, 100)!; // "world"
    expect(built.sourceStart).toBe(106);
    expect(built.sourceEnd).toBe(111);
  });

  it("crosses a paragraph boundary (rendered has no separator; source has a blank line)", () => {
    const source = "Para one.\n\nPara two.";
    const rendered = "Para one.Para two."; // textContent concatenates with no separator
    const built = anchorFor(rendered, source, 5, 18)!; // "one.Para two."
    expect(built.anchor.exact).toBe("one.\n\nPara two.");
  });
});

describe("duplicate text is disambiguated by prefix/suffix context (the killer test)", () => {
  it("resolves a selection to the second occurrence, not the first", () => {
    const source = "the plan is good. the plan is bad.";
    const rendered = source; // plain prose
    const secondStart = source.indexOf("the plan", 1); // 18
    const built = anchorFor(rendered, source, secondStart, secondStart + "the plan".length)!;

    // exact alone is ambiguous (matches offset 0); the writer's prefix+exact+suffix
    // match must resolve to the second occurrence.
    expect(source.indexOf(built.anchor.exact)).toBe(0);
    const located = locateAnchorInSource(source, built.anchor)!;
    expect(located.start).toBe(secondStart);
  });
});

describe("caps (§5.4)", () => {
  it("truncates an over-long exact and attaches a hash", () => {
    const long = "x".repeat(250);
    const source = `intro ${long} outro`;
    const rendered = source;
    const built = anchorFor(rendered, source, 6, 6 + 250)!;
    expect(built.anchor.exact.length).toBe(200);
    expect(built.anchor.exactHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("caps prefix/suffix to 32 chars", () => {
    const source = `${"p".repeat(50)}ANCHOR${"s".repeat(50)}`;
    const rendered = source;
    const start = source.indexOf("ANCHOR");
    const built = anchorFor(rendered, source, start, start + "ANCHOR".length)!;
    expect(built.anchor.prefix?.length).toBe(32);
    expect(built.anchor.suffix?.length).toBe(32);
  });
});

describe("renderedRangeFromSource (highlight inverse)", () => {
  it("maps a source range back to the rendered range that covers it", () => {
    const source = "This is **very** bold";
    const rendered = "This is very bold";
    const veryStart = source.indexOf("very"); // 10
    const range = renderedRangeFromSource(rendered, source, veryStart, veryStart + 4)!;
    expect(rendered.slice(range.start, range.end)).toBe("very");
  });

  it("returns null when the source range is entirely markup", () => {
    // source "**x**", the leading "**" (0..2) contains no rendered characters
    expect(renderedRangeFromSource("x", "**x**", 0, 2)).toBeNull();
  });
});

describe("integration: a UI-built anchor exports to the right block via applyReview", () => {
  it("places the comment after the second matching block and re-parses cleanly", () => {
    const doc = [
      "---",
      "waypoint: 1",
      "---",
      "",
      "The plan is solid overall.",
      "",
      "But the plan has a gap in section two.",
      "",
    ].join("\n");

    // Simulate selecting "the plan" in the SECOND prose paragraph. That paragraph's
    // source slice and its absolute base offset come from the render segmentation.
    const segSource = "But the plan has a gap in section two.";
    const segBase = doc.indexOf(segSource);
    const rendered = segSource;
    const at = segSource.indexOf("the plan");
    const built = anchorFor(rendered, segSource, at, at + "the plan".length, segBase)!;

    const out = applyReview(doc, {
      comments: [{ id: "c1", anchor: built.anchor as CommentAnchor, bodyMd: "which plan?" }],
    });

    // The comment lands after the SECOND paragraph, not the first.
    const firstPara = out.indexOf("The plan is solid overall.");
    const secondPara = out.indexOf("But the plan has a gap");
    const commentIdx = out.indexOf("<!-- wp:comment");
    expect(commentIdx).toBeGreaterThan(secondPara);
    expect(secondPara).toBeGreaterThan(firstPara);

    const reparsed = parseDocument(out);
    expect(reparsed.comments).toHaveLength(1);
    expect(reparsed.comments[0].bodyMd).toBe("which plan?");
  });
});
