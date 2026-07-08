import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pathDoorEnabled, PathDoorError, readPathDoor } from "../path-door";

let base: string;
let allowedRoot: string;
let outside: string;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "waypoint-path-door-"));
  allowedRoot = path.join(base, "allowed");
  outside = path.join(base, "outside");
  mkdirSync(allowedRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(allowedRoot, "plan.md"), "# Plan\r\n\r\nBody.\r\n");
  writeFileSync(path.join(allowedRoot, "notes.bin"), "binary-ish");
  writeFileSync(path.join(outside, "secret.md"), "# Secret");
  // A symlink that lives inside the root but resolves to a file outside it.
  symlinkSync(path.join(outside, "secret.md"), path.join(allowedRoot, "escape.md"));
});

const originalRoots = process.env.WAYPOINT_ALLOWED_ROOTS;
afterEach(() => {
  if (originalRoots === undefined) delete process.env.WAYPOINT_ALLOWED_ROOTS;
  else process.env.WAYPOINT_ALLOWED_ROOTS = originalRoots;
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("path door", () => {
  it("is disabled when WAYPOINT_ALLOWED_ROOTS is unset", () => {
    delete process.env.WAYPOINT_ALLOWED_ROOTS;
    expect(pathDoorEnabled()).toBe(false);
    expect(() => readPathDoor(path.join(allowedRoot, "plan.md"))).toThrow(PathDoorError);
    try {
      readPathDoor(path.join(allowedRoot, "plan.md"));
    } catch (err) {
      expect((err as PathDoorError).code).toBe("path_door_disabled");
    }
  });

  it("reads a file inside an allowed root, preserving bytes", () => {
    process.env.WAYPOINT_ALLOWED_ROOTS = allowedRoot;
    const { raw } = readPathDoor(path.join(allowedRoot, "plan.md"));
    expect(raw).toBe("# Plan\r\n\r\nBody.\r\n");
  });

  it("rejects a path outside every allowed root", () => {
    process.env.WAYPOINT_ALLOWED_ROOTS = allowedRoot;
    try {
      readPathDoor(path.join(outside, "secret.md"));
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as PathDoorError).code).toBe("path_not_allowed");
    }
  });

  it("rejects a .. traversal that escapes the root", () => {
    process.env.WAYPOINT_ALLOWED_ROOTS = allowedRoot;
    try {
      readPathDoor(path.join(allowedRoot, "..", "outside", "secret.md"));
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as PathDoorError).code).toBe("path_not_allowed");
    }
  });

  it("rejects a symlink inside the root that points outside it", () => {
    process.env.WAYPOINT_ALLOWED_ROOTS = allowedRoot;
    try {
      readPathDoor(path.join(allowedRoot, "escape.md"));
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as PathDoorError).code).toBe("path_not_allowed");
    }
  });

  it("rejects unsupported file types", () => {
    process.env.WAYPOINT_ALLOWED_ROOTS = allowedRoot;
    try {
      readPathDoor(path.join(allowedRoot, "notes.bin"));
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as PathDoorError).code).toBe("unsupported_file_type");
    }
  });

  it("returns file_not_found for a missing file", () => {
    process.env.WAYPOINT_ALLOWED_ROOTS = allowedRoot;
    try {
      readPathDoor(path.join(allowedRoot, "nope.md"));
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as PathDoorError).code).toBe("file_not_found");
    }
  });
});
