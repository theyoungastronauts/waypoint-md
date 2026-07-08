import fs from "node:fs";
import path from "node:path";
import { HttpError } from "../api/http";
import { hasAllowedExtension, MAX_DOC_BYTES } from "./constants";

/**
 * The server-path ingest door (§7, §15). Off by default: reads are permitted
 * only for files that resolve — after following symlinks and `..` — to a
 * location inside `WAYPOINT_ALLOWED_ROOTS`. This is the guard that keeps the
 * endpoint from becoming an arbitrary-file-read.
 */

export class PathDoorError extends HttpError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = "PathDoorError";
  }
}

/** Parse `WAYPOINT_ALLOWED_ROOTS` (colon-separated). Empty when unset. */
export function configuredRoots(): string[] {
  const raw = process.env.WAYPOINT_ALLOWED_ROOTS;
  if (!raw) return [];
  return raw
    .split(":")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

/** True when at least one allowed root is configured. */
export function pathDoorEnabled(): boolean {
  return configuredRoots().length > 0;
}

/**
 * Resolve each configured root to its real (symlink-free) absolute path. Roots
 * that do not exist are dropped — they cannot contain any readable file.
 */
function resolvedRoots(): string[] {
  const out: string[] = [];
  for (const root of configuredRoots()) {
    try {
      out.push(fs.realpathSync(path.resolve(root)));
    } catch {
      // A misconfigured / missing root simply contributes nothing to the allowlist.
    }
  }
  return out;
}

/** True when `target` is `root` itself or lives beneath it (path-segment aware). */
function isWithin(target: string, root: string): boolean {
  if (target === root) return true;
  return target.startsWith(root + path.sep);
}

export interface PathDoorResult {
  /** Exact file bytes as a UTF-8 string (CRLF preserved; nothing normalized). */
  raw: string;
  /** The real, symlink-resolved absolute path that was read. */
  resolvedPath: string;
}

/**
 * Read a file through the path door, enforcing the allowlist. Throws a
 * {@link PathDoorError} when the door is disabled, the path escapes every root,
 * the file is missing, oversized, or not a markdown/text file.
 */
export function readPathDoor(inputPath: string): PathDoorResult {
  const roots = resolvedRoots();
  if (roots.length === 0) {
    throw new PathDoorError(
      403,
      "path_door_disabled",
      "The path ingest door is disabled. Set WAYPOINT_ALLOWED_ROOTS to enable it.",
    );
  }

  if (inputPath.includes("\0")) {
    throw new PathDoorError(400, "invalid_path", "Path contains a null byte.");
  }

  const absolute = path.resolve(inputPath);

  let real: string;
  try {
    // realpath resolves every symlink and `..` in the path, so a symlink that
    // points outside an allowed root resolves to its real (rejected) location.
    real = fs.realpathSync(absolute);
  } catch {
    throw new PathDoorError(404, "file_not_found", "No readable file at that path.");
  }

  const stat = fs.statSync(real);
  if (!stat.isFile()) {
    throw new PathDoorError(400, "not_a_file", "The path does not point to a regular file.");
  }

  // Containment is checked against the REAL path — after symlink resolution.
  if (!roots.some((root) => isWithin(real, root))) {
    throw new PathDoorError(
      403,
      "path_not_allowed",
      "That path is outside the allowed roots (WAYPOINT_ALLOWED_ROOTS).",
    );
  }

  if (!hasAllowedExtension(real)) {
    throw new PathDoorError(
      400,
      "unsupported_file_type",
      "Only .md, .markdown, and .txt files can be ingested.",
    );
  }

  if (stat.size > MAX_DOC_BYTES) {
    throw new PathDoorError(413, "file_too_large", "File exceeds the 1 MB ingest limit.");
  }

  return { raw: fs.readFileSync(real, "utf8"), resolvedPath: real };
}
