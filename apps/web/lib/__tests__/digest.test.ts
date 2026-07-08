import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResponseValue } from "@waypoint/spec";

import { buildDigest } from "@/lib/digest";
import type { CommentDetail, DocumentDetail, ItemDetail, SyntheticAnchor } from "@/lib/documents";

const FIXTURES = path.resolve(process.cwd(), "packages/spec/fixtures");
const kitchenSink = readFileSync(path.join(FIXTURES, "kitchen-sink.md"), "utf8");

const AT = "2026-07-08T12:00:00.000Z";

/** Build a minimal {@link DocumentDetail}; only the fields the digest reads matter. */
function makeDetail(over: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: "doc1",
    projectId: null,
    title: null,
    rawMd: "",
    frontmatter: null,
    sourceType: "paste",
    sourcePath: null,
    sourceUrl: null,
    pushedFromHost: null,
    specVersion: null,
    status: "in_review",
    supersedesId: null,
    createdAt: AT,
    updatedAt: AT,
    projectName: null,
    items: [],
    comments: [],
    ...over,
  };
}

/** A `wp:` item row. Only `wpId` + `response` drive the annotated/digest merge. */
function item(wpId: string, value: ResponseValue | null, status: string | null = null): ItemDetail {
  return {
    id: `it-${wpId}`,
    wpId,
    type: "text",
    config: null,
    promptMd: null,
    synthetic: false,
    anchor: null,
    orderIndex: 0,
    response: value === null && status === null ? null : { value, status, updatedAt: AT },
  };
}

function synthetic(
  id: string,
  type: "text" | "choice",
  promptMd: string,
  anchor: SyntheticAnchor,
  value: ResponseValue | null,
  status: string | null,
): ItemDetail {
  return {
    id,
    wpId: null,
    type,
    config: null,
    promptMd,
    synthetic: true,
    anchor,
    orderIndex: 0,
    response: value === null && status === null ? null : { value, status, updatedAt: AT },
  };
}

function comment(over: Partial<CommentDetail> & Pick<CommentDetail, "id" | "anchor" | "bodyMd">): CommentDetail {
  return { suggestionMd: null, createdAt: AT, ...over };
}

describe("buildDigest — kitchen-sink with a known review state", () => {
  const detail = makeDetail({
    title: "RDS Migration Plan",
    projectName: "acme-api",
    sourcePath: "docs/plan.md",
    rawMd: kitchenSink,
    items: [
      item("q1", { text: "Right-size to db.r6g.large after the incident settles." }, "answered"),
      item("q2", { selected: ["Single shared token"], other: "prefer tailscale otherwise" }, "answered"),
      item("q3", { selected: ["staging", "dev"] }, "flagged"),
    ],
  });

  it("renders a compact, agent-actionable digest (eyeball the §11 bar)", () => {
    expect(buildDigest(detail, AT)).toMatchInlineSnapshot(`
      "---
      waypoint_digest: 1
      title: "RDS Migration Plan"
      project: "acme-api"
      source: "docs/plan.md"
      status: "in_review"
      reviewed_at: "2026-07-08T12:00:00.000Z"
      answered: 2
      flagged: 1
      skipped: 0
      untouched: 0
      total: 3
      comments: 0
      synthetic: 0
      ---

      # Digest — RDS Migration Plan

      ## Questions

      ### q1 · text · answered
      **Q:** **Q1 — Sizing:** Do we stay on the upgraded instance class, or right-size down once the incident settles?
      **A:** Right-size to db.r6g.large after the incident settles.

      ### q2 · choice (single) · answered
      **Q:** **Q2 — Auth model for v1:**
      **Selected:** Single shared token
      **Note:** prefer tailscale otherwise

      ### q3 · choice (multi) · flagged
      **Q:** **Q3 — Which environments get the change first?**
      **Selected:** staging, dev
      "
    `);
  });

  it("summarizes status counts in the frontmatter", () => {
    const digest = buildDigest(detail, AT);
    expect(digest).toContain("waypoint_digest: 1");
    expect(digest).toContain("answered: 2");
    expect(digest).toContain("flagged: 1");
    expect(digest).toContain("total: 3");
    expect(digest).toContain("comments: 0");
    expect(digest).toContain("synthetic: 0");
  });

  it("carries the reviewer's overrides as Q → A pairs", () => {
    const digest = buildDigest(detail, AT);
    expect(digest).toContain("### q1 · text · answered");
    expect(digest).toContain("**A:** Right-size to db.r6g.large after the incident settles.");
    expect(digest).toContain("### q2 · choice (single) · answered");
    expect(digest).toContain("**Selected:** Single shared token");
    expect(digest).toContain("**Note:** prefer tailscale otherwise");
    expect(digest).toContain("### q3 · choice (multi) · flagged");
    expect(digest).toContain("**Selected:** staging, dev");
  });

  it("omits the Comments and Structured-responses sections when empty", () => {
    const digest = buildDigest(detail, AT);
    expect(digest).not.toContain("## Comments");
    expect(digest).not.toContain("## Structured responses");
  });
});

describe("buildDigest — untouched document reflects the embedded state", () => {
  it("shows the pre-filled draft and checked boxes without any reviewer input", () => {
    const detail = makeDetail({ title: "RDS Migration Plan", rawMd: kitchenSink });
    const digest = buildDigest(detail, AT);
    // q1 ships a draft answer + status="answered" in the source.
    expect(digest).toContain("**A:** Stay on the upgraded class through end of quarter, then re-evaluate.");
    // q2/q3 ship checked boxes; they read as answered from the embedded state.
    expect(digest).toContain("**Selected:** Tailscale-only, no app auth");
    expect(digest).toContain("**Selected:** staging, dev");
    expect(digest).toContain("answered: 3");
    expect(digest).toContain("untouched: 0");
  });
});

describe("buildDigest — comments with quoted anchors", () => {
  const detail = makeDetail({
    title: "Copy edit",
    rawMd: "# Draft\n\nThe camcorder photo beat pays off in act three.\n",
    comments: [
      comment({
        id: "c1",
        anchor: { exact: "camcorder photo beat", prefix: "The ", suffix: " pays" },
        bodyMd: "This contradicts the phase 2 decision.",
        suggestionMd: "barcode scanner beat",
      }),
    ],
  });

  it("lists each comment with its anchor, body, and suggestion", () => {
    const digest = buildDigest(detail, AT);
    expect(digest).toContain("comments: 1");
    expect(digest).toContain("## Comments");
    expect(digest).toContain('**Anchor:** "camcorder photo beat"');
    expect(digest).toContain("**Comment:** This contradicts the phase 2 decision.");
    expect(digest).toContain("**Suggestion:** barcode scanner beat");
  });

  it("matches the full snapshot", () => {
    expect(buildDigest(detail, AT)).toMatchInlineSnapshot(`
      "---
      waypoint_digest: 1
      title: "Copy edit"
      status: "in_review"
      reviewed_at: "2026-07-08T12:00:00.000Z"
      answered: 0
      flagged: 0
      skipped: 0
      untouched: 0
      total: 0
      comments: 1
      synthetic: 0
      ---

      # Digest — Copy edit

      ## Comments

      ### c1
      **Anchor:** "camcorder photo beat"
      **Comment:** This contradicts the phase 2 decision.
      **Suggestion:** barcode scanner beat
      "
    `);
  });
});

describe("buildDigest — synthetic (adoptive-import) responses", () => {
  const detail = makeDetail({
    title: "Unstructured note",
    rawMd: "# Notes\n\nWe should pick a database and a deploy target.\n",
    items: [
      synthetic(
        "s1",
        "text",
        "**Which database?** Postgres or SQLite for v1.",
        { exact: "pick a database", start: 20 },
        { text: "SQLite for v1, revisit at scale." },
        "answered",
      ),
      synthetic(
        "s2",
        "choice",
        "Deploy target",
        { exact: "a deploy target", start: 40 },
        { selected: ["Fly.io"], other: "over Render" },
        "answered",
      ),
    ],
  });

  it("appends structured responses with anchors, numbered in order", () => {
    const digest = buildDigest(detail, AT);
    expect(digest).toContain("synthetic: 2");
    expect(digest).toContain("## Structured responses");
    expect(digest).toContain("### 1 · text · answered");
    expect(digest).toContain('**Anchor:** "pick a database"');
    expect(digest).toContain("**A:** SQLite for v1, revisit at scale.");
    expect(digest).toContain("### 2 · choice · answered");
    expect(digest).toContain("**Selected:** Fly.io");
    expect(digest).toContain("**Note:** over Render");
    // No wp: questions in this doc → no Questions section, total 0.
    expect(digest).not.toContain("## Questions");
    expect(digest).toContain("total: 0");
  });

  it("excludes unanswered synthetic items (only-when-warranted, §5.7)", () => {
    const withUnanswered = makeDetail({
      rawMd: detail.rawMd,
      items: [
        ...detail.items,
        synthetic("s3", "text", "Untouched", { exact: "target", start: 44 }, null, null),
      ],
    });
    expect(buildDigest(withUnanswered, AT)).toContain("synthetic: 2");
  });
});

describe("buildDigest — strips wp: markup folded into a prompt (Phase 9 W1)", () => {
  // A comment authored inside a question block (anchored to prompt text) sits
  // between the prompt and the answer, so the digest's re-parse folds the raw
  // `<!-- wp:comment -->` block into promptMd. The Q→A fields must stay clean;
  // the comment must still surface in `## Comments`.
  const detail = makeDetail({
    title: "Folded comment",
    rawMd:
      '<!-- wp:question id="q1" type="text" -->\n' +
      "**Pick a database** for the service.\n" +
      '<!-- wp:comment id="c1" exact="database" -->\n' +
      "Use Postgres, not SQLite, at this scale.\n" +
      "<!-- /wp:comment -->\n" +
      "<!-- wp:answer -->\n" +
      "<!-- /wp:answer -->\n" +
      "<!-- /wp:question -->\n",
    items: [item("q1", { text: "SQLite for v1." }, "answered")],
  });

  it("keeps the **Q:** line free of comment syntax and body text", () => {
    const digest = buildDigest(detail, AT);
    const qLine = digest.split("\n").find((l) => l.startsWith("**Q:**")) ?? "";
    expect(qLine).toContain("Pick a database");
    expect(qLine).not.toContain("wp:comment");
    expect(qLine).not.toContain("<!--");
    expect(qLine).not.toContain("Use Postgres");
  });

  it("still surfaces the folded comment in the Comments section", () => {
    const digest = buildDigest(detail, AT);
    expect(digest).toContain("## Comments");
    expect(digest).toContain('**Anchor:** "database"');
    expect(digest).toContain("**Comment:** Use Postgres, not SQLite, at this scale.");
  });
});

describe("buildDigest — flagged item with no answer", () => {
  it("shows the flag status and a no-answer marker", () => {
    const detail = makeDetail({
      rawMd:
        '<!-- wp:question id="q1" type="text" -->\n**Need input**\n<!-- wp:answer -->\n<!-- /wp:answer -->\n<!-- /wp:question -->\n',
      items: [item("q1", {}, "flagged")],
    });
    const digest = buildDigest(detail, AT);
    expect(digest).toContain("### q1 · text · flagged");
    expect(digest).toContain("**A:** _(no answer)_");
    expect(digest).toContain("flagged: 1");
  });
});
