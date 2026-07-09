import { describe, expect, it } from "vitest";
import type { Item } from "@waypoint/spec";

import { initialDraft, type ReviewItemInit } from "@/components/review/types";

function init(item: Partial<Item>, persisted: ReviewItemInit["persisted"] = null): ReviewItemInit {
  return {
    itemId: "it-1",
    item: {
      wpId: "q1",
      type: "choice",
      promptMd: "Pick one",
      spans: { block: { start: 0, end: 0 }, questionOpen: { start: 0, end: 0 } },
      ...item,
    } as Item,
    promptHtml: "Pick one",
    optionLabelsHtml: [],
    persisted,
    warnings: [],
  };
}

describe("initialDraft — choice elaboration defaults empty (SPEC 1.1.0)", () => {
  it("does NOT prefill a choice's elaboration from the embedded wp:answer draft", () => {
    // Pre-SPEC-1.1.0 this `other` was the agent's rationale bleeding into the box.
    const draft = initialDraft(
      init({
        type: "choice",
        select: "single",
        options: [{ label: "A", checked: true, marker: { start: 0, end: 3 } }],
        response: { selected: ["A"], other: "agent rationale that must not seed the box" },
      }),
    );
    expect(draft.other).toBe("");
    // The pre-check still seeds the selection — only the elaboration is dropped.
    expect(draft.selected).toEqual(["A"]);
  });

  it("still prefills a TEXT question's suggested draft answer (§5.2 unchanged)", () => {
    const draft = initialDraft(
      init({ type: "text", response: { text: "suggested draft answer" } }),
    );
    expect(draft.text).toBe("suggested draft answer");
  });

  it("restores a reviewer's own persisted elaboration on a choice (not the embedded draft)", () => {
    // A persisted response is the reviewer's saved work — it must come back.
    const draft = initialDraft(
      init(
        {
          type: "choice",
          select: "single",
          options: [{ label: "A", checked: false, marker: { start: 0, end: 3 } }],
          response: { other: "embedded draft" },
        },
        { value: { selected: ["A"], other: "my own words" }, status: "answered" },
      ),
    );
    expect(draft.other).toBe("my own words");
    expect(draft.selected).toEqual(["A"]);
  });
});
