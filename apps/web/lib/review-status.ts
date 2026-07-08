import type { ResponseStatus, ResponseValue } from "@waypoint/spec";

/**
 * Pure review-status logic (§9). Shared by the client cards/right-rail and the
 * server so progress and status derivation stay identical on both sides. No DOM
 * and no DB imports live here — it is safe in a client bundle and unit-testable
 * in the node environment.
 */

/** The four item statuses the reviewer sees (§9). "untouched" = absent status. */
export type EffectiveStatus = "untouched" | "answered" | "flagged" | "skipped";

/** True when a response carries real answer content (text, selection, or elaboration). */
export function responseHasContent(value: ResponseValue | null | undefined): boolean {
  if (!value) return false;
  const hasText = typeof value.text === "string" && value.text.trim().length > 0;
  const hasSelected = Array.isArray(value.selected) && value.selected.length > 0;
  const hasOther = typeof value.other === "string" && value.other.trim().length > 0;
  return hasText || hasSelected || hasOther;
}

/**
 * The status an item displays given its current response. An explicit
 * flag/skip always wins (they are deliberate reviewer intent); otherwise any
 * real content reads as "answered", and an empty response is "untouched".
 */
export function effectiveStatus(value: ResponseValue | null | undefined): EffectiveStatus {
  if (!value) return "untouched";
  if (value.status === "flagged") return "flagged";
  if (value.status === "skipped") return "skipped";
  if (responseHasContent(value)) return "answered";
  if (value.status === "answered") return "answered";
  return "untouched";
}

/**
 * The status to persist after a content edit. Flag/skip are sticky (the
 * reviewer set them on purpose — a flagged item stays "revisit later" even once
 * a draft exists); otherwise content presence toggles answered/untouched.
 */
export function statusAfterContentChange(
  current: ResponseStatus | null | undefined,
  hasContent: boolean,
): ResponseStatus | null {
  if (current === "flagged" || current === "skipped") return current;
  return hasContent ? "answered" : null;
}

export interface Progress {
  answered: number;
  flagged: number;
  skipped: number;
  untouched: number;
  total: number;
}

/** Tally item statuses for the progress ring and completion summary (§9). */
export function computeProgress(statuses: EffectiveStatus[]): Progress {
  const progress: Progress = { answered: 0, flagged: 0, skipped: 0, untouched: 0, total: statuses.length };
  for (const status of statuses) progress[status] += 1;
  return progress;
}

/** Tailwind classes for a status dot in the right-rail nav (§9). */
export const STATUS_DOT: Record<EffectiveStatus, string> = {
  untouched: "bg-muted-foreground/40",
  answered: "bg-emerald-500",
  flagged: "bg-amber-500",
  skipped: "bg-slate-400",
};

/** Short human label for a status. */
export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  untouched: "Untouched",
  answered: "Answered",
  flagged: "Flagged",
  skipped: "Skipped",
};
