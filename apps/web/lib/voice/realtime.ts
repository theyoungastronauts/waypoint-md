import { HttpError } from "@/lib/api/http";
import type { VoiceBrief } from "./brief";
import { VOICE_TOOLS } from "./tools-spec";

/**
 * OpenAI Realtime settings and the server half of the call setup (Waypoint
 * Voice). The server mints a short-lived client key with the whole session
 * configuration baked in — model, instructions, tools, voice — so the browser
 * receives only that key and the real `OPENAI_API_KEY` never leaves the server.
 *
 * Checked against developers.openai.com on 2026-10-09:
 *   - POST /v1/realtime/client_secrets → `{ value: "ek_…", expires_at, session }`
 *   - `gpt-realtime-2.1` is the current GA Realtime model; the mini variant is
 *     documented as weaker at function calling, which this interview depends on.
 */
export const REALTIME_MODEL = "gpt-realtime-2.1";
export const REALTIME_VOICE = "marin";
export const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
export const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
/** The browser POSTs its SDP offer here with the client key. */
export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
/** Long enough to prepare and connect; a started call outlives its key. */
export const CLIENT_SECRET_TTL_SECONDS = 600;

/**
 * The interviewer's instructions. Kept free of per-question content (that comes
 * back through tools) so they stay identical for the whole call, which keeps the
 * Realtime prompt cache hitting.
 */
export function buildInstructions(brief: VoiceBrief): string {
  const count = brief.questions.length;
  return [
    `You are Waypoint Voice. You interview a reviewer, out loud, through a review document titled "${brief.title}". It has ${count} question${count === 1 ? "" : "s"}.`,
    "",
    "Your only job is to ask each question, take the reviewer's answer and record it. You are an interviewer, not an advisor: never recommend an option or argue for one. If asked what you think, give the author's suggestion and reasoning from the tools and say the decision is theirs.",
    "",
    `What the document is about: ${brief.intro}`,
    "",
    "How the call goes:",
    "1. Greet the reviewer in one short sentence, say what the document is in a sentence or two, and how many questions there are. Then ask whether they want this brief or thorough, and call set_style with their choice.",
    "   - Brief: say each question in its short spoken form, give the options compactly, skip background unless asked, confirm each answer in a few words.",
    "   - Thorough: say the question, every option, the author's suggestion and the reason for it, and confirm each answer back in full.",
    "2. Call next_question to get each question, then ask it. Only ever use questions and options the tools give you. Never invent any. If a question already has an answer on it, say so and ask whether to keep it or change it.",
    "3. When the reviewer answers, call record_answer. Choice questions: pass the option numbers. Free-text questions: pass their answer in their own words, tidied but with nothing added. Extra explanation on a choice goes in note. If record_answer returns an error, do what its message says.",
    "4. At any point the reviewer can say: skip (call skip_question), come back to this or not sure (call flag_question), repeat the options (say them again), what's left (call whats_left), or go back to a question (call go_to_question). If they ask about background, call lookup and answer only from what it returns; if it does not cover the question, say the document does not say.",
    "5. When next_question says every question is covered: if any are flagged, offer to go back to them. Then call get_readback and read back what was captured, question by question, briefly. Ask whether anything needs changing, and fix it with the same tools. When they confirm it is right, call submit_review, then say a short goodbye.",
    "6. Never call submit_review before the reviewer has heard the read-back and confirmed it. If they want to stop early, do not submit: tell them their answers are saved as a draft, and call end_call.",
    "",
    "Style: spoken English, short sentences, natural and warm but efficient. No markdown, no lists read as symbols, never read out ids or numbers in brackets. Let the reviewer interrupt you.",
  ].join("\n");
}

/** The Realtime session configuration baked into the client key. */
export function buildSessionConfig(brief: VoiceBrief) {
  return {
    type: "realtime" as const,
    model: REALTIME_MODEL,
    instructions: buildInstructions(brief),
    tools: VOICE_TOOLS,
    tool_choice: "auto" as const,
    audio: {
      input: {
        transcription: { model: TRANSCRIBE_MODEL, language: "en" },
        turn_detection: { type: "semantic_vad" as const },
      },
      output: { voice: REALTIME_VOICE },
    },
  };
}

export interface ClientSecret {
  value: string;
  /** Unix seconds. */
  expiresAt: number;
}

/**
 * Mint a short-lived Realtime client key for this brief's session. Upstream
 * failures surface as 502 `voice_upstream` with the OpenAI status logged
 * server-side (the body may echo request details, so it is not returned).
 */
export async function mintClientSecret(apiKey: string, brief: VoiceBrief): Promise<ClientSecret> {
  let res: Response;
  try {
    res = await fetch(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_TTL_SECONDS },
        session: buildSessionConfig(brief),
      }),
    });
  } catch (err) {
    console.error("[voice-session] client_secrets request failed:", err);
    throw new HttpError(502, "voice_upstream", "Could not reach OpenAI to start the call.");
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[voice-session] client_secrets HTTP ${res.status}: ${detail.slice(0, 500)}`);
    throw new HttpError(502, "voice_upstream", `OpenAI refused to start the call (HTTP ${res.status}).`);
  }

  const body = (await res.json().catch(() => null)) as { value?: unknown; expires_at?: unknown } | null;
  if (!body || typeof body.value !== "string" || typeof body.expires_at !== "number") {
    console.error("[voice-session] client_secrets returned an unexpected body");
    throw new HttpError(502, "voice_upstream", "OpenAI returned an unexpected response.");
  }
  return { value: body.value, expiresAt: body.expires_at };
}
