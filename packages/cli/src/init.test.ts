import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runInit } from "./commands/init";
import { runConfigGet, runConfigSet } from "./commands/config";
import { loadGlobalConfig } from "./config";
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

describe("waypoint init", () => {
  it("writes a token-free .waypoint.json and ignores the pointer dir", () => {
    runInit({ url: "http://box:3000", project: "acme" }, io.io, project.dir);

    const configPath = path.join(project.dir, PROJECT_CONFIG_FILE);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config).toMatchObject({ url: "http://box:3000", project: "acme" });
    expect(config.token).toBeUndefined();

    const gitignore = readFileSync(path.join(project.dir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".waypoint/");
  });

  it("installs the Claude Code skill project-local by default", () => {
    runInit({}, io.io, project.dir);
    const skillFile = path.join(project.dir, ".claude", "skills", "waypoint", "SKILL.md");
    expect(existsSync(skillFile)).toBe(true);
    // References ship alongside SKILL.md.
    expect(existsSync(path.join(project.dir, ".claude", "skills", "waypoint", "references", "authoring.md"))).toBe(true);
    expect(io.text().toLowerCase()).toContain("skill");
  });

  it("installs the skill globally with --global", () => {
    runInit({ global: true }, io.io, project.dir);
    // withTempHome redirects ~ to a scratch dir.
    const globalSkill = path.join(home.home, ".claude", "skills", "waypoint", "SKILL.md");
    expect(existsSync(globalSkill)).toBe(true);
    // ...and not project-local.
    expect(existsSync(path.join(project.dir, ".claude", "skills", "waypoint", "SKILL.md"))).toBe(false);
  });

  it("skips the skill install with noSkill", () => {
    runInit({ noSkill: true }, io.io, project.dir);
    expect(existsSync(path.join(project.dir, ".claude", "skills", "waypoint"))).toBe(false);
  });

  it("is idempotent about the .gitignore entry", () => {
    writeFileSync(path.join(project.dir, ".gitignore"), "node_modules/\n.waypoint/\n", "utf8");
    runInit({}, io.io, project.dir);
    const gitignore = readFileSync(path.join(project.dir, ".gitignore"), "utf8");
    expect(gitignore.match(/\.waypoint\//g)?.length).toBe(1);
  });

  it("refuses to overwrite an existing config without --force", () => {
    writeFileSync(path.join(project.dir, PROJECT_CONFIG_FILE), "{}\n", "utf8");
    expect(() => runInit({}, io.io, project.dir)).toThrow(/already exists/i);
    expect(() => runInit({ force: true, url: "http://x" }, io.io, project.dir)).not.toThrow();
  });

  it("skips the .gitignore update with noGitignore", () => {
    runInit({ noGitignore: true }, io.io, project.dir);
    expect(existsSync(path.join(project.dir, ".gitignore"))).toBe(false);
  });
});

describe("waypoint config get/set", () => {
  it("writes the token to the global file and never prints it", () => {
    runConfigSet("token", "sup3r-secret", io.io);
    expect(loadGlobalConfig().token).toBe("sup3r-secret");
    expect(io.text()).not.toContain("sup3r-secret");
  });

  it("reports the token as (set) without revealing it", () => {
    runConfigSet("token", "sup3r-secret", io.io);
    const reader = capturingIo();
    runConfigGet("token", reader.io);
    expect(reader.text()).toBe("(set)");
  });

  it("rejects an unknown key", () => {
    expect(() => runConfigSet("bogus", "x", io.io)).toThrow(/unknown config key/i);
  });
});
