/**
 * In-memory rate limiting for the one public write endpoint (decision C-2).
 *
 * Deliberately not a dependency and not a table. The public surface is a single
 * POST behind an unguessable per-reviewer link, on a single-process SQLite app —
 * the job here is to keep a leaked link from being turned into a flood, not to
 * survive a distributed attack. Two buckets, because they answer different
 * questions: **per IP per minute** bounds a burst from one place, and **per link
 * per day** bounds the total damage one leaked URL can do.
 *
 * The clock is injected everywhere so the windows are testable without waiting.
 * Restarting the server clears the buckets, which is the accepted cost of not
 * persisting them.
 */

/** Comments one IP may post in a minute (decision C-2). */
export const IP_LIMIT_PER_MINUTE = 30;
/** Comments one review link may carry in a day (decision C-2). */
export const LINK_LIMIT_PER_DAY = 500;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Stop tracking keys once this many accumulate; the sweep drops expired ones. */
const SWEEP_THRESHOLD = 10_000;

type Bucket = Map<string, number[]>;

const ipBucket: Bucket = new Map();
const linkBucket: Bucket = new Map();

export type RateLimitScope = "ip" | "link";

export interface RateLimitDecision {
  ok: boolean;
  /** Which bucket refused, when one did. */
  scope?: RateLimitScope;
  /** Whole seconds until the oldest hit in the offending window expires. */
  retryAfterSeconds?: number;
}

/**
 * Check both buckets and, when the comment is allowed, record it. Checking and
 * recording are one call on purpose: a caller that could check without
 * recording would eventually forget to record.
 */
export function checkCommentRateLimit(
  ip: string,
  linkId: string,
  now: number = Date.now(),
): RateLimitDecision {
  const ipHits = prune(ipBucket, ip, now, MINUTE_MS);
  if (ipHits.length >= IP_LIMIT_PER_MINUTE) {
    return { ok: false, scope: "ip", retryAfterSeconds: retryAfter(ipHits[0], now, MINUTE_MS) };
  }

  const linkHits = prune(linkBucket, linkId, now, DAY_MS);
  if (linkHits.length >= LINK_LIMIT_PER_DAY) {
    return { ok: false, scope: "link", retryAfterSeconds: retryAfter(linkHits[0], now, DAY_MS) };
  }

  ipHits.push(now);
  linkHits.push(now);
  ipBucket.set(ip, ipHits);
  linkBucket.set(linkId, linkHits);
  sweep(ipBucket, now, MINUTE_MS);
  sweep(linkBucket, now, DAY_MS);
  return { ok: true };
}

/** Drop every bucket. Test-only in practice; harmless in production. */
export function resetRateLimits(): void {
  ipBucket.clear();
  linkBucket.clear();
}

/** The hits for one key still inside the window, oldest first. */
function prune(bucket: Bucket, key: string, now: number, windowMs: number): number[] {
  const hits = bucket.get(key) ?? [];
  const cutoff = now - windowMs;
  const live = hits.filter((at) => at > cutoff);
  return live;
}

function retryAfter(oldestHit: number, now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((oldestHit + windowMs - now) / 1000));
}

/**
 * Drop keys whose every hit has expired. Only runs once a bucket has grown past
 * the threshold, so the common path stays O(1) — without it a long-lived process
 * would hold one array per IP that ever posted.
 */
function sweep(bucket: Bucket, now: number, windowMs: number): void {
  if (bucket.size < SWEEP_THRESHOLD) return;
  const cutoff = now - windowMs;
  for (const [key, hits] of bucket) {
    if (hits.length === 0 || hits[hits.length - 1] <= cutoff) bucket.delete(key);
  }
}

/**
 * The client address behind Cloudflare's tunnel. `cf-connecting-ip` is set by
 * Cloudflare's edge and is the only header that means anything here — the tunnel
 * is the sole public path to these routes, so a request that reaches them
 * without one came from the tailnet. `x-forwarded-for` is honoured as a fallback
 * for a different front end, and an unidentifiable client shares one bucket
 * rather than escaping the limit entirely.
 */
export function clientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}
