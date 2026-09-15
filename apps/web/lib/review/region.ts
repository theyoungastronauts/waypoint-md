/**
 * Region marks (§ media spec Q8, decision C-3): the box a reviewer drags over a
 * paused frame to say *this* part of the frame, not the whole of it.
 *
 * A region is stored as four fractions of the **media box** — `{ x, y, w, h }`
 * in 0–1 — never as pixels. A phone drawing on a 390 px-wide player and a
 * desktop redrawing it at 1280 px have to agree about which part of the frame
 * was marked, and the only coordinate space both share is the frame itself.
 *
 * Everything here is pure geometry, free of React and the DOM, so the drag math
 * and the visibility rule are unit-testable without a player.
 */

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point inside the media box, in the same 0–1 fractions a region uses. */
export interface FractionPoint {
  x: number;
  y: number;
}

/** The rectangle a drag is measured against (what `getBoundingClientRect` gives). */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Smallest box that counts as a mark, as a fraction of each axis. A tap that
 * moves two pixels is a tap, not a drag — without a floor, every tap on the
 * overlay would store a degenerate zero-area region.
 */
export const MIN_REGION_SIZE = 0.02;

/** Fractions are stored to this many decimals — plenty for a frame, and stable. */
const PRECISION = 4;

/** Convert a client-space point to fractions of the media box, clamped to it. */
export function pointInBox(clientX: number, clientY: number, box: Box): FractionPoint {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((clientX - box.left) / box.width),
    y: clamp01((clientY - box.top) / box.height),
  };
}

/**
 * The region two drag corners describe. Direction-agnostic: dragging up-left
 * produces the same box as dragging down-right across the same two points.
 * Returns null when the drag is smaller than {@link MIN_REGION_SIZE} on either
 * axis — the caller treats that as "no region", not as an error.
 */
export function regionFromDrag(start: FractionPoint, end: FractionPoint): Region | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  if (w < MIN_REGION_SIZE || h < MIN_REGION_SIZE) return null;
  return roundRegion({ x, y, w, h });
}

/**
 * Accept a region from the wire. Every field must be a finite number, the box
 * must sit inside the frame, and it must have real area — a region is a
 * capability-free piece of geometry, but it is still reviewer input, and the
 * renderer should never be handed a box it has to guess about.
 */
export function parseRegion(value: unknown): Region | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const x = finite(record.x);
  const y = finite(record.y);
  const w = finite(record.w);
  const h = finite(record.h);
  if (x === null || y === null || w === null || h === null) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
  // A hair over 1 is float drift from a drag to the very edge, not a bad box.
  if (x + w > 1.0001 || y + h > 1.0001) return null;
  return roundRegion({ x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) });
}

/** CSS percentages for rendering a stored region over the media box. */
export function regionStyle(region: Region): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${pct(region.x)}%`,
    top: `${pct(region.y)}%`,
    width: `${pct(region.w)}%`,
    height: `${pct(region.h)}%`,
  };
}

/** How close the playhead must be to a comment's timecode to show its mark. */
export const REGION_VISIBLE_WINDOW_MS = 500;

/**
 * Whether a comment's region mark should be drawn right now (decision C-3): the
 * comment is selected (the reviewer tapped it), or the playhead is within half a
 * second of its timecode. A general note's region — a mark with no timecode —
 * shows only while selected, since there is no moment it belongs to.
 */
export function isRegionVisible(input: {
  commentId: string;
  timecodeMs: number | null;
  selectedId: string | null;
  currentMs: number;
}): boolean {
  if (input.selectedId === input.commentId) return true;
  if (input.timecodeMs === null) return false;
  return Math.abs(input.currentMs - input.timecodeMs) <= REGION_VISIBLE_WINDOW_MS;
}

/** The digest's `**Region:**` value: four fractions to three decimals (C-5). */
export function formatRegion(region: Region): string {
  return [region.x, region.y, region.w, region.h].map((n) => n.toFixed(3)).join(",");
}

function roundRegion(region: Region): Region {
  return {
    x: round(region.x),
    y: round(region.y),
    w: round(region.w),
    h: round(region.h),
  };
}

function round(value: number): number {
  const factor = 10 ** PRECISION;
  return Math.round(value * factor) / factor;
}

function pct(value: number): number {
  return round(value * 100);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
