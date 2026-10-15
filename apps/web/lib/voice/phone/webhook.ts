import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifying OpenAI's incoming-call webhook (Waypoint Voice, phone). OpenAI signs
 * webhooks with the Standard Webhooks scheme (developers.openai.com, webhooks
 * guide, checked 2026-10-14): the signed content is `${id}.${timestamp}.${body}`,
 * HMAC-SHA256 with the base64 key that follows `whsec_` in the signing secret,
 * sent as `webhook-signature: v1,<base64>` (several, space-separated, during a
 * key rotation). The raw body must be verified before it is parsed.
 *
 * The webhook route is public (OpenAI must reach it through the tunnel), so this
 * check is the only thing standing between the internet and a call being
 * answered: no valid signature, no call.
 */

/** Reject webhooks whose timestamp is further than this from now (replay window). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type WebhookVerdict =
  | { ok: true; id: string }
  | { ok: false; reason: "missing_headers" | "stale_timestamp" | "bad_signature" | "bad_secret" };

export function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): WebhookVerdict {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  if (key.length === 0) return { ok: false, reason: "bad_secret" };

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  const matches = signature.split(" ").some((part) => {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return matches ? { ok: true, id } : { ok: false, reason: "bad_signature" };
}

/**
 * Remembers recently seen webhook ids so a redelivered webhook is acknowledged
 * but not acted on twice (two accepts for one call). Bounded; oldest ids drop.
 */
export class SeenWebhooks {
  private readonly ids = new Set<string>();
  constructor(private readonly max = 500) {}

  /** True the first time an id is seen, false for a repeat. */
  firstTime(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.max) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }
}

/** One SIP header from the incoming-call event, in either shape OpenAI may send. */
type SipHeaders = Array<{ name?: unknown; value?: unknown }> | Record<string, unknown> | undefined;

/** A SIP header's value by name (case-insensitive), from an array or a map. */
export function sipHeader(headers: SipHeaders, name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (typeof h?.name === "string" && h.name.toLowerCase() === wanted && typeof h.value === "string") {
        return h.value;
      }
    }
    return null;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && typeof value === "string") return value;
  }
  return null;
}

/**
 * The caller's number from a SIP From header, e.g.
 * `"Tyler" <sip:+16045550100@pstn.twilio.com>;tag=abc` → `+16045550100`.
 * Only the user part of the SIP URI is read; display names are ignored (they
 * are trivially set by the caller).
 */
export function callerNumber(from: string | null): string | null {
  if (!from) return null;
  const match = /sips?:([^@;>]+)@/i.exec(from) ?? /tel:([^;>]+)/i.exec(from);
  if (!match) return null;
  const digits = match[1].replace(/[^\d+]/g, "");
  if (!/^\+?\d{7,15}$/.test(digits)) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
}
