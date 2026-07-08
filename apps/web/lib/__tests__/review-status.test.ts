import { describe, expect, it } from "vitest";
import {
  computeProgress,
  effectiveStatus,
  responseHasContent,
  statusAfterContentChange,
} from "@/lib/review-status";

describe("responseHasContent", () => {
  it("is false for empty / whitespace-only responses", () => {
    expect(responseHasContent(null)).toBe(false);
    expect(responseHasContent({})).toBe(false);
    expect(responseHasContent({ text: "   " })).toBe(false);
    expect(responseHasContent({ selected: [] })).toBe(false);
  });

  it("is true for any real text, selection, or elaboration", () => {
    expect(responseHasContent({ text: "hi" })).toBe(true);
    expect(responseHasContent({ selected: ["a"] })).toBe(true);
    expect(responseHasContent({ other: "note" })).toBe(true);
  });
});

describe("effectiveStatus", () => {
  it("treats an explicit flag/skip as sticky over content", () => {
    expect(effectiveStatus({ text: "answered text", status: "flagged" })).toBe("flagged");
    expect(effectiveStatus({ selected: ["x"], status: "skipped" })).toBe("skipped");
  });

  it("reads content as answered and emptiness as untouched", () => {
    expect(effectiveStatus({ text: "yes" })).toBe("answered");
    expect(effectiveStatus({ status: "answered" })).toBe("answered");
    expect(effectiveStatus(null)).toBe("untouched");
    expect(effectiveStatus({})).toBe("untouched");
  });
});

describe("statusAfterContentChange", () => {
  it("keeps a sticky flag/skip regardless of content", () => {
    expect(statusAfterContentChange("flagged", true)).toBe("flagged");
    expect(statusAfterContentChange("skipped", false)).toBe("skipped");
  });

  it("otherwise toggles answered/untouched with content presence", () => {
    expect(statusAfterContentChange(null, true)).toBe("answered");
    expect(statusAfterContentChange("answered", false)).toBe(null);
  });
});

describe("computeProgress", () => {
  it("tallies each status", () => {
    const p = computeProgress(["answered", "answered", "flagged", "skipped", "untouched"]);
    expect(p).toEqual({ answered: 2, flagged: 1, skipped: 1, untouched: 1, total: 5 });
  });
});
