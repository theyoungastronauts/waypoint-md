import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures.js";
import { applyReview, parseDocument, extractReviewState } from "./index.js";
import type { ReviewState } from "./index.js";

function fixture(name: string): string {
  const found = loadFixtures().find((f) => f.name === name);
  if (!found) throw new Error(`fixture ${name} not found`);
  return found.raw;
}

const TEXT_DOC = [
  "<!-- wp:question id=\"q1\" type=\"text\" -->",
  "**A question.**",
  "<!-- wp:answer -->",
  "<!-- /wp:answer -->",
  "<!-- /wp:question -->",
  "",
].join("\n");

describe("answer interior writing (§11)", () => {
  it("writes the answer into the wp:answer block and round-trips it", () => {
    const out = applyReview(TEXT_DOC, { responses: { q1: { text: "Yes, stay on it." } } });
    expect(out).toContain("<!-- wp:answer -->\nYes, stay on it.\n<!-- /wp:answer -->");
    expect(extractReviewState(parseDocument(out)).responses?.q1).toEqual({ text: "Yes, stay on it." });
  });

  it("writes the status attribute on the answer-open comment", () => {
    const out = applyReview(TEXT_DOC, { responses: { q1: { text: "Later.", status: "flagged" } } });
    expect(out).toContain('<!-- wp:answer status="flagged" -->');
    expect(extractReviewState(parseDocument(out)).responses?.q1).toEqual({ text: "Later.", status: "flagged" });
  });
});

describe("checkbox rewriting keeps clean diffs (§2 goal 3, §11)", () => {
  const CHOICE_DOC = [
    "<!-- wp:question id=\"q1\" type=\"choice\" select=\"single\" -->",
    "**Pick one:**",
    "- [ ] Alpha",
    "- [ ] Beta",
    "- [ ] Gamma",
    "<!-- wp:answer -->",
    "<!-- /wp:answer -->",
    "<!-- /wp:question -->",
    "",
  ].join("\n");

  it("checks only the selected box and touches nothing else", () => {
    const out = applyReview(CHOICE_DOC, { responses: { q1: { selected: ["Beta"] } } });
    expect(out).toContain("- [ ] Alpha\n- [x] Beta\n- [ ] Gamma");
    // The only byte-level change from the source is the one checkbox and the stamp.
    const withoutStamp = out.replace(/^---\nwaypoint_status: completed\n---\n\n/, "");
    expect(withoutStamp).toBe(CHOICE_DOC.replace("- [ ] Beta", "- [x] Beta"));
  });

  it("moves the selection when a different box was already checked", () => {
    const preChecked = CHOICE_DOC.replace("- [ ] Alpha", "- [x] Alpha");
    const out = applyReview(preChecked, { responses: { q1: { selected: ["Gamma"] } } });
    expect(out).toContain("- [ ] Alpha\n- [ ] Beta\n- [x] Gamma");
  });
});

describe("F-1: formatted-leading labels don't corrupt on checkbox flip", () => {
  it("splices the marker, not the bullet, for an inline-code label (single-select)", () => {
    const out = applyReview(fixture("choice-formatted-labels.md"), {
      responses: { pkg: { selected: ["**@usepolaris/waypoint**"] } },
    });
    // Previously-checked inline-code option is cleanly unchecked, bullet intact...
    expect(out).toContain("- [ ] `waypoint-md`");
    // ...and the newly-selected bold option is checked.
    expect(out).toContain("- [x] **@usepolaris/waypoint**");
    // The old bug produced a mangled marker like "[ ]x]"; assert none exists.
    expect(out).not.toMatch(/\[[ xX]\]x\]/);
    expect(extractReviewState(parseDocument(out)).responses?.pkg).toEqual({
      selected: ["**@usepolaris/waypoint**"],
    });
  });

  it("handles strike- and bold-leading labels in multi-select", () => {
    const out = applyReview(fixture("choice-formatted-labels.md"), {
      responses: { envs: { selected: ["~~legacy~~", "**production**"] } },
    });
    expect(out).toContain("- [x] ~~legacy~~");
    expect(out).toContain("- [ ] `staging`");
    expect(out).toContain("- [x] **production**");
    expect(extractReviewState(parseDocument(out)).responses?.envs).toEqual({
      selected: ["~~legacy~~", "**production**"],
    });
  });
});

describe("frontmatter stamp only on non-empty review (§11)", () => {
  it("appends the stamp inside existing frontmatter", () => {
    const out = applyReview(fixture("kitchen-sink.md"), {
      responses: { q1: { text: "done" } },
      reviewedAt: "2026-07-07T12:00:00Z",
    });
    expect(out).toContain("waypoint_status: completed");
    expect(out).toContain("reviewed_at: 2026-07-07T12:00:00Z");
    // Existing frontmatter keys survive.
    expect(out).toContain('title: "RDS Migration Plan"');
  });

  it("creates frontmatter when the source has none", () => {
    const out = applyReview(TEXT_DOC, { responses: { q1: { text: "hi" } } });
    expect(out.startsWith("---\nwaypoint_status: completed\n---\n\n")).toBe(true);
  });

  it("omits reviewed_at when no timestamp is supplied (determinism)", () => {
    const out = applyReview(TEXT_DOC, { responses: { q1: { text: "hi" } } });
    expect(out).not.toContain("reviewed_at:");
  });
});

describe("comment splicing (§5.4, §11)", () => {
  const state: ReviewState = {
    comments: [
      {
        id: "c1",
        anchor: { exact: "intro prose", prefix: "Some ", suffix: " describing" },
        bodyMd: "This contradicts the earlier decision.",
        suggestionMd: "Some corrected prose describing",
      },
    ],
  };

  it("inserts the comment after the block containing the anchor", () => {
    const out = applyReview(fixture("kitchen-sink.md"), state);
    const commentIdx = out.indexOf("<!-- wp:comment");
    const introIdx = out.indexOf("Some intro prose describing");
    const q1Idx = out.indexOf('<!-- wp:question id="q1"');
    expect(commentIdx).toBeGreaterThan(introIdx);
    expect(commentIdx).toBeLessThan(q1Idx);
  });

  it("round-trips the comment with its nested suggestion", () => {
    const out = applyReview(fixture("kitchen-sink.md"), state);
    const recovered = extractReviewState(parseDocument(out));
    expect(recovered.comments).toEqual(state.comments);
  });

  it("skips comments whose anchor no longer matches (unanchored)", () => {
    const out = applyReview(TEXT_DOC, {
      comments: [{ id: "c9", anchor: { exact: "text that is nowhere in the doc" }, bodyMd: "orphan" }],
    });
    // Nothing spliced; only the frontmatter stamp differs from the source.
    expect(out).not.toContain("<!-- wp:comment");
  });
});

describe("anchor caps (§5.4)", () => {
  it("truncates exact over 200 chars and adds exact-hash", () => {
    const long = "A".repeat(250);
    const doc = `# Title\n\n${long}\n`;
    const out = applyReview(doc, { comments: [{ id: "c1", anchor: { exact: long }, bodyMd: "note" }] });
    const parsed = parseDocument(out);
    expect(parsed.comments[0].anchor.exact.length).toBe(200);
    expect(parsed.comments[0].anchor.exactHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("truncates prefix/suffix to 32 chars on export", () => {
    const prefix = "p".repeat(40);
    const doc = `# T\n\n${prefix}ANCHORHERE tail\n`;
    const out = applyReview(doc, {
      comments: [{ id: "c1", anchor: { exact: "ANCHORHERE", prefix, suffix: " tail more text than thirty-two chars here" }, bodyMd: "n" }],
    });
    const anchor = parseDocument(out).comments[0].anchor;
    expect(anchor.prefix?.length).toBe(32);
    expect(anchor.suffix?.length).toBe(32);
  });
});

describe("CRLF is preserved when the writer does touch bytes (§5.6)", () => {
  it("keeps \\r\\n in untouched regions and uses it in new content", () => {
    const out = applyReview(fixture("crlf.md"), { responses: { q1: { selected: ["Beta"] } } });
    expect(out).toContain("- [ ] Alpha\r\n- [x] Beta");
    expect(out).toContain("\r\nTrailing prose.\r\n");
    expect(out.startsWith("---\r\nwaypoint_status: completed\r\n---\r\n\r\n")).toBe(true);
    // No stray bare LF was introduced anywhere.
    expect(/[^\r]\n/.test(out)).toBe(false);
  });
});

describe("representative round-trip across every response kind + comments (§17.3)", () => {
  it("recovers text, single/multi selections, elaboration, statuses, and a comment", () => {
    const state: ReviewState = {
      responses: {
        q1: { text: "Right-size down after two weeks.", status: "answered" },
        q2: { selected: ["Per-device tokens"], status: "answered" },
        q3: { selected: ["production"], other: "Only prod after staging soak.", status: "flagged" },
      },
      comments: [
        {
          id: "c1",
          anchor: { exact: "intro prose", prefix: "Some ", suffix: " describing" },
          bodyMd: "This contradicts the earlier decision.",
          suggestionMd: "Some corrected prose describing",
        },
      ],
      reviewedAt: "2026-07-07T12:00:00Z",
    };
    const out = applyReview(fixture("kitchen-sink.md"), state);
    const recovered = extractReviewState(parseDocument(out));
    expect(recovered.responses).toEqual(state.responses);
    expect(recovered.comments).toEqual(state.comments);
  });
});

describe("descending-order splices never corrupt earlier spans", () => {
  it("applies many edits to one document with untouched prose intact", () => {
    const raw = fixture("kitchen-sink.md");
    const out = applyReview(raw, {
      responses: {
        q1: { text: "one" },
        q2: { selected: ["Single shared token"] },
        q3: { selected: ["production"] },
      },
    });
    // Prose that no edit targets is byte-for-byte unchanged.
    expect(out).toContain("Closing prose that should never be touched by the writer.");
    expect(out).toContain("Some intro prose describing the migration");
    // And the whole thing still parses cleanly.
    expect(parseDocument(out).warnings).toEqual([]);
  });
});
