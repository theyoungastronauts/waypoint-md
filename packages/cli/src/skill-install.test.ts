import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runSkillInstall } from "./commands/skill";
import { PROJECT_CONFIG_FILE } from "./paths";
import { capturingIo, tmpDir, withTempHome, type CapturedIo } from "./testkit";

let home: ReturnType<typeof withTempHome>;
let project: ReturnType<typeof tmpDir>;
let io: CapturedIo;

beforeEach(() => {
  home = withTempHome();
  project = tmpDir("proj");
  io = capturingIo();
});

afterEach(() => {
  home.restore();
  project.cleanup();
});

describe("waypoint skill install", () => {
  it("installs project-local by default and writes no project config", () => {
    runSkillInstall({}, io.io, project.dir);

    const dest = path.join(project.dir, ".claude", "skills", "waypoint");
    expect(existsSync(path.join(dest, "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(dest, "references", "authoring.md"))).toBe(true);
    // Standalone: unlike init, it must not initialize the project.
    expect(existsSync(path.join(project.dir, PROJECT_CONFIG_FILE))).toBe(false);
    expect(existsSync(path.join(project.dir, ".gitignore"))).toBe(false);
    expect(io.text()).toContain("/waypoint");
  });

  it("installs into ~/.claude/skills with --global, untouched by cwd", () => {
    runSkillInstall({ global: true }, io.io, project.dir);

    const dest = path.join(os.homedir(), ".claude", "skills", "waypoint");
    expect(existsSync(path.join(dest, "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(dest, "references", "examples.md"))).toBe(true);
    // Nothing lands in the project when installing globally.
    expect(existsSync(path.join(project.dir, ".claude"))).toBe(false);
    expect(io.text()).toContain("globally");
  });

  it("re-running overwrites in place (upgrade path)", () => {
    runSkillInstall({}, io.io, project.dir);
    runSkillInstall({}, io.io, project.dir);
    expect(existsSync(path.join(project.dir, ".claude", "skills", "waypoint", "SKILL.md"))).toBe(true);
  });
});
