/**
 * Where a review link points (§ media spec Q1/Q2). The public review surface is
 * served by a Cloudflare Tunnel on a hostname of its own — `review.tylersavery.com`
 * by default configuration — while authoring stays on the tailnet hostname. So a
 * link the authoring UI hands out cannot be built from the request's own origin:
 * it has to name the public host explicitly.
 *
 * `WAYPOINT_REVIEW_PUBLIC_URL` is that host. Unset, the helpers return a
 * server-relative URL instead of guessing: the link still works for anyone who
 * can already reach the app, and the UI says plainly that the public base is not
 * configured (see `docs/ops/review-tunnel.md`).
 */

/** The configured public base with any trailing slash removed, or null. */
export function reviewPublicBase(): string | null {
  const raw = process.env.WAYPOINT_REVIEW_PUBLIC_URL;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

/** The path half of a review link — the part the tunnel's ingress rule matches. */
export function reviewLinkPath(publicationId: string, token: string): string {
  return `/r/${encodeURIComponent(publicationId)}?k=${encodeURIComponent(token)}`;
}

/**
 * The URL to hand a reviewer. Absolute when the public base is configured,
 * server-relative when it is not.
 */
export function reviewLinkUrl(publicationId: string, token: string): string {
  const base = reviewPublicBase();
  const path = reviewLinkPath(publicationId, token);
  return base ? `${base}${path}` : path;
}
