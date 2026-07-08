/**
 * Resolve a `next` query param to a safe same-origin path for post-login
 * navigation. Browsers treat `\` as `/` in URLs, so prefix checks like
 * `startsWith("/") && !startsWith("//")` are bypassable via `/\evil.com`.
 * Resolving against the origin and comparing `URL.origin` closes that class
 * of bypass entirely; anything cross-origin (or unparseable) falls back to "/".
 */
export function resolveNextPath(raw: string | null, origin: string): string {
  if (!raw) return "/";
  let resolved: URL;
  try {
    resolved = new URL(raw, origin);
  } catch {
    return "/";
  }
  if (resolved.origin !== origin) return "/";
  return resolved.pathname + resolved.search + resolved.hash;
}
