import { describe, expect, it } from "vitest";
import type { DocumentDetail, ItemDetail } from "../documents";
import {
  appendSyntheticResponses,
  buildSyntheticEntries,
  renderSyntheticSection,
  type SyntheticEntry,
} from "../synthetic-export";

const textEntry: SyntheticEntry = {
  promptMd: "**What is the rollback window?**",
  anchorExact: "The rollback window is two hours.",
  type: "text",
  value: { text: "Two hours, matching the incident runbook." },
  status: "answered",
};

const choiceEntry: SyntheticEntry = {
  promptMd: "When do we migrate?",
  anchorExact: "upgraded instance class this weekend",
  type: "choice",
  value: { selected: ["This weekend"], other: "Pending on-call sign-off." },
  status: "flagged",
};

describe("appendSyntheticResponses — append only when warranted", () => {
  it("returns the body unchanged when there are no synthetic responses", () => {
    const body = "# Doc\n\nSome prose.\n";
    expect(appendSyntheticResponses(body, [])).toBe(body);
  });

  it("keeps the document body a byte-exact prefix of the output", () => {
    const body = "# Doc\n\nSome prose.\n";
    const out = appendSyntheticResponses(body, [textEntry]);
    expect(out.startsWith(body)).toBe(true);
    expect(out).toContain("## Waypoint responses");
  });

  it("separates a body with no trailing newline by a blank line", () => {
    const out = appendSyntheticResponses("no newline", [textEntry]);
    expect(out.startsWith("no newline\n\n## Waypoint responses")).toBe(true);
  });

  it("does not add extra blank lines when the body already ends with one", () => {
    const out = appendSyntheticResponses("body\n\n", [textEntry]);
    expect(out.startsWith("body\n\n## Waypoint responses")).toBe(true);
  });
});

describe("renderSyntheticSection — format", () => {
  it("renders the heading, quoted anchor, and answer for a text item", () => {
    const section = renderSyntheticSection([textEntry]);
    expect(section).toContain("## Waypoint responses");
    expect(section).toContain("### 1. What is the rollback window?");
    expect(section).toContain("> The rollback window is two hours.");
    expect(section).toContain("Two hours, matching the incident runbook.");
  });

  it("renders a choice selection, elaboration, and a status note", () => {
    const section = renderSyntheticSection([choiceEntry]);
    expect(section).toContain("**Selected:** This weekend");
    expect(section).toContain("Pending on-call sign-off.");
    expect(section).toContain("_Flagged for follow-up._");
  });

  it("numbers multiple entries in order", () => {
    const section = renderSyntheticSection([textEntry, choiceEntry]);
    expect(section).toContain("### 1. What is the rollback window?");
    expect(section).toContain("### 2. When do we migrate?");
  });
});

describe("buildSyntheticEntries — only answered synthetic items", () => {
  function item(partial: Partial<ItemDetail>): ItemDetail {
    return {
      id: partial.id ?? "i1",
      wpId: null,
      type: partial.type ?? "text",
      config: partial.config ?? null,
      promptMd: partial.promptMd ?? "Prompt",
      synthetic: partial.synthetic ?? true,
      anchor: partial.anchor ?? { exact: "quote", start: 0 },
      orderIndex: partial.orderIndex ?? 0,
      response: partial.response ?? null,
      attachments: partial.attachments ?? [],
    };
  }
  const detail = (items: ItemDetail[]) => ({ items }) as unknown as DocumentDetail;

  it("includes a synthetic item that has real answer content", () => {
    const entries = buildSyntheticEntries(
      detail([item({ response: { value: { text: "answer" }, status: "answered", updatedAt: "t" } })]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].anchorExact).toBe("quote");
  });

  it("excludes a synthetic item with no response", () => {
    expect(buildSyntheticEntries(detail([item({ response: null })]))).toHaveLength(0);
  });

  it("excludes a synthetic item whose response is empty", () => {
    const entries = buildSyntheticEntries(
      detail([item({ response: { value: {}, status: null, updatedAt: "t" } })]),
    );
    expect(entries).toHaveLength(0);
  });

  it("never includes non-synthetic items", () => {
    const entries = buildSyntheticEntries(
      detail([
        item({ synthetic: false, response: { value: { text: "wp answer" }, status: "answered", updatedAt: "t" } }),
      ]),
    );
    expect(entries).toHaveLength(0);
  });
});
