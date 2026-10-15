import { describe, expect, it } from "vitest";
import type { VoiceBrief } from "@/lib/voice/brief";
import { buildInstructions, buildSessionConfig } from "@/lib/voice/realtime";
import { VOICE_TOOLS } from "@/lib/voice/tools-spec";

const brief: VoiceBrief = {
  version: 1,
  title: "Launch plan",
  intro: "Deciding the launch date.",
  questions: [
    {
      itemId: "i1",
      number: 1,
      type: "choice",
      select: "single",
      spoken: "When do we launch?",
      prompt: "When do we launch?",
      options: [
        { label: "Monday", spoken: "Monday" },
        { label: "Friday", spoken: "Friday" },
      ],
      suggested: ["Monday"],
      notes: ["Monday avoids the weekend on-call."],
    },
  ],
  background: [],
};

describe("buildInstructions", () => {
  const text = buildInstructions(brief);

  it("names the document, the question count and the opening style question", () => {
    expect(text).toContain('"Launch plan"');
    expect(text).toContain("It has 1 question.");
    expect(text).toContain("brief or thorough");
  });

  it("keeps per-question content out (it comes through tools, so the prompt stays cacheable)", () => {
    expect(text).not.toContain("When do we launch?");
    expect(text).not.toContain("weekend on-call");
  });

  it("tells the model not to narrate tool calls, and keeps notes in the reviewer's words", () => {
    expect(text).toMatch(/Never announce what you are about to do/);
    expect(text).toMatch(/never describe or summarize them/);
  });

  it("offers the read-back instead of always giving it, and never submits without the reviewer's say-so", () => {
    expect(text).toMatch(/ask whether they'd like a quick read-back/);
    expect(text).toMatch(/readback_declined true/);
    expect(text).toMatch(/Never submit without the reviewer's say-so/);
  });
});

describe("buildSessionConfig", () => {
  it("bakes in every tool", () => {
    const config = buildSessionConfig(brief);
    expect(config.tools).toBe(VOICE_TOOLS);
    expect(new Set(config.tools.map((t) => t.name)).size).toBe(config.tools.length);
  });
});
