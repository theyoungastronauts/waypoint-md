import { describe, expect, it } from "vitest";

import { anchorFor, formatTimecode, isValidTimecodeMs, MAX_TIMECODE_MS } from "../timecode";

/**
 * `mm:ss.d` is a parsing contract (SPEC §9.4), not a display nicety — an agent
 * reads these strings back off the digest — so the edges are pinned here.
 */
describe("formatTimecode", () => {
  it("renders zero-padded minutes, seconds, and one tenth", () => {
    expect(formatTimecode(0)).toBe("00:00.0");
    expect(formatTimecode(12_400)).toBe("00:12.4");
    expect(formatTimecode(65_000)).toBe("01:05.0");
    expect(formatTimecode(599_900)).toBe("09:59.9");
  });

  it("truncates to the tenth the reviewer was looking at, never rounds up", () => {
    expect(formatTimecode(12_499)).toBe("00:12.4");
    expect(formatTimecode(12_999)).toBe("00:12.9");
  });

  it("keeps counting in minutes past an hour rather than adding a field", () => {
    expect(formatTimecode(3_600_000)).toBe("60:00.0");
    expect(formatTimecode(4_204_200)).toBe("70:04.2");
  });

  it("clamps nonsense to the start rather than emitting an unparseable string", () => {
    expect(formatTimecode(-1)).toBe("00:00.0");
    expect(formatTimecode(Number.NaN)).toBe("00:00.0");
  });
});

describe("anchorFor", () => {
  it("names a general note explicitly", () => {
    expect(anchorFor(null)).toBe("general");
    expect(anchorFor(12_400)).toBe("00:12.4");
  });
});

describe("isValidTimecodeMs", () => {
  it("accepts whole milliseconds inside the 24-hour bound", () => {
    expect(isValidTimecodeMs(0)).toBe(true);
    expect(isValidTimecodeMs(MAX_TIMECODE_MS)).toBe(true);
  });

  it("rejects fractions, negatives, overruns, and non-numbers", () => {
    expect(isValidTimecodeMs(1.5)).toBe(false);
    expect(isValidTimecodeMs(-1)).toBe(false);
    expect(isValidTimecodeMs(MAX_TIMECODE_MS + 1)).toBe(false);
    expect(isValidTimecodeMs("12400")).toBe(false);
    expect(isValidTimecodeMs(Number.NaN)).toBe(false);
  });
});
