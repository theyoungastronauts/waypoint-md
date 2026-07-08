import { describe, expect, it } from "vitest";

import { resolveNextPath } from "../next-path";

const ORIGIN = "http://localhost:3000";

describe("resolveNextPath", () => {
  it("honors same-origin relative paths", () => {
    expect(resolveNextPath("/d/abc123", ORIGIN)).toBe("/d/abc123");
    expect(resolveNextPath("/d/abc?tab=agent#q1", ORIGIN)).toBe("/d/abc?tab=agent#q1");
  });

  it("falls back to / when absent or unparseable", () => {
    expect(resolveNextPath(null, ORIGIN)).toBe("/");
    expect(resolveNextPath("", ORIGIN)).toBe("/");
  });

  it("rejects protocol-relative and absolute cross-origin URLs", () => {
    expect(resolveNextPath("//evil.com/phish", ORIGIN)).toBe("/");
    expect(resolveNextPath("https://evil.com/phish", ORIGIN)).toBe("/");
  });

  it("rejects backslash-based bypasses (WARN-1 regression)", () => {
    // Browsers normalize \ to / in special-scheme URLs, so these resolve
    // cross-origin and must be rejected.
    expect(resolveNextPath("/\\evil.com", ORIGIN)).toBe("/");
    expect(resolveNextPath("/\\/evil.com", ORIGIN)).toBe("/");
    expect(resolveNextPath("\\/\\evil.com", ORIGIN)).toBe("/");
  });

  it("neutralizes javascript: and data: schemes", () => {
    expect(resolveNextPath("javascript:alert(1)", ORIGIN)).toBe("/");
    expect(resolveNextPath("data:text/html,x", ORIGIN)).toBe("/");
  });
});
