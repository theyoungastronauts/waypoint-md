import { parseDocument } from "@waypoint/spec";
import { describe, expect, it } from "vitest";

import { assembleContext, SMALL_DOC_CHARS, type ItemAnswer } from "@/lib/ai/context";

/** Build the assembleContext inputs from a raw document + a focus + answers. */
function build(raw: string, focusedWpId: string | null, answers: Map<string, ItemAnswer> = new Map()) {
  const parsed = parseDocument(raw);
  return assembleContext({
    rawMd: raw,
    frontmatter: parsed.frontmatter,
    items: parsed.items,
    answers,
    focusedWpId,
  });
}

const filler = (n: number) => "lorem ipsum dolor sit amet consectetur. ".repeat(n);

const SMALL_DOC = `---
waypoint: 1
title: Small Doc
project: acme
---

# Intro

Some intro text.

<!-- wp:question id="q1" type="text" -->
**Q1 — Name:** What is the project name?
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

## Options

<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — Pick one:**
- [ ] Alpha
- [x] Bravo
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
`;

describe("assembleContext — small documents", () => {
  it("sends the whole document body when the doc is small", () => {
    expect(SMALL_DOC.length).toBeLessThanOrEqual(SMALL_DOC_CHARS);
    const ctx = build(SMALL_DOC, null);
    expect(ctx.windowed).toBe(false);
    expect(ctx.contextText).toContain("## Full document");
    // The frontmatter is summarized.
    expect(ctx.contextText).toContain("Title: Small Doc");
    expect(ctx.contextText).toContain("Project: acme");
  });

  it("indexes every item with its type and marks the focused one", () => {
    const ctx = build(SMALL_DOC, "q2");
    expect(ctx.contextText).toContain("[q1] (text)");
    expect(ctx.contextText).toContain("[q2] (choice/single)");
    // Focused item flagged with →, others with -.
    expect(ctx.contextText).toMatch(/→ \[q2\]/);
    expect(ctx.contextText).toMatch(/- \[q1\]/);
  });

  it("summarizes current answers in the index", () => {
    const answers = new Map<string, ItemAnswer>([
      ["q1", { value: { text: "Waypoint" }, status: "answered" }],
      ["q2", { value: { selected: ["Bravo"], other: "because it fits" }, status: "flagged" }],
    ]);
    const ctx = build(SMALL_DOC, null, answers);
    expect(ctx.contextText).toContain("Waypoint");
    expect(ctx.contextText).toContain("selected: Bravo");
    expect(ctx.contextText).toContain("note: because it fits");
    // A non-"answered" status is annotated.
    expect(ctx.contextText).toContain("[flagged]");
    // Unanswered items say so.
    const bare = build(SMALL_DOC, null);
    expect(bare.contextText).toContain("unanswered");
  });
});

describe("assembleContext — large documents (windowing)", () => {
  // A doc well over the small-doc threshold: a big early section, then a second
  // section holding the focused question. Windowing must keep the focused
  // section and drop the distant early one.
  const LARGE_DOC = `# Section One

EARLY_MARKER ${filler(200)}

# Section Two

Lead-in to the focused question.

<!-- wp:question id="qF" type="text" -->
**Focus Q:** What is the deep decision here?
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

Trailing note with LATE_MARKER.
`;

  it("windows around the focused item instead of shipping the whole doc", () => {
    expect(LARGE_DOC.length).toBeGreaterThan(SMALL_DOC_CHARS);
    const ctx = build(LARGE_DOC, "qF");
    expect(ctx.windowed).toBe(true);
    expect(ctx.contextText).toContain("## Section around the focused item");
    // The focused section is present…
    expect(ctx.contextText).toContain("Section Two");
    expect(ctx.contextText).toContain("LATE_MARKER");
    // …and the distant early section is not.
    expect(ctx.contextText).not.toContain("EARLY_MARKER");
    // The item index still covers the item.
    expect(ctx.contextText).toContain("[qF] (text)");
  });

  it("uses the leading excerpt when nothing is focused", () => {
    const ctx = build(LARGE_DOC, null);
    expect(ctx.windowed).toBe(true);
    expect(ctx.contextText).toContain("## Document excerpt (start)");
    expect(ctx.contextText).toContain("EARLY_MARKER");
  });

  it("clamps to a character window when the focused section itself is huge", () => {
    // One giant section: the question sits between two far-apart markers that
    // are outside the before/after window, so both must be trimmed away.
    const HUGE_SECTION = `# Only Section

BEFORE_MARKER
${filler(120)}

<!-- wp:question id="qH" type="text" -->
**Q:** deep
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

${filler(160)}
AFTER_MARKER
`;
    const ctx = build(HUGE_SECTION, "qH");
    expect(ctx.windowed).toBe(true);
    expect(ctx.contextText).toContain("## Section around the focused item");
    // The focused question is in the window…
    expect(ctx.contextText).toContain("deep");
    // …but the far markers are trimmed, with ellipsis markers showing the cut.
    expect(ctx.contextText).not.toContain("BEFORE_MARKER");
    expect(ctx.contextText).not.toContain("AFTER_MARKER");
    expect(ctx.contextText).toContain("…");
  });
});
