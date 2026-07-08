import { describe, expect, it } from "vitest";
import {
  buildStructureUserPrompt,
  canOfferStructure,
  MAX_PROPOSALS,
  parseModelJson,
  STRUCTURE_SOURCE_CAP,
  validateProposals,
  type ProposalInput,
} from "../structure";

const SOURCE = [
  "# Migration plan",
  "",
  "We will move the primary database to the upgraded instance class this weekend.",
  "The rollback window is two hours. Notify the on-call engineer before starting.",
].join("\n");

describe("validateProposals — the trust boundary", () => {
  it("accepts a text proposal whose anchor appears verbatim in the source", () => {
    const proposals: ProposalInput[] = [
      { type: "text", prompt: "What is the rollback window?", anchor: "The rollback window is two hours." },
    ];
    const { accepted, skipped } = validateProposals(SOURCE, proposals);
    expect(skipped).toHaveLength(0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      type: "text",
      promptMd: "What is the rollback window?",
      anchorExact: "The rollback window is two hours.",
      start: SOURCE.indexOf("The rollback window is two hours."),
    });
  });

  it("accepts a choice proposal with two or more options", () => {
    const proposals: ProposalInput[] = [
      {
        type: "choice",
        prompt: "When do we migrate?",
        anchor: "upgraded instance class this weekend",
        select: "single",
        options: ["This weekend", "Next weekend"],
      },
    ];
    const { accepted } = validateProposals(SOURCE, proposals);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      type: "choice",
      select: "single",
      options: ["This weekend", "Next weekend"],
    });
  });

  it("rejects a fabricated anchor that is not in the source (not stored)", () => {
    const proposals: ProposalInput[] = [
      { type: "text", prompt: "Made up?", anchor: "This sentence does not exist in the document." },
    ];
    const { accepted, skipped } = validateProposals(SOURCE, proposals);
    expect(accepted).toHaveLength(0);
    expect(skipped).toEqual([
      { prompt: "Made up?", reason: "anchor quote was not found verbatim in the source" },
    ]);
  });

  it("rejects a choice proposal with fewer than two distinct options", () => {
    const proposals: ProposalInput[] = [
      {
        type: "choice",
        prompt: "Only one?",
        anchor: "The rollback window is two hours.",
        select: "single",
        options: ["Only option", "Only option", "  "],
      },
    ];
    const { accepted, skipped } = validateProposals(SOURCE, proposals);
    expect(accepted).toHaveLength(0);
    expect(skipped[0].reason).toBe("choice proposal had fewer than two options");
  });

  it("collapses duplicate (prompt + anchor) proposals", () => {
    const p: ProposalInput = { type: "text", prompt: "Dup?", anchor: "The rollback window is two hours." };
    const { accepted, skipped } = validateProposals(SOURCE, [p, { ...p }]);
    expect(accepted).toHaveLength(1);
    expect(skipped[0].reason).toBe("duplicate proposal");
  });

  it("caps the number of accepted proposals", () => {
    const many: ProposalInput[] = Array.from({ length: MAX_PROPOSALS + 5 }, (_, i) => ({
      type: "text",
      prompt: `Q${i}`,
      anchor: "Notify the on-call engineer before starting.",
    }));
    const { accepted, skipped } = validateProposals(SOURCE, many);
    // Each has a distinct prompt, so dedupe does not apply; the cap does.
    expect(accepted).toHaveLength(MAX_PROPOSALS);
    expect(skipped.every((s) => s.reason === "proposal limit reached")).toBe(true);
  });
});

describe("parseModelJson", () => {
  it("parses a bare JSON object", () => {
    expect(parseModelJson('{"items":[]}')).toEqual({ items: [] });
  });

  it("parses a ```json fenced block", () => {
    const text = "Here you go:\n```json\n{\"items\":[{\"type\":\"text\"}]}\n```";
    expect(parseModelJson(text)).toEqual({ items: [{ type: "text" }] });
  });

  it("parses an object embedded in surrounding prose", () => {
    expect(parseModelJson('sure — {"items":[]} — done')).toEqual({ items: [] });
  });

  it("throws when there is no parseable JSON", () => {
    expect(() => parseModelJson("no json here")).toThrow();
  });
});

describe("buildStructureUserPrompt", () => {
  it("includes the source verbatim under the cap", () => {
    expect(buildStructureUserPrompt(SOURCE)).toContain(SOURCE);
  });

  it("truncates an oversized source and marks it", () => {
    const big = "x".repeat(STRUCTURE_SOURCE_CAP + 100);
    const prompt = buildStructureUserPrompt(big);
    expect(prompt).toContain("[document truncated for length]");
    expect(prompt).not.toContain("x".repeat(STRUCTURE_SOURCE_CAP + 1));
  });
});

describe("canOfferStructure — server-driven gating", () => {
  it("offers only with AI on, no convention items, and nothing structured yet", () => {
    expect(canOfferStructure({ aiEnabled: true, hasConventionItems: false, hasSyntheticItems: false })).toBe(true);
  });

  it("hides the affordance when AI is off (no key)", () => {
    expect(canOfferStructure({ aiEnabled: false, hasConventionItems: false, hasSyntheticItems: false })).toBe(false);
  });

  it("hides the affordance on a conventioned document", () => {
    expect(canOfferStructure({ aiEnabled: true, hasConventionItems: true, hasSyntheticItems: false })).toBe(false);
  });

  it("hides the affordance once the document is already structured", () => {
    expect(canOfferStructure({ aiEnabled: true, hasConventionItems: false, hasSyntheticItems: true })).toBe(false);
  });
});
