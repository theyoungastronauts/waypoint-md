import { describe, expect, it } from "vitest";
import { capCommentAnchor, fnv1aHex, EXACT_CAP, PREFIX_SUFFIX_CAP } from "./anchor.js";

describe("fnv1aHex", () => {
  it("is deterministic and 8 lowercase hex chars", () => {
    const h = fnv1aHex("the quick brown fox");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1aHex("the quick brown fox")).toBe(h);
  });

  it("differs for different inputs", () => {
    expect(fnv1aHex("alpha")).not.toBe(fnv1aHex("beta"));
  });
});

describe("capCommentAnchor (§5.4 caps)", () => {
  it("leaves a short anchor untouched and invents no hash", () => {
    const anchor = capCommentAnchor({ exact: "hello", prefix: "say ", suffix: " world" });
    expect(anchor).toEqual({ exact: "hello", prefix: "say ", suffix: " world" });
  });

  it("truncates exact over the cap and attaches a hash of the full selection", () => {
    const full = "A".repeat(EXACT_CAP + 50);
    const anchor = capCommentAnchor({ exact: full });
    expect(anchor.exact.length).toBe(EXACT_CAP);
    expect(anchor.exactHash).toBe(fnv1aHex(full));
  });

  it("keeps the context nearest the selection when trimming prefix/suffix", () => {
    const prefix = "0123456789".repeat(5); // 50 chars
    const suffix = "abcdefghij".repeat(5); // 50 chars
    const anchor = capCommentAnchor({ exact: "x", prefix, suffix });
    expect(anchor.prefix).toBe(prefix.slice(-PREFIX_SUFFIX_CAP)); // tail of prefix
    expect(anchor.suffix).toBe(suffix.slice(0, PREFIX_SUFFIX_CAP)); // head of suffix
    expect(anchor.prefix?.length).toBe(PREFIX_SUFFIX_CAP);
    expect(anchor.suffix?.length).toBe(PREFIX_SUFFIX_CAP);
  });

  it("is idempotent — capping an already-capped anchor is stable", () => {
    const full = "B".repeat(EXACT_CAP + 10);
    const once = capCommentAnchor({ exact: full, prefix: "p".repeat(40) });
    const twice = capCommentAnchor(once);
    expect(twice).toEqual(once);
  });

  it("preserves a caller-supplied hash even when exact is already short", () => {
    const anchor = capCommentAnchor({ exact: "short", exactHash: "deadbeef" });
    expect(anchor.exactHash).toBe("deadbeef");
  });
});
