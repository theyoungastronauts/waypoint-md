import { REALTIME_MODEL, REALTIME_VOICE, TRANSCRIBE_MODEL } from "../realtime";

/**
 * The phone lobby (Waypoint Voice, phone): the first stage of every call, before
 * a review is chosen. The call is accepted with this session; once a review is
 * picked, `session.update` swaps in that review's interview instructions and
 * tools. The voice is fixed here — OpenAI does not allow changing it after the
 * first audio — so it matches the browser's interview voice.
 */

export const LOBBY_GREETING =
  "Waypoint. Enter or say your review PIN, or press zero for your latest review.";

export const LOBBY_INSTRUCTIONS = [
  "You answer the Waypoint phone line. Your only job right now is to find out which review the caller wants to answer. Do not discuss anything else.",
  "",
  "- When the caller says a four-digit PIN, call open_review with it.",
  "- If they ask for their latest or most recent review, or say zero, call find_latest, tell them its title, and ask whether that is the one. If yes, call open_review with use_latest set to true.",
  "- If open_review returns an error, say so in a few words and ask again.",
  "- Keypad entry is handled for you; you will be told what to say.",
  "",
  "Style: spoken English, very short, friendly. Never read out ids.",
].join("\n");

export type LobbyToolName = "open_review" | "find_latest";

export const LOBBY_TOOLS = [
  {
    type: "function" as const,
    name: "open_review" as LobbyToolName,
    description: "Open the review the caller asked for: by its four-digit PIN, or the latest one once they confirmed it.",
    parameters: {
      type: "object",
      properties: {
        pin: { type: "string", description: "The four digits the caller said, e.g. \"4821\"." },
        use_latest: { type: "boolean", description: "True to open the latest review the caller just confirmed." },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "find_latest" as LobbyToolName,
    description: "Look up the caller's most recent open review, to confirm its title with them.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

/** The session the call is accepted with (`POST /v1/realtime/calls/{id}/accept`). */
export function lobbySessionConfig() {
  return {
    type: "realtime" as const,
    model: REALTIME_MODEL,
    instructions: LOBBY_INSTRUCTIONS,
    tools: LOBBY_TOOLS,
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
