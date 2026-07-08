import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  NetworkError,
  pushDocument,
  type PushPayload,
  type PushResult,
} from "../client";
import type { ResolvedConfig } from "../config";
import { handshake } from "../handshake";
import { CliError, type IO } from "../io";
import { enqueue, listOutbox, removeEntry } from "../outbox";
import { writePointer } from "../pointer";

export interface CommandDeps {
  config: ResolvedConfig;
  io: IO;
}

export interface PushOptions {
  title?: string;
  flush?: boolean;
}

/** Forward-slash a relative path so source keys are stable across platforms. */
function normalizeRel(rel: string): string {
  return rel.split(path.sep).join("/");
}

function announce(io: IO, config: ResolvedConfig, result: PushResult, sourcePath: string): void {
  const reviewUrl = `${config.publicUrl}${result.url}`;
  writePointer(config.projectRoot, {
    id: result.id,
    source: sourcePath,
    pushedAt: new Date().toISOString(),
    url: reviewUrl,
  });
  io.log(`Pushed ${sourcePath}`);
  io.log(`  review: ${reviewUrl}`);
  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    io.warn(`  parsed with ${result.warnings.length} warning(s) — open the review to see them.`);
  }
}

/**
 * `waypoint push <file>` (§12). Reads the file, records the relative source path
 * plus host metadata (for round-trip + supersede), POSTs it, prints the review
 * URL, and drops a `.waypoint/pending.json` pointer. When the server is
 * unreachable the payload is queued in the outbox and the command still succeeds
 * — a push never hard-fails because the app is down.
 */
export async function runPush(
  file: string | undefined,
  options: PushOptions,
  deps: CommandDeps,
): Promise<void> {
  const { config, io } = deps;

  if (options.flush) {
    await flushOutbox(deps);
  }

  if (!file) {
    if (options.flush) return; // `push --flush` with no file is a valid flush-only run.
    throw new CliError("Nothing to push. Provide a <file>, or use --flush to retry the outbox.");
  }

  const abs = path.resolve(process.cwd(), file);
  if (!existsSync(abs)) throw new CliError(`File not found: ${file}`);
  const markdown = readFileSync(abs, "utf8");

  const rel = path.relative(config.projectRoot, abs);
  const sourcePath = normalizeRel(rel && !rel.startsWith("..") ? rel : path.basename(abs));

  const payload: PushPayload = {
    markdown,
    source: { path: sourcePath, host: os.hostname() },
  };
  if (config.project) payload.project = config.project;
  const title = options.title?.trim();
  if (title) payload.title = title;

  await handshake(config, io);

  try {
    const result = await pushDocument(config, payload);
    announce(io, config, result, sourcePath);
  } catch (err) {
    if (err instanceof NetworkError) {
      const queued = enqueue(payload, config.projectRoot);
      io.warn(
        `Server unreachable — this push was queued offline and will not be lost.\n` +
          `  queued: ${queued}\n` +
          `  retry later with: waypoint push --flush`,
      );
      return;
    }
    throw err;
  }
}

/** Retry every queued push against the current server (§12). */
export async function flushOutbox(deps: CommandDeps): Promise<void> {
  const { config, io } = deps;
  const entries = listOutbox();
  if (entries.length === 0) {
    io.log("Outbox is empty — nothing to flush.");
    return;
  }
  io.log(`Flushing ${entries.length} queued push(es)…`);
  for (const entry of entries) {
    try {
      const result = await pushDocument(config, entry.payload);
      writePointer(entry.projectRoot, {
        id: result.id,
        source: entry.payload.source.path,
        pushedAt: new Date().toISOString(),
        url: `${config.publicUrl}${result.url}`,
      });
      removeEntry(entry.file);
      io.log(`  delivered ${entry.payload.source.path} → ${config.publicUrl}${result.url}`);
    } catch (err) {
      if (err instanceof NetworkError) {
        io.warn("  server still unreachable — leaving remaining pushes queued.");
        return;
      }
      throw err;
    }
  }
}
