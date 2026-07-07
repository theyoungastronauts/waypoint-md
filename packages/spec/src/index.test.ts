import { describe, expect, it } from "vitest";
import { SPEC_MARKER, SPEC_VERSION } from "./index.js";

describe("@waypoint/spec scaffold", () => {
  it("declares the spec version (the /api/health handshake target)", () => {
    expect(SPEC_VERSION).toBe("1.0.0");
  });

  it("declares the frontmatter opt-in marker", () => {
    expect(SPEC_MARKER).toBe(1);
  });
});
