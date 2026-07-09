import { describe, expect, it } from "vitest";

import { normalizeToHome } from "@/lib/attach-path";

const HOME = "/Users/tyler";

describe("normalizeToHome (decision B-5)", () => {
  it("rewrites a path under home to a ~/ form", () => {
    expect(normalizeToHome("/Users/tyler/prj/foo.ts", HOME)).toBe("~/prj/foo.ts");
  });

  it("leaves a path outside home absolute", () => {
    expect(normalizeToHome("/etc/hosts", HOME)).toBe("/etc/hosts");
  });

  it("tolerates a trailing slash on the reported home dir (no doubled slash)", () => {
    expect(normalizeToHome("/Users/tyler/prj/foo.ts", "/Users/tyler/")).toBe("~/prj/foo.ts");
  });

  it("anchors the match to the start — home appearing mid-path is not rewritten", () => {
    expect(normalizeToHome("/var/Users/tyler/x", HOME)).toBe("/var/Users/tyler/x");
  });

  it("only matches a full path segment — a longer sibling dir is not rewritten", () => {
    // `/Users/tyler-backup` starts with `/Users/tyler` as a *substring* but is a
    // different directory; it must stay absolute.
    expect(normalizeToHome("/Users/tyler-backup/file", HOME)).toBe("/Users/tyler-backup/file");
  });

  it("collapses a path equal to home to a bare ~", () => {
    expect(normalizeToHome("/Users/tyler", HOME)).toBe("~");
  });

  it("trims surrounding whitespace before normalizing", () => {
    expect(normalizeToHome("  /Users/tyler/x  ", HOME)).toBe("~/x");
  });

  it("returns the path unchanged (trimmed) when home is unknown", () => {
    expect(normalizeToHome("  /Users/tyler/x  ", null)).toBe("/Users/tyler/x");
    expect(normalizeToHome("/Users/tyler/x", undefined)).toBe("/Users/tyler/x");
  });

  it("leaves an already ~/ path untouched", () => {
    expect(normalizeToHome("~/prj/foo.ts", HOME)).toBe("~/prj/foo.ts");
  });

  it("does not collapse other structure inside the path", () => {
    expect(normalizeToHome("/Users/tyler/a//b/../c", HOME)).toBe("~/a//b/../c");
  });
});
