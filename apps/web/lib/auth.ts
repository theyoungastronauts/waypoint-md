/**
 * Single-token auth model (§15). `WAYPOINT_TOKEN` unset => fully open;
 * set => always enforced. This module is the one place that knows the token and
 * the comparison rule; the middleware and the login route are its only callers.
 *
 * Deliberately free of Node-only APIs (no `node:crypto`, no DB access) so it is
 * safe to import from the Edge-runtime middleware. Tokens live in env only —
 * never in the DB, never in a client bundle (§15).
 */

/** Name of the httpOnly session cookie the web login exchange sets. */
export const SESSION_COOKIE = "wp_session";

/**
 * Routes reachable without credentials (§15): the health handshake target, the
 * login exchange itself, and the login page a browser is redirected to. Every
 * other route is protected by default.
 */
const OPEN_PATHS = new Set<string>(["/api/health", "/api/auth/login", "/login"]);

/**
 * The public review surface (§ media spec Phase C, decision C-3): the only
 * prefixes in the app that open without credentials, and the only two paths the
 * Cloudflare Tunnel's ingress forwards. Every capability check inside them is
 * the `?k=` review link itself, which is per-reviewer and revocable.
 *
 * The trailing slash is load-bearing: `/r/` opens `/r/<id>` and nothing else —
 * not `/r` itself, and not a future `/rollback`.
 */
const OPEN_PREFIXES = ["/r/", "/api/r/"] as const;

export function isOpenPath(pathname: string): boolean {
  if (OPEN_PATHS.has(pathname)) return true;
  return OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** The configured token, or null when auth is disabled (open mode). */
export function getConfiguredToken(): string | null {
  const raw = process.env.WAYPOINT_TOKEN;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Whether a token is configured (auth enforced) at all. */
export function authEnabled(): boolean {
  return getConfiguredToken() !== null;
}

/** Extract a bearer credential from an `Authorization` header value. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Constant-time string comparison — no `node:crypto` so it runs unchanged in the
 * Edge middleware. Length is allowed to short-circuit (a shared secret's length
 * is not sensitive); byte content is compared without early exit.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

/**
 * True when the presented credential authorizes the request. In open mode (no
 * token configured) everything authorizes; otherwise the credential must match
 * the configured token exactly.
 */
export function credentialAuthorizes(presented: string | null | undefined): boolean {
  const token = getConfiguredToken();
  if (!token) return true;
  if (!presented) return false;
  return constantTimeEqual(presented, token);
}
