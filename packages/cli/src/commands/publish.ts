import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { backfillPublications, publishDocument, type PublishPayload, type PublishResult } from "../client";
import { CliError, type IO } from "../io";
import type { CommandDeps } from "./push";

export interface PublishOptions {
  title?: string;
}

/**
 * `waypoint publish <file>` (§ publish spec). A thin client: it POSTs the
 * markdown to the server, which renders HTML + PDF, uploads to R2, and indexes
 * the row. The server does all the work (rendering lives in exactly one place);
 * the CLI just prints the three URLs in the exact shape the Smitty `share` CLI
 * used, so the `alias share="waypoint publish"` cutover is seamless.
 */
export async function runPublish(
  file: string,
  options: PublishOptions,
  deps: CommandDeps,
): Promise<void> {
  const { config, io } = deps;

  const abs = path.resolve(process.cwd(), file);
  if (!existsSync(abs)) throw new CliError(`File not found: ${file}`);
  const markdown = readFileSync(abs, "utf8");

  const payload: PublishPayload = {
    markdown,
    filename: path.basename(abs),
    source: { host: os.hostname() },
  };
  const title = options.title?.trim();
  if (title) payload.title = title;

  const result = await publishDocument(config, payload);
  printShareOutput(io, result);
}

/** `waypoint publish --backfill` — index existing R2 objects into the registry. */
export async function runBackfill(deps: CommandDeps): Promise<void> {
  const { config, io } = deps;
  const result = await backfillPublications(config);
  io.log(`Backfill complete: indexed ${result.indexed}, skipped ${result.skipped}.`);
}

/** The `share`-identical output block: header lines, then the three URLs. */
function printShareOutput(io: IO, result: PublishResult): void {
  io.log(`Sharing: ${result.title}`);
  io.log(`ID: ${result.id.slice(0, 8)}`);
  io.log("");
  io.log("Share URLs:");
  io.log(`  HTML:     ${result.urls.html}`);
  io.log(`  PDF:      ${result.urls.pdf}`);
  io.log(`  Markdown: ${result.urls.md}`);
}
