import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentDetail, ItemDetail } from "@/lib/documents";
import {
  assembleBrief,
  briefCacheKey,
  buildBriefSource,
  buildBriefUserPrompt,
  plainText,
} from "@/lib/voice/brief";

const fixture = (name: string) =>
  readFileSync(path.resolve(process.cwd(), "packages/spec/fixtures", name), "utf8");

function item(partial: Partial<ItemDetail> & Pick<ItemDetail, "id" | "type" | "orderIndex">): ItemDetail {
  return {
    wpId: null,
    config: null,
    promptMd: "",
    synthetic: false,
    anchor: null,
    response: null,
    attachments: [],
    ...partial,
  };
}

function doc(rawMd: string, items: ItemDetail[], title = "Doc"): DocumentDetail {
  return { id: "doc-1", title, rawMd, items, comments: [], projectName: null } as unknown as DocumentDetail;
}

const rationaleDoc = doc(fixture("choice-with-rationale.md"), [
  item({
    id: "item-db",
    wpId: "db",
    type: "choice",
    orderIndex: 0,
    promptMd: "**Which database do we standardize on for v1?**",
    config: {
      select: "single",
      options: [
        { label: "Postgres", checked: false },
        { label: "SQLite", checked: true },
        { label: "DynamoDB", checked: false },
      ],
    },
  }),
]);

describe("buildBriefSource", () => {
  it("carries item ids, canonical labels, the suggestion and the rationale", () => {
    const source = buildBriefSource(rationaleDoc);
    expect(source.questions).toHaveLength(1);
    const [q] = source.questions;
    expect(q.itemId).toBe("item-db");
    expect(q.number).toBe(1);
    expect(q.select).toBe("single");
    expect(q.options).toEqual([
      { label: "Postgres", suggested: false },
      { label: "SQLite", suggested: true },
      { label: "DynamoDB", suggested: false },
    ]);
    expect(q.rationale).toMatch(/single-binary deploy story/);
  });

  it("orders convention items first, then synthetic ones, as the review page does", () => {
    const source = buildBriefSource(
      doc("plain", [
        item({ id: "s1", type: "text", orderIndex: 0, synthetic: true, anchor: { exact: "quote", start: 0 } }),
        item({ id: "c2", type: "text", orderIndex: 2, wpId: "b" }),
        item({ id: "c1", type: "text", orderIndex: 1, wpId: "a" }),
      ]),
    );
    expect(source.questions.map((q) => [q.itemId, q.number])).toEqual([
      ["c1", 1],
      ["c2", 2],
      ["s1", 3],
    ]);
    expect(source.questions[2].anchorQuote).toBe("quote");
  });
});

describe("briefCacheKey", () => {
  it("is stable for the same document version", () => {
    expect(briefCacheKey(buildBriefSource(rationaleDoc))).toBe(briefCacheKey(buildBriefSource(rationaleDoc)));
  });

  it("changes when the source bytes change", () => {
    const changed = doc(`${rationaleDoc.rawMd}\nmore`, rationaleDoc.items);
    expect(briefCacheKey(buildBriefSource(changed))).not.toBe(briefCacheKey(buildBriefSource(rationaleDoc)));
  });

  it("changes when the item set changes (adoptive import adds items)", () => {
    const more = doc(rationaleDoc.rawMd, [
      ...rationaleDoc.items,
      item({ id: "s1", type: "text", orderIndex: 1, synthetic: true, anchor: { exact: "x", start: 0 } }),
    ]);
    expect(briefCacheKey(buildBriefSource(more))).not.toBe(briefCacheKey(buildBriefSource(rationaleDoc)));
  });
});

describe("buildBriefUserPrompt", () => {
  it("numbers questions, lists options and marks the suggestion", () => {
    const prompt = buildBriefUserPrompt(buildBriefSource(rationaleDoc));
    expect(prompt).toContain("Question 1 (choice, single):");
    expect(prompt).toContain("Option 2: SQLite  [the author's suggestion]");
    expect(prompt).toContain("Author's rationale: SQLite keeps");
  });
});

describe("assembleBrief", () => {
  const source = buildBriefSource(rationaleDoc);

  it("uses the model's wording but never its labels or ids", () => {
    const brief = assembleBrief(source, {
      intro: "This is about picking a database.",
      questions: [
        {
          number: 1,
          spoken: "Which database should v1 use?",
          options: ["Postgres", "SQLite, the suggestion", "Dynamo"],
          notes: ["SQLite keeps deploys to one binary."],
        },
      ],
      background: [{ topic: "deploy", text: "Single binary." }],
    });
    const [q] = brief.questions;
    expect(q.itemId).toBe("item-db");
    expect(q.spoken).toBe("Which database should v1 use?");
    expect(q.options.map((o) => o.label)).toEqual(["Postgres", "SQLite", "DynamoDB"]);
    expect(q.options[1].spoken).toBe("SQLite, the suggestion");
    expect(q.suggested).toEqual(["SQLite"]);
    expect(q.notes).toEqual(["SQLite keeps deploys to one binary."]);
    expect(brief.background).toEqual([{ topic: "deploy", text: "Single binary." }]);
  });

  it("falls back to the labels when the option count does not match", () => {
    const brief = assembleBrief(source, {
      questions: [{ number: 1, spoken: "Pick one.", options: ["Postgres", "SQLite"] }],
    });
    expect(brief.questions[0].options.map((o) => o.spoken)).toEqual(["Postgres", "SQLite", "DynamoDB"]);
  });

  it("falls back to the document's text for a question the model skipped, and uses the rationale as a note", () => {
    const brief = assembleBrief(source, { questions: [{ number: 7, spoken: "Not a real question" }] });
    const [q] = brief.questions;
    expect(brief.questions).toHaveLength(1);
    expect(q.spoken).toBe("Which database do we standardize on for v1?");
    expect(q.notes[0]).toMatch(/^SQLite keeps the single-binary deploy story/);
    expect(brief.intro).toBe("This is the review for Doc.");
  });

  it("ignores a duplicate number after the first", () => {
    const brief = assembleBrief(source, {
      questions: [
        { number: 1, spoken: "First wording" },
        { number: 1, spoken: "Second wording" },
      ],
    });
    expect(brief.questions[0].spoken).toBe("First wording");
  });
});

describe("plainText", () => {
  it("strips light markdown and comments", () => {
    expect(plainText("**Q1 — Sizing:** see [the doc](https://x.y) `now`<!-- c -->")).toBe(
      "Q1 — Sizing: see the doc now",
    );
  });
});
