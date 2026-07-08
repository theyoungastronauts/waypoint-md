import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { findProjectRoot, globalConfigPath, PROJECT_CONFIG_FILE, waypointHome } from "./paths";
import { CliError } from "./io";

/** Server URL used when nothing else is configured. */
export const DEFAULT_URL = "http://localhost:3000";

/**
 * Project-local config (`.waypoint.json`, committed). Never carries a token —
 * secrets stay out of the repo (§12, §15).
 */
export interface ProjectConfig {
  url?: string;
  project?: string;
  publicUrl?: string;
}

/** Global config (`~/.waypoint/config.json`, machine-wide). May carry the token. */
export interface GlobalConfig {
  url?: string;
  token?: string;
  project?: string;
  publicUrl?: string;
}

/** Overrides passed on the command line. */
export interface ConfigFlags {
  url?: string;
  project?: string;
  token?: string;
}

/** A fully-resolved config the commands act on. */
export interface ResolvedConfig {
  url: string;
  token?: string;
  project?: string;
  /** Absolute base for review URLs in output; falls back to `url`. */
  publicUrl: string;
  /** The project root this config was resolved against (pointer + relative-path anchor). */
  projectRoot: string;
}

/** Keys `waypoint config set` understands. */
export const CONFIG_KEYS = ["url", "token", "project", "publicUrl"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export function isConfigKey(key: string): key is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(key);
}

function readJsonFile<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    throw new CliError(`Config file is not valid JSON: ${file}`);
  }
}

export function loadProjectConfig(projectRoot: string): ProjectConfig {
  return readJsonFile<ProjectConfig>(path.join(projectRoot, PROJECT_CONFIG_FILE)) ?? {};
}

export function loadGlobalConfig(): GlobalConfig {
  return readJsonFile<GlobalConfig>(globalConfigPath()) ?? {};
}

/**
 * Resolve config with precedence flags → env → project file → global file (§12).
 * The token is special: it is read from a flag, `WAYPOINT_TOKEN`, or the global
 * file only — never the project file, so a committed `.waypoint.json` can never
 * leak a secret.
 */
export function resolveConfig(flags: ConfigFlags = {}, cwd: string = process.cwd()): ResolvedConfig {
  const projectRoot = findProjectRoot(cwd);
  const project = loadProjectConfig(projectRoot);
  const global = loadGlobalConfig();

  const url = flags.url ?? process.env.WAYPOINT_URL ?? project.url ?? global.url ?? DEFAULT_URL;
  const token = flags.token ?? envToken() ?? global.token;
  const projectName = flags.project ?? project.project ?? global.project;
  const publicUrl =
    process.env.WAYPOINT_PUBLIC_URL ?? project.publicUrl ?? global.publicUrl ?? url;

  return {
    url: stripTrailingSlash(url),
    token: token || undefined,
    project: projectName || undefined,
    publicUrl: stripTrailingSlash(publicUrl),
    projectRoot,
  };
}

function envToken(): string | undefined {
  const raw = process.env.WAYPOINT_TOKEN;
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/** Persist a patch to the global config file, creating `~/.waypoint` if needed. */
export function saveGlobalConfig(patch: Partial<GlobalConfig>): GlobalConfig {
  mkdirSync(waypointHome(), { recursive: true });
  const merged: GlobalConfig = { ...loadGlobalConfig(), ...patch };
  writeFileSync(globalConfigPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

/**
 * Write the project-local `.waypoint.json`. Strips any `token` key defensively
 * so a secret can never reach the committed file, even if a caller smuggles one
 * past the type (§12).
 */
export function saveProjectConfig(projectRoot: string, config: ProjectConfig): void {
  const safe: ProjectConfig = {};
  if (config.url !== undefined) safe.url = config.url;
  if (config.project !== undefined) safe.project = config.project;
  if (config.publicUrl !== undefined) safe.publicUrl = config.publicUrl;
  const file = path.join(projectRoot, PROJECT_CONFIG_FILE);
  writeFileSync(file, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
}
