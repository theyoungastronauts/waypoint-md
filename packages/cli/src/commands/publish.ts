import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  backfillPublications,
  createMediaPublication,
  finalizeMediaPublication,
  publishDocument,
  uploadPresigned,
  type MediaFinalizeResult,
  type MediaPublishPayload,
  type PublishPayload,
  type PublishResult,
} from "../client";
import { CliError, type IO } from "../io";
import type { CommandDeps } from "./push";

export interface PublishOptions {
  title?: string;
  group?: string;
  label?: string;
  manifest?: string;
  json?: boolean;
}

/**
 * The extensions `publish` routes to the media flow, and the content type each
 * one is uploaded as (decision B-3). The server holds the authoritative
 * allowlist (`lib/publish/media-types.ts`); this map only decides which of the
 * two flows a file takes and what to declare, and a type the server refuses
 * comes back as a clean API error. Kept here rather than shared because the CLI
 * ships to npm on its own, with no dependency on the web app.
 */
const MEDIA_CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
};

/**
 * `waypoint publish <file>` (§ publish spec, extended by § media spec Phase B).
 * Dispatches on extension: markdown keeps the original thin-client flow (the
 * server renders and uploads); media takes the presigned-upload flow, where the
 * bytes go from here straight to R2 and never through the server.
 */
export async function runPublish(
  file: string,
  options: PublishOptions,
  deps: CommandDeps,
): Promise<void> {
  const abs = path.resolve(process.cwd(), file);
  if (!existsSync(abs)) throw new CliError(`File not found: ${file}`);

  const contentType = MEDIA_CONTENT_TYPES[path.extname(abs).toLowerCase()];
  if (contentType) {
    await publishMedia(abs, contentType, options, deps);
    return;
  }
  await publishMarkdown(abs, options, deps);
}

/** The original markdown flow: POST the source, print the three share URLs. */
async function publishMarkdown(
  abs: string,
  options: PublishOptions,
  deps: CommandDeps,
): Promise<void> {
  const { config, io } = deps;
  const markdown = readFileSync(abs, "utf8");

  const payload: PublishPayload = {
    markdown,
    filename: path.basename(abs),
    source: { host: os.hostname() },
  };
  const title = options.title?.trim();
  if (title) payload.title = title;

  const result = await publishDocument(config, payload);

  if (options.json) {
    io.log(
      JSON.stringify({ id: result.id, title: result.title, kind: "markdown", urls: result.urls }),
    );
    return;
  }
  printShareOutput(io, result);
}

/**
 * The media flow (decision B-3): reserve the row and a presigned PUT, stream the
 * file to storage, then finalize. Three steps rather than one because the server
 * must never see the bytes — a 250 MB ProRes master would not survive the trip.
 */
async function publishMedia(
  abs: string,
  contentType: string,
  options: PublishOptions,
  deps: CommandDeps,
): Promise<void> {
  const { config, io } = deps;
  const bytes = statSync(abs).size;
  if (bytes === 0) throw new CliError(`File is empty: ${path.basename(abs)}`);

  const manifest = readManifest(abs, options.manifest);

  const payload: MediaPublishPayload = {
    filename: path.basename(abs),
    contentType,
    bytes,
    source: { host: os.hostname() },
  };
  const title = options.title?.trim() || manifestTitle(manifest) || stem(abs);
  if (title) payload.title = title;
  if (options.group?.trim()) payload.group = options.group.trim();
  if (options.label?.trim()) payload.label = options.label.trim();
  if (manifest) payload.manifest = manifest;

  const created = await createMediaPublication(config, payload);

  // Progress goes to stderr under --json so stdout carries the machine output
  // and nothing else, while a 500 MB upload still shows signs of life.
  const progress = options.json ? io.warn : io.log;
  if (!options.json) io.log(`Uploading ${path.basename(abs)} (${formatBytes(bytes)})…`);
  await uploadPresigned({
    url: created.uploadUrl,
    filePath: abs,
    contentType,
    contentLength: bytes,
    onProgress: (percent) => progress(`  ${percent}%`),
  });

  const result = await finalizeMediaPublication(config, created.id);

  if (options.json) {
    io.log(
      JSON.stringify({
        id: result.id,
        title: result.title,
        kind: result.kind,
        urls: {
          file: result.urls.file,
          manifest: result.urls.manifest,
          page: `${config.publicUrl}${result.urls.page}`,
        },
      }),
    );
    return;
  }
  printMediaOutput(io, result, `${config.publicUrl}${result.urls.page}`);
}

/**
 * The render manifest: an explicit `--manifest <path>`, else `<file>.manifest.json`
 * beside the render when it exists — which is exactly what the video studio
 * writes, so `waypoint publish out/spot.mp4` picks it up with no flag.
 */
function readManifest(abs: string, explicit: string | undefined): Record<string, unknown> | null {
  const manifestPath = explicit
    ? path.resolve(process.cwd(), explicit)
    : `${abs}.manifest.json`;

  if (!existsSync(manifestPath)) {
    if (explicit) throw new CliError(`Manifest not found: ${explicit}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CliError(`Manifest is not valid JSON (${path.basename(manifestPath)}): ${detail}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError(`Manifest must be a JSON object: ${path.basename(manifestPath)}`);
  }
  return parsed as Record<string, unknown>;
}

/** A `title` inside the manifest wins over the filename (decision B-3). */
function manifestTitle(manifest: Record<string, unknown> | null): string | null {
  const value = manifest?.title;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The filename without its directory or extension. */
function stem(abs: string): string {
  return path.basename(abs, path.extname(abs));
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

/** The media equivalent: the file, the manifest when there is one, the page. */
function printMediaOutput(io: IO, result: MediaFinalizeResult, pageUrl: string): void {
  io.log(`Published: ${result.title}`);
  io.log(`ID: ${result.id.slice(0, 8)}`);
  io.log("");
  io.log("Share URLs:");
  io.log(`  File:     ${result.urls.file}`);
  if (result.urls.manifest) io.log(`  Manifest: ${result.urls.manifest}`);
  io.log(`  Page:     ${pageUrl}`);
}

/** Byte counts as the progress line shows them ("248.3 MB"). */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
