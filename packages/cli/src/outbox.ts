import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { outboxDir } from "./paths";
import type { PushPayload } from "./client";

/**
 * The offline outbox (§12): when the server is unreachable, a push is queued
 * here instead of failing, and `waypoint push --flush` retries later. The agent
 * flow never hard-fails just because the app is down.
 */
export interface OutboxEntry {
  /** Absolute path of the queued file (its id). */
  file: string;
  queuedAt: string;
  /** Project root the push came from, so a flush can write the pointer back. */
  projectRoot: string;
  /** The exact body that failed to POST. */
  payload: PushPayload;
}

interface StoredEntry {
  queuedAt: string;
  projectRoot: string;
  payload: PushPayload;
}

/** Queue a payload for later delivery. Returns the created file path. */
export function enqueue(payload: PushPayload, projectRoot: string): string {
  const dir = outboxDir();
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  const file = path.join(dir, `${stamp}-${rand}.json`);
  const stored: StoredEntry = { queuedAt: new Date().toISOString(), projectRoot, payload };
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return file;
}

/** All queued entries, oldest first (filename timestamps sort lexically). */
export function listOutbox(): OutboxEntry[] {
  const dir = outboxDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      const stored = JSON.parse(readFileSync(file, "utf8")) as StoredEntry;
      return { file, ...stored };
    });
}

/** Remove a delivered entry. */
export function removeEntry(file: string): void {
  rmSync(file, { force: true });
}

/** Count of queued entries (cheap check for status/messages). */
export function outboxCount(): number {
  return listOutbox().length;
}
