import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_URL,
  loadGlobalConfig,
  resolveConfig,
  saveGlobalConfig,
  saveProjectConfig,
} from "./config";
import { globalConfigPath, PROJECT_CONFIG_FILE } from "./paths";
import { tmpDir, withTempHome } from "./testkit";

const ENV_KEYS = ["WAYPOINT_URL", "WAYPOINT_TOKEN", "WAYPOINT_PUBLIC_URL"] as const;

let project: ReturnType<typeof tmpDir>;
let home: ReturnType<typeof withTempHome>;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  project = tmpDir("project");
  home = withTempHome();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  // A `.waypoint.json` marks the project root so findProjectRoot stops here.
  writeFileSync(path.join(project.dir, PROJECT_CONFIG_FILE), "{}\n", "utf8");
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  home.restore();
  project.cleanup();
});

describe("resolveConfig precedence (flags → env → project → global)", () => {
  it("defaults the URL when nothing is configured", () => {
    const config = resolveConfig({}, project.dir);
    expect(config.url).toBe(DEFAULT_URL);
    expect(config.token).toBeUndefined();
    expect(config.publicUrl).toBe(DEFAULT_URL);
    expect(config.projectRoot).toBe(project.dir);
  });

  it("reads url + project from the project file and token from the global file", () => {
    saveProjectConfig(project.dir, { url: "http://project.local:3000", project: "acme" });
    saveGlobalConfig({ token: "glob-token", url: "http://global.local:9999" });
    const config = resolveConfig({}, project.dir);
    // Project file wins over global for url; token comes from global.
    expect(config.url).toBe("http://project.local:3000");
    expect(config.project).toBe("acme");
    expect(config.token).toBe("glob-token");
  });

  it("lets env override the project file, and a flag override env", () => {
    saveProjectConfig(project.dir, { url: "http://project.local:3000" });
    process.env.WAYPOINT_URL = "http://env.local:8080";
    expect(resolveConfig({}, project.dir).url).toBe("http://env.local:8080");
    expect(resolveConfig({ url: "http://flag.local:7000" }, project.dir).url).toBe(
      "http://flag.local:7000",
    );
  });

  it("reads the token from WAYPOINT_TOKEN when set", () => {
    process.env.WAYPOINT_TOKEN = "env-token";
    expect(resolveConfig({}, project.dir).token).toBe("env-token");
  });

  it("NEVER reads a token from the project-local file", () => {
    // Even if someone hand-adds a token to .waypoint.json, it must be ignored.
    writeFileSync(
      path.join(project.dir, PROJECT_CONFIG_FILE),
      JSON.stringify({ url: "http://x", token: "leaked-in-repo" }),
      "utf8",
    );
    expect(resolveConfig({}, project.dir).token).toBeUndefined();
  });

  it("strips trailing slashes from urls", () => {
    saveProjectConfig(project.dir, { url: "http://project.local:3000/" });
    expect(resolveConfig({}, project.dir).url).toBe("http://project.local:3000");
  });
});

describe("config persistence", () => {
  it("saveGlobalConfig merges into ~/.waypoint/config.json", () => {
    saveGlobalConfig({ url: "http://a" });
    saveGlobalConfig({ token: "t" });
    const stored = loadGlobalConfig();
    expect(stored).toMatchObject({ url: "http://a", token: "t" });
    expect(globalConfigPath()).toContain(home.home);
  });

  it("saveProjectConfig writes a token-free .waypoint.json", () => {
    saveProjectConfig(project.dir, { url: "http://a", project: "p" });
    const raw = readFileSync(path.join(project.dir, PROJECT_CONFIG_FILE), "utf8");
    expect(raw).not.toContain("token");
  });
});
