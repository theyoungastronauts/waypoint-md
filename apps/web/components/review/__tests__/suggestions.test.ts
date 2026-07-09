import { describe, expect, it } from "vitest";

import { hasSuggestion, splitSuggestions } from "@/components/review/suggestions";

describe("splitSuggestions — CRLF", () => {
  it("detects a wpsuggest fence with CRLF line endings", () => {
    const msg = "Here you go:\r\n```wpsuggest\r\nYes — adopt A.\r\n```\r\nDone.";
    const segs = splitSuggestions(msg);
    const suggestion = segs.find((s) => s.kind === "suggestion");
    expect(suggestion?.text).toBe("Yes — adopt A.");
  });
});

describe("splitSuggestions — wpsuggest fence extraction (§14, B-1)", () => {
  it("returns the whole message as a single prose run when there is no fence", () => {
    const msg = "Here is my take.\n\nIt has two paragraphs.";
    expect(splitSuggestions(msg)).toEqual([{ kind: "prose", text: msg }]);
    expect(hasSuggestion(msg)).toBe(false);
  });

  it("splits one fence into prose + a suggestion carrying the exact raw contents", () => {
    const msg = ["Some reasoning first.", "", "```wpsuggest", "Yes — adopt option A.", "```"].join("\n");
    expect(splitSuggestions(msg)).toEqual([
      { kind: "prose", text: "Some reasoning first.\n" },
      { kind: "suggestion", text: "Yes — adopt option A." },
    ]);
    expect(hasSuggestion(msg)).toBe(true);
  });

  it("preserves multi-line fence contents verbatim (including blank lines and markdown)", () => {
    const body = "# Heading\n\n- one\n- two";
    const msg = ["Explanation.", "", "```wpsuggest", body, "```"].join("\n");
    const segs = splitSuggestions(msg);
    expect(segs[1]).toEqual({ kind: "suggestion", text: body });
  });

  it("keeps prose that surrounds a fence on both sides", () => {
    const msg = ["Before.", "```wpsuggest", "The answer.", "```", "After."].join("\n");
    expect(splitSuggestions(msg)).toEqual([
      { kind: "prose", text: "Before." },
      { kind: "suggestion", text: "The answer." },
      { kind: "prose", text: "After." },
    ]);
  });

  it("extracts multiple fences in order", () => {
    const msg = [
      "Option 1:",
      "```wpsuggest",
      "First answer.",
      "```",
      "Option 2:",
      "```wpsuggest",
      "Second answer.",
      "```",
    ].join("\n");
    expect(splitSuggestions(msg)).toEqual([
      { kind: "prose", text: "Option 1:" },
      { kind: "suggestion", text: "First answer." },
      { kind: "prose", text: "Option 2:" },
      { kind: "suggestion", text: "Second answer." },
    ]);
  });

  it("tolerates trailing spaces on the opening fence info string", () => {
    const msg = ["```wpsuggest   ", "Answer.", "```"].join("\n");
    expect(splitSuggestions(msg)).toEqual([{ kind: "suggestion", text: "Answer." }]);
  });

  it("does not treat a non-wpsuggest code block as a suggestion", () => {
    const msg = ["Here is code:", "```ts", "const x = 1;", "```"].join("\n");
    expect(splitSuggestions(msg)).toEqual([{ kind: "prose", text: msg }]);
    expect(hasSuggestion(msg)).toBe(false);
  });

  it("does not misfire on a look-alike info string", () => {
    const msg = ["```wpsuggested", "not a suggestion", "```"].join("\n");
    expect(hasSuggestion(msg)).toBe(false);
  });

  it("leaves an unterminated fence as prose rather than swallowing the rest", () => {
    const msg = ["Intro.", "```wpsuggest", "half a", "suggestion still streaming"].join("\n");
    // No closing fence yet: everything stays prose (renders as a code block until
    // the close arrives) — nothing is extracted as a suggestion.
    expect(hasSuggestion(msg)).toBe(false);
    expect(splitSuggestions(msg)).toEqual([{ kind: "prose", text: msg }]);
  });

  it("matches a longer closing fence for a longer opening fence", () => {
    const msg = ["````wpsuggest", "```", "inner backticks kept", "````"].join("\n");
    // The 4-backtick fence lets the suggestion body contain a 3-backtick line.
    expect(splitSuggestions(msg)).toEqual([
      { kind: "suggestion", text: "```\ninner backticks kept" },
    ]);
  });
});
