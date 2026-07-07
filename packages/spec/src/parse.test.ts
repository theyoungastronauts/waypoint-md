import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures.js";
import { parseDocument } from "./index.js";

function fixture(name: string): string {
  const found = loadFixtures().find((f) => f.name === name);
  if (!found) throw new Error(`fixture ${name} not found`);
  return found.raw;
}

describe("frontmatter (§5.1)", () => {
  it("parses the opt-in marker and metadata", () => {
    const { frontmatter } = parseDocument(fixture("kitchen-sink.md"));
    expect(frontmatter.waypoint).toBe(1);
    expect(frontmatter.title).toBe("RDS Migration Plan");
    expect(frontmatter.project).toBe("acme-api");
    expect(frontmatter.source).toBe("docs/plan.md");
  });

  it("is empty for a no-frontmatter document", () => {
    expect(parseDocument("# Hi\n\ntext\n").frontmatter).toEqual({});
  });
});

describe("kitchen-sink items (§5.2, §5.3)", () => {
  const parsed = parseDocument(fixture("kitchen-sink.md"));

  it("parses all three questions with no warnings", () => {
    expect(parsed.items.map((i) => i.wpId)).toEqual(["q1", "q2", "q3"]);
    expect(parsed.warnings).toEqual([]);
  });

  it("parses a text question with a pre-filled draft and status", () => {
    const q1 = parsed.items[0];
    expect(q1.type).toBe("text");
    expect(q1.promptMd).toContain("Q1 — Sizing:");
    expect(q1.response).toEqual({
      text: "Stay on the upgraded class through end of quarter, then re-evaluate.",
      status: "answered",
    });
  });

  it("parses a single-select choice with its checked option", () => {
    const q2 = parsed.items[1];
    expect(q2.type).toBe("choice");
    expect(q2.select).toBe("single");
    expect(q2.options?.map((o) => o.label)).toEqual([
      "Single shared token",
      "Per-device tokens",
      "Tailscale-only, no app auth",
    ]);
    expect(q2.response).toEqual({ selected: ["Tailscale-only, no app auth"] });
  });

  it("parses a multi-select choice preserving document order", () => {
    const q3 = parsed.items[2];
    expect(q3.select).toBe("multi");
    expect(q3.response).toEqual({ selected: ["staging", "dev"] });
  });
});

describe("first-checked-wins in select=single (ratified §5.3)", () => {
  const parsed = parseDocument(fixture("choice-multi-checked-single.md"));

  it("warns and keeps only the first checked option", () => {
    expect(parsed.warnings.map((w) => w.code)).toContain("multi-checked-single");
    expect(parsed.items[0].response).toEqual({ selected: ["First option"] });
  });
});

describe("text-only response on a choice question (§5.3)", () => {
  it("captures elaboration with no selection", () => {
    const parsed = parseDocument(fixture("choice-text-only.md"));
    expect(parsed.items[0].response).toEqual({
      other: "None of these — we're staying on DynamoDB for now.",
    });
  });
});

describe("choice labels with leading inline formatting (F-1)", () => {
  const raw = fixture("choice-formatted-labels.md");
  const parsed = parseDocument(raw);

  it("preserves source-markdown labels and locates markers from item source", () => {
    const pkg = parsed.items.find((i) => i.wpId === "pkg");
    expect(pkg?.options?.map((o) => o.label)).toEqual([
      "`waypoint-md`",
      "**@usepolaris/waypoint**",
      "[see the naming issue](https://example.com/issue)",
    ]);
    // Every marker span slices back to exactly a checkbox — never "- [".
    for (const item of parsed.items) {
      for (const opt of item.options ?? []) {
        expect(raw.slice(opt.marker.start, opt.marker.end)).toMatch(/^\[[ xX]\]$/);
      }
    }
    expect(pkg?.response).toEqual({ selected: ["`waypoint-md`"] });
  });
});

describe("fence-awareness (§5.6, §17.1)", () => {
  it("ignores wp tags inside fenced and inline code, parses the real one", () => {
    const parsed = parseDocument(fixture("code-fence-fake-wp.md"));
    expect(parsed.items.map((i) => i.wpId)).toEqual(["real"]);
    expect(parsed.warnings).toEqual([]);
  });
});

describe("no-convention document (§5.7)", () => {
  it("parses to zero items, comments, and warnings", () => {
    const parsed = parseDocument(fixture("no-convention.md"));
    expect(parsed.items).toEqual([]);
    expect(parsed.comments).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });
});

describe("malformed input degrades to warnings, never throws (§5.6)", () => {
  const parsed = parseDocument(fixture("malformed-pairs.md"));

  it("surfaces duplicate ids, orphan closes, and unclosed blocks", () => {
    const codes = parsed.warnings.map((w) => w.code);
    expect(codes).toContain("duplicate-id");
    expect(codes).toContain("orphan-answer-close");
    expect(codes).toContain("unclosed-question");
  });

  it("still produces usable items", () => {
    expect(parsed.items.length).toBe(3);
    expect(parsed.items[0].response).toEqual({ text: "First answer." });
  });
});

describe("CRLF is tolerated and never normalized (§5.6)", () => {
  it("captures spans that slice back to the exact CRLF source", () => {
    const raw = fixture("crlf.md");
    expect(raw).toContain("\r\n");
    const parsed = parseDocument(raw);
    const q1 = parsed.items[0];
    // The captured open-comment span slices back byte-exactly out of the CRLF source.
    expect(raw.slice(q1.spans.questionOpen.start, q1.spans.questionOpen.end)).toBe(
      '<!-- wp:question id="q1" type="choice" select="single" -->',
    );
    expect(q1.response).toEqual({ selected: ["Alpha"] });
  });
});

describe("comment parsing with a nested suggestion (§5.4)", () => {
  it("recovers the anchor, body, and suggestion", () => {
    const raw = [
      "The camcorder photo beat pays off in act three.",
      "",
      '<!-- wp:comment id="c1" exact="camcorder photo beat" prefix="The " suffix=" pays off" -->',
      "This contradicts the phase 2 decision — it's the barcode scanner now.",
      "<!-- wp:suggestion -->",
      "barcode scanner beat",
      "<!-- /wp:suggestion -->",
      "<!-- /wp:comment -->",
      "",
    ].join("\n");
    const parsed = parseDocument(raw);
    expect(parsed.comments).toHaveLength(1);
    const c = parsed.comments[0];
    expect(c.id).toBe("c1");
    expect(c.anchor.exact).toBe("camcorder photo beat");
    expect(c.anchor.prefix).toBe("The ");
    expect(c.anchor.suffix).toBe(" pays off");
    expect(c.bodyMd).toBe("This contradicts the phase 2 decision — it's the barcode scanner now.");
    expect(c.suggestionMd).toBe("barcode scanner beat");
  });

  it("decodes HTML-encoded attribute values", () => {
    const raw = '<!-- wp:comment id="c1" exact="a &quot;quoted&quot; &amp; &lt;tagged&gt; bit" -->\nbody\n<!-- /wp:comment -->\n';
    const parsed = parseDocument(raw);
    expect(parsed.comments[0].anchor.exact).toBe('a "quoted" & <tagged> bit');
  });
});
