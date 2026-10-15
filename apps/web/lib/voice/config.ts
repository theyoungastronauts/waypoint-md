import { timingSafeEqual } from "node:crypto";
import { aiEnabled } from "@/lib/ai/config";

/**
 * The server-side capability gate for Waypoint Voice (mirrors {@link ../ai/config}).
 * A call needs two keys: Claude writes the voice brief (`ANTHROPIC_API_KEY`) and
 * OpenAI Realtime runs the conversation (`OPENAI_API_KEY`). Both live in env only;
 * the OpenAI key is used server-side to mint a short-lived client key and never
 * reaches the browser. With either missing, the Talk button does not render and
 * the voice routes answer 400 `voice_unavailable`.
 */

/** The trimmed `OPENAI_API_KEY`, or null when unset/blank. */
export function getOpenAiKey(): string | null {
  const raw = process.env.OPENAI_API_KEY;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Whether voice calls are available: both the Anthropic and OpenAI keys are set. */
export function voiceEnabled(): boolean {
  return aiEnabled() && getOpenAiKey() !== null;
}

/** The trimmed `OPENAI_WEBHOOK_SECRET` (signs incoming-call webhooks), or null. */
export function getWebhookSecret(): string | null {
  const raw = process.env.OPENAI_WEBHOOK_SECRET;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The caller numbers allowed to reach Waypoint by phone (decision Q5), from
 * `WAYPOINT_PHONE_ALLOWLIST`: comma-separated E.164 numbers. Spaces, dashes and
 * brackets are ignored, so `+1 (604) 555-0100` and `+16045550100` match.
 */
export function getPhoneAllowlist(): string[] {
  const raw = process.env.WAYPOINT_PHONE_ALLOWLIST ?? "";
  return raw
    .split(",")
    .map((n) => normalizePhoneNumber(n))
    .filter((n): n is string => n !== null);
}

/** Reduce a number to `+` and digits; null when nothing number-like is left. */
export function normalizePhoneNumber(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (!/^\+?\d{7,15}$/.test(digits)) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

/**
 * Whether calling in by phone is available: voice itself, the webhook signing
 * secret, and at least one allowlisted number. Without all three, the webhook
 * rejects every call and no PIN is shown.
 */
export function phoneEnabled(): boolean {
  return voiceEnabled() && getWebhookSecret() !== null && getPhoneAllowlist().length > 0;
}

/**
 * The caller's own security PIN (`WAYPOINT_PHONE_PIN`, 4–8 digits), asked for on
 * the keypad before the "latest review" shortcut opens anything (Tyler,
 * 2026-10-15). Review PINs don't need it. Null when unset or malformed, which
 * turns the shortcut off.
 */
export function getPhoneSecurityPin(): string | null {
  const raw = process.env.WAYPOINT_PHONE_PIN?.trim() ?? "";
  return /^\d{4,8}$/.test(raw) ? raw : null;
}

/** Constant-time check of keyed digits against the security PIN; null when none is set. */
export function checkPhoneSecurityPin(entered: string): boolean | null {
  const pin = getPhoneSecurityPin();
  if (!pin) return null;
  const a = Buffer.from(entered);
  const b = Buffer.from(pin);
  return a.length === b.length && timingSafeEqual(a, b);
}
