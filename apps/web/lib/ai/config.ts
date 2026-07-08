/**
 * The server-side capability gate for AI features (§14, §15). The key lives in
 * env only — never in the DB, never in a client bundle. Callers use
 * {@link aiEnabled} to decide whether to render the sidebar / quick actions
 * (server components pass the boolean down; the client never sees the key).
 */

/** The trimmed `ANTHROPIC_API_KEY`, or null when unset/blank. */
export function getAnthropicKey(): string | null {
  const raw = process.env.ANTHROPIC_API_KEY;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether AI features (sidebar chat, explain-this-question, and Phase 8's
 * adoptive import) are available. Purely a function of the env key — no DB, no
 * client exposure — so it is safe to call from server components, route
 * handlers, and the health endpoint.
 */
export function aiEnabled(): boolean {
  return getAnthropicKey() !== null;
}
