import { z } from "zod";

/**
 * A voice call's transcript (Waypoint Voice): what the reviewer said, what the
 * voice model said, and every tool call it made with its result. Tool entries
 * are what make a misheard answer checkable — they show exactly what was written
 * into the review and when. Client-safe (zod only).
 */

const MAX_TEXT = 8_000;

export const transcriptEntrySchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("reviewer"),
    at: z.string().max(40),
    text: z.string().max(MAX_TEXT),
  }),
  z.object({
    role: z.literal("voice"),
    at: z.string().max(40),
    text: z.string().max(MAX_TEXT),
  }),
  z.object({
    role: z.literal("tool"),
    at: z.string().max(40),
    name: z.string().max(64),
    args: z.string().max(MAX_TEXT),
    result: z.string().max(MAX_TEXT),
  }),
]);

export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

/** Hard ceiling on entries per call — a 60-minute session stays well under it. */
export const MAX_TRANSCRIPT_ENTRIES = 5_000;
