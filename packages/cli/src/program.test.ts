import { describe, expect, it } from "vitest";
import { createProgram } from "./program";

describe("waypoint CLI", () => {
  it("names the binary `waypoint`", () => {
    expect(createProgram("1.2.3").name()).toBe("waypoint");
  });

  it("reports the version it was built with", () => {
    expect(createProgram("1.2.3").version()).toBe("1.2.3");
  });
});
