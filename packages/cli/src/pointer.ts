import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { POINTER_DIR, POINTER_FILE } from "./paths";

/**
 * The `.waypoint/pending.json` pointer (§12): a per-project breadcrumb to the
 * document most recently pushed, so `waypoint pull` (and the skill's session-start
 * loop) know what to fetch without an id. Cleared on pull.
 */
export interface Pointer {
  /** Server document id. */
  id: string;
  /** Relative source path that was pushed (for placing the pulled review file). */
  source: string;
  /** ISO timestamp of the push. */
  pushedAt: string;
  /** Absolute review URL, for convenience. */
  url?: string;
}

function pointerPath(projectRoot: string): string {
  return path.join(projectRoot, POINTER_DIR, POINTER_FILE);
}

export function writePointer(projectRoot: string, pointer: Pointer): void {
  mkdirSync(path.join(projectRoot, POINTER_DIR), { recursive: true });
  writeFileSync(pointerPath(projectRoot), `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
}

export function readPointer(projectRoot: string): Pointer | null {
  const file = pointerPath(projectRoot);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Pointer;
  } catch {
    return null;
  }
}

export function clearPointer(projectRoot: string): void {
  rmSync(pointerPath(projectRoot), { force: true });
}
