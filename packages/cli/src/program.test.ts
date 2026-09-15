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

describe("the command surface", () => {
  const names = () => createProgram("1.2.3").commands.map((c) => c.name());

  it("wires every verb, including the Phase C review commands", () => {
    expect(names()).toEqual(
      expect.arrayContaining([
        "init",
        "push",
        "publish",
        "status",
        "pull",
        "links",
        "resolve",
        "open",
        "skill",
        "config",
      ]),
    );
  });

  it("documents the review flags where a reader will look for them", () => {
    const program = createProgram("1.2.3");
    const flags = (name: string) =>
      program.commands
        .find((c) => c.name() === name)!
        .options.map((o) => o.flags)
        .join(" ");

    expect(flags("status")).toContain("--publications");
    expect(flags("links")).toContain("--add <name>");
    expect(flags("links")).toContain("--revoke <linkId>");
    expect(flags("pull")).toContain("--digest");
  });
});
