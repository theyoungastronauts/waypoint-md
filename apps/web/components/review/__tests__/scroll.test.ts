import { describe, expect, it } from "vitest";

import { PIN_THRESHOLD_PX, isPinnedToBottom } from "@/components/review/scroll";

describe("isPinnedToBottom — chat autoscroll pin (§14, #1)", () => {
  it("is pinned when scrolled exactly to the bottom", () => {
    expect(isPinnedToBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 })).toBe(true);
  });

  it("stays pinned within the threshold of the bottom", () => {
    // 49px from the bottom — still following the stream.
    expect(isPinnedToBottom({ scrollHeight: 1000, scrollTop: 751, clientHeight: 200 })).toBe(true);
  });

  it("frees the reader once scrolled up past the threshold", () => {
    // 200px from the bottom — the reader is re-reading; do not yank them down.
    expect(isPinnedToBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 200 })).toBe(false);
  });

  it("reads a gap exactly at the threshold as not-pinned (strict <)", () => {
    const clientHeight = 200;
    const scrollHeight = 1000;
    // Scrolled so the gap equals the threshold exactly.
    const scrollTop = scrollHeight - clientHeight - PIN_THRESHOLD_PX;
    expect(isPinnedToBottom({ scrollHeight, scrollTop, clientHeight })).toBe(false);
  });

  it("stays pinned through sub-pixel scrollTop rounding at the true bottom", () => {
    // A browser can report a fractional scrollTop, leaving a tiny positive gap
    // even when visually bottomed out; the generous threshold absorbs it.
    const gap = 0.5;
    expect(
      isPinnedToBottom({ scrollHeight: 1000, scrollTop: 800 - gap, clientHeight: 200 }),
    ).toBe(true);
  });
});
