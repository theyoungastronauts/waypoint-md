/**
 * The tools the voice model is given (Waypoint Voice). Defined once here: the
 * server puts them in the Realtime session config it mints, and the browser's
 * interview executor (`interview.ts`) implements them against the review page's
 * response store. Client-safe: no Node or DB imports.
 *
 * Questions are referred to by their 1-based number in review order — the same
 * number the review page shows — never by an internal id.
 */

export type VoiceToolName =
  | "set_style"
  | "next_question"
  | "go_to_question"
  | "record_answer"
  | "flag_question"
  | "skip_question"
  | "lookup"
  | "whats_left"
  | "get_readback"
  | "submit_review"
  | "end_call";

/** A Realtime function-tool definition (`session.tools[]`). */
export interface RealtimeFunctionTool {
  type: "function";
  name: VoiceToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

const questionNumber = {
  type: "integer",
  minimum: 1,
  description: "The question's number, as returned by next_question.",
};

export const VOICE_TOOLS: RealtimeFunctionTool[] = [
  {
    type: "function",
    name: "set_style",
    description:
      "Record whether the reviewer wants this call brief or thorough. Call once, right after they choose.",
    parameters: {
      type: "object",
      properties: { style: { type: "string", enum: ["brief", "thorough"] } },
      required: ["style"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "next_question",
    description:
      "Get the next question to ask, with its options, the author's suggestion and any answer already on it. Returns done=true when every question has been covered in this call.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "go_to_question",
    description: "Get a specific question by number, e.g. when the reviewer says 'go back to question 3'.",
    parameters: {
      type: "object",
      properties: { number: questionNumber },
      required: ["number"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "record_answer",
    description: [
      "Write the reviewer's answer to a question into the review. This replaces what was there.",
      "Choice questions: pass `options` as the option numbers they chose (one for single-select); omit it only if they answered in words without picking any option.",
      "Anything they add as explanation goes in `note`, in their words.",
      "Free-text questions: pass their answer as `text`, faithful to their words (tidied, nothing added).",
      "If they accept the answer already on the question, pass keep_current=true instead.",
      "If it returns an error, follow its message.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        number: questionNumber,
        options: { type: "array", items: { type: "integer", minimum: 1 } },
        text: { type: "string" },
        note: { type: "string" },
        keep_current: { type: "boolean" },
      },
      required: ["number"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "flag_question",
    description: "Mark a question 'come back to this' (the reviewer is unsure or wants to revisit).",
    parameters: {
      type: "object",
      properties: { number: questionNumber },
      required: ["number"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "skip_question",
    description: "Mark a question deliberately skipped.",
    parameters: {
      type: "object",
      properties: { number: questionNumber },
      required: ["number"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "lookup",
    description:
      "Look up background from the document when the reviewer asks something (why was this suggested, what does it cost, who is involved). Answer only from what it returns.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "What the reviewer asked about, in a few words." },
        number: { ...questionNumber, description: "The question it relates to, if any." },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "whats_left",
    description: "List the questions not yet answered in this review, and any flagged ones.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "get_readback",
    description: "Get everything captured so far, question by question, to read back before submitting.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "submit_review",
    description:
      "Submit the review. Only after the read-back, once the reviewer has confirmed it is right.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "end_call",
    description:
      "End the call without submitting, when the reviewer wants to stop early. Their answers stay saved as a draft.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];
