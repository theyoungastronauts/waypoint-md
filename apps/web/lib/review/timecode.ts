/**
 * Timecode rendering for media review (§ media spec Phase C, decisions C-3 and
 * C-5). One implementation, because the same string has to appear in three
 * places that must agree: the live chip on the public page, the composer's
 * "Note at 00:12.4" label, and the digest's `**Anchor:**` value — which is a
 * parsing contract (SPEC §9.4), so it is pinned here rather than formatted
 * ad hoc at each call site.
 *
 * The format is `mm:ss.d`: zero-padded minutes, zero-padded seconds, one tenth.
 * Minutes are not wrapped into hours — a 70-minute cut reads `70:04.2` rather
 * than `1:10:04.2`, which keeps the grammar a single fixed shape to parse.
 */

/** The longest timecode accepted on a comment: 24 hours, in milliseconds. */
export const MAX_TIMECODE_MS = 24 * 60 * 60 * 1000;

/** `mm:ss.d` for a millisecond offset. Out-of-range input clamps to `00:00.0`. */
export function formatTimecode(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00.0";
  // Truncate rather than round: a note taken at 12.49 s belongs to what is on
  // screen at 12.4, and rounding up could name a frame the reviewer never saw.
  const tenths = Math.floor(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor(tenths / 10) % 60;
  const tenth = tenths % 10;
  return `${pad(minutes)}:${pad(seconds)}.${tenth}`;
}

/** The anchor a digest entry carries: a timecode, or the literal `general`. */
export function anchorFor(timecodeMs: number | null): string {
  return timecodeMs === null ? "general" : formatTimecode(timecodeMs);
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Whether a value is a storable timecode: a whole, non-negative, in-range ms. */
export function isValidTimecodeMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TIMECODE_MS
  );
}
