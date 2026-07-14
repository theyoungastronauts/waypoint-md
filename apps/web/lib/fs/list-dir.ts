import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HttpError } from "@/lib/api/http";
import { normalizeToHome } from "@/lib/attach-path";

/**
 * The home-scoped directory listing behind the "Attach file" picker (§14, §15).
 *
 * Browsing is rooted at the server's home directory and cannot escape it. This
 * mirrors the security model of the path-ingest door
 * (`lib/ingest/path-door.ts`): every requested path — and every entry it
 * surfaces — is resolved with `realpath` (following symlinks and `..`) and only
 * then checked for containment inside the *real* home directory. A `..` segment
 * or a symlink that points outside home resolves to its true location and is
 * rejected. No file contents are ever read; only names and types are returned.
 */

export class FsListError extends HttpError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = "FsListError";
  }
}

export type FsEntryType = "dir" | "file";

export interface FsEntry {
  name: string;
  type: FsEntryType;
  /** Home-relative (`~/…`) path, ready to hand straight back to the picker. */
  path: string;
}

export interface FsListResult {
  /** The listed directory, normalized to `~/…` (`~` at the home root). */
  cwd: string;
  /** The parent directory (`~/…`), or null when already at the home root. */
  parent: string | null;
  entries: FsEntry[];
}

/** The real, symlink-resolved home directory — the one containment boundary. */
function homeRoot(): string {
  return fs.realpathSync(os.homedir());
}

/** True when `target` is `root` itself or lives beneath it (path-segment aware). */
function isWithin(target: string, root: string): boolean {
  if (target === root) return true;
  return target.startsWith(root + path.sep);
}

/**
 * Turn the requested path (absent/empty ⇒ home root, `~/…`, absolute, or a bare
 * relative path taken as home-relative) into an absolute path, lexically
 * collapsing `..`. Symlink resolution and the containment check happen later,
 * on the realpath — this step is purely syntactic.
 */
function toAbsolute(requested: string | null | undefined, home: string): string {
  const raw = (requested ?? "").trim();
  if (raw.length === 0 || raw === "~" || raw === "~/") return home;
  let expanded: string;
  if (raw.startsWith("~/")) expanded = path.join(home, raw.slice(2));
  else if (path.isAbsolute(raw)) expanded = raw;
  else expanded = path.join(home, raw);
  return path.resolve(expanded);
}

/**
 * List a directory inside the server's home tree. Throws {@link FsListError}
 * when the path holds a null byte, does not exist, is not a directory, or —
 * after symlink/`..` resolution — resolves outside the real home directory.
 * Entries whose real target escapes home (or is a broken symlink, or neither a
 * regular file nor a directory) are silently omitted rather than surfaced.
 */
export function listHomeDir(
  requested: string | null | undefined,
  opts: { all?: boolean } = {},
): FsListResult {
  const home = homeRoot();

  if (typeof requested === "string" && requested.includes("\0")) {
    throw new FsListError(400, "invalid_path", "Path contains a null byte.");
  }

  const absolute = toAbsolute(requested, home);

  let real: string;
  try {
    // realpath resolves every symlink and `..`, so a symlink (or a `..` chain)
    // that points outside home resolves to its real, rejectable location.
    real = fs.realpathSync(absolute);
  } catch {
    throw new FsListError(404, "not_found", "No such directory.");
  }

  // Containment is checked against the REAL path — after symlink resolution.
  if (!isWithin(real, home)) {
    throw new FsListError(403, "path_not_allowed", "That path is outside the home directory.");
  }

  const stat = fs.statSync(real);
  if (!stat.isDirectory()) {
    throw new FsListError(400, "not_a_directory", "That path is not a directory.");
  }

  const includeAll = opts.all === true;
  const entries: FsEntry[] = [];
  for (const name of fs.readdirSync(real)) {
    if (!includeAll && name.startsWith(".")) continue;
    const childAbs = path.join(real, name);

    let childReal: string;
    try {
      childReal = fs.realpathSync(childAbs);
    } catch {
      continue; // broken symlink — nothing to navigate to or pick.
    }
    // An entry (or its symlink target) that escapes home is never surfaced.
    if (!isWithin(childReal, home)) continue;

    let childStat: fs.Stats;
    try {
      childStat = fs.statSync(childReal);
    } catch {
      continue;
    }
    const type: FsEntryType | null = childStat.isDirectory()
      ? "dir"
      : childStat.isFile()
        ? "file"
        : null;
    if (type === null) continue; // sockets, devices, fifos — not pickable.

    // The logical path under the (real) cwd, so re-navigation is deterministic.
    entries.push({ name, type, path: normalizeToHome(childAbs, home) });
  }

  // Directories first, then files; alphabetical within each group.
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    cwd: normalizeToHome(real, home),
    parent: real === home ? null : normalizeToHome(path.dirname(real), home),
    entries,
  };
}
