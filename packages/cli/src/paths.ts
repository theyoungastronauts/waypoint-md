import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Filesystem locations the CLI uses. Two homes:
 *   - the user home `~/.waypoint/` holds the global config (may carry the token)
 *     and the offline outbox — machine-wide, never committed;
 *   - the project root holds `.waypoint.json` (token-free) and the `.waypoint/`
 *     pointer dir — per repo.
 *
 * `~` resolves via `os.homedir()`, which honors `$HOME`, so tests can redirect
 * the global home to a scratch dir.
 */

/** The per-user Waypoint home (`~/.waypoint`). */
export function waypointHome(): string {
  return path.join(os.homedir(), ".waypoint");
}

/** Global config file (`~/.waypoint/config.json`) — the only file that may hold a token. */
export function globalConfigPath(): string {
  return path.join(waypointHome(), "config.json");
}

/** Offline outbox directory (`~/.waypoint/outbox`). */
export function outboxDir(): string {
  return path.join(waypointHome(), "outbox");
}

/** Project-local config filename (token-free). */
export const PROJECT_CONFIG_FILE = ".waypoint.json";

/** Pointer directory and file, relative to the project root. */
export const POINTER_DIR = ".waypoint";
export const POINTER_FILE = "pending.json";

/**
 * Walk up from `startDir` to the nearest ancestor containing a `.waypoint.json`
 * (or a `.git`, as a repo boundary fallback). This is the project root: where
 * config, the pointer dir, and relative source paths are anchored. Falls back to
 * `startDir` when nothing is found so a bare `waypoint push` still works.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, PROJECT_CONFIG_FILE))) return dir;
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}
