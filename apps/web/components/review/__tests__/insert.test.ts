import { describe, expect, it } from "vitest";

import { applyInsert, type Draft } from "@/components/review/types";

const base = (over: Partial<Draft> = {}): Draft => ({
  text: "",
  selected: [],
  other: "",
  status: null,
  ...over,
});

describe("applyInsert — insert into answer (§14)", () => {
  it("replaces the text field for a text item in replace mode", () => {
    const next = applyInsert(base({ text: "old" }), "text", "new answer", "replace");
    expect(next.text).toBe("new answer");
  });

  it("appends after existing text with a blank-line separator", () => {
    const next = applyInsert(base({ text: "first" }), "text", "second", "append");
    expect(next.text).toBe("first\n\nsecond");
  });

  it("treats append into an empty field as a plain set (no leading blank lines)", () => {
    const next = applyInsert(base({ text: "   " }), "text", "answer", "append");
    expect(next.text).toBe("answer");
  });

  it("trims trailing whitespace before the separator when appending", () => {
    const next = applyInsert(base({ text: "first \n\n" }), "text", "second", "append");
    expect(next.text).toBe("first\n\nsecond");
  });

  it("routes choice inserts into the elaboration field, never the selection", () => {
    const next = applyInsert(base({ selected: ["A"], other: "note" }), "choice", "more", "append");
    expect(next.other).toBe("note\n\nmore");
    // The selection is untouched.
    expect(next.selected).toEqual(["A"]);
    expect(next.text).toBe("");
  });

  it("replaces the elaboration field for a choice item in replace mode", () => {
    const next = applyInsert(base({ selected: ["A"], other: "note" }), "choice", "fresh", "replace");
    expect(next.other).toBe("fresh");
    expect(next.selected).toEqual(["A"]);
  });
});
