import { beforeEach, describe, expect, it } from "vitest";

import {
  checkCommentRateLimit,
  clientIp,
  IP_LIMIT_PER_MINUTE,
  LINK_LIMIT_PER_DAY,
  resetRateLimits,
} from "../rate-limit";

/**
 * The clock is injected, so the windows are proven by moving time rather than by
 * waiting for it. Every test starts from empty buckets — the limiter is module
 * state by design (one process, one SQLite file).
 */
beforeEach(() => resetRateLimits());

const T0 = 1_760_000_000_000;

describe("per-IP minute bucket", () => {
  it("allows the limit and refuses the one after it", () => {
    for (let i = 0; i < IP_LIMIT_PER_MINUTE; i++) {
      expect(checkCommentRateLimit("1.2.3.4", "link-1", T0 + i).ok).toBe(true);
    }
    const refused = checkCommentRateLimit("1.2.3.4", "link-1", T0 + IP_LIMIT_PER_MINUTE);
    expect(refused.ok).toBe(false);
    expect(refused.scope).toBe("ip");
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("lets the same address back in once the window has rolled past", () => {
    for (let i = 0; i < IP_LIMIT_PER_MINUTE; i++) {
      checkCommentRateLimit("1.2.3.4", "link-1", T0 + i);
    }
    expect(checkCommentRateLimit("1.2.3.4", "link-1", T0 + 60_001).ok).toBe(true);
  });

  it("holds a separate window per address", () => {
    for (let i = 0; i < IP_LIMIT_PER_MINUTE; i++) {
      checkCommentRateLimit("1.2.3.4", "link-1", T0 + i);
    }
    expect(checkCommentRateLimit("5.6.7.8", "link-1", T0 + 100).ok).toBe(true);
  });

  it("does not count a refused attempt against the window", () => {
    for (let i = 0; i < IP_LIMIT_PER_MINUTE; i++) {
      checkCommentRateLimit("1.2.3.4", "link-1", T0);
    }
    // Hammering while blocked must not extend the block past the original window.
    for (let i = 0; i < 50; i++) checkCommentRateLimit("1.2.3.4", "link-1", T0 + 30_000);
    expect(checkCommentRateLimit("1.2.3.4", "link-1", T0 + 60_001).ok).toBe(true);
  });
});

describe("per-link day bucket", () => {
  it("refuses past the daily limit even from fresh addresses", () => {
    for (let i = 0; i < LINK_LIMIT_PER_DAY; i++) {
      expect(checkCommentRateLimit(`ip-${i}`, "link-1", T0 + i).ok).toBe(true);
    }
    const refused = checkCommentRateLimit("ip-new", "link-1", T0 + LINK_LIMIT_PER_DAY);
    expect(refused.ok).toBe(false);
    expect(refused.scope).toBe("link");
  });

  it("holds a separate day per link", () => {
    for (let i = 0; i < LINK_LIMIT_PER_DAY; i++) {
      checkCommentRateLimit(`ip-${i}`, "link-1", T0 + i);
    }
    expect(checkCommentRateLimit("ip-new", "link-2", T0 + 1).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("prefers the address Cloudflare's edge reports", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "10.0.0.1, 203.0.113.7",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("falls back to the first forwarded hop, then to a shared bucket", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" }))).toBe(
      "198.51.100.9",
    );
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
