/**
 * Path normalization for the "Attach file" affordance (§14, decision B-5). A
 * reviewer's answer can point the agent at a filesystem path; when that path is
 * under the server's home directory we rewrite the leading home prefix to `~/…`
 * so the inserted text is portable and readable. No file is ever read — this is
 * pure string work over a path the reviewer typed or pasted.
 */

/**
 * Rewrite an absolute path under `home` to a `~/…` form; leave everything else
 * untouched. The home match is **anchored to the start** of the path and only
 * at a path-segment boundary, so a home string that merely appears as a
 * substring (`/home/tyler-backup/x` against home `/home/tyler`) is never
 * rewritten. A trailing slash on `home` is tolerated. When `home` is unknown
 * (the endpoint failed) the path is returned trimmed and otherwise unchanged.
 * No structure other than the home prefix is collapsed.
 */
export function normalizeToHome(raw: string, home: string | null | undefined): string {
  const path = raw.trim();
  if (!home) return path;
  // Tolerate a trailing slash on the reported home dir so the boundary math and
  // the resulting `~/…` never gain a doubled slash.
  const base = home.replace(/\/+$/, "");
  if (base.length === 0) return path;
  if (path === base) return "~";
  const prefix = `${base}/`;
  if (path.startsWith(prefix)) return `~/${path.slice(prefix.length)}`;
  return path;
}

// Module-level cache: the server's home dir never changes for the life of the
// page, so it is fetched at most once and shared across every answer field.
// `undefined` = not yet fetched; `null` = fetched but unavailable.
let homeCache: string | null | undefined;
let homeInflight: Promise<string | null> | null = null;

/**
 * Fetch the server's home directory once and cache it (§14). On any failure it
 * resolves to `null` so callers degrade gracefully — {@link normalizeToHome}
 * then leaves the path absolute rather than blocking the insert.
 */
export async function getHomeDir(): Promise<string | null> {
  if (homeCache !== undefined) return homeCache;
  if (!homeInflight) {
    homeInflight = fetch("/api/env/home")
      .then((res) => {
        if (!res.ok) throw new Error(`home lookup failed (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: { home?: unknown }) => {
        homeCache = typeof data.home === "string" ? data.home : null;
        return homeCache;
      })
      .catch(() => {
        homeCache = null;
        return null;
      })
      .finally(() => {
        homeInflight = null;
      });
  }
  return homeInflight;
}

/** Test-only: clear the cached home dir so each case controls the fetch. */
export function __resetHomeCacheForTest(): void {
  homeCache = undefined;
  homeInflight = null;
}
