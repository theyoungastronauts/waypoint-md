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
