/**
 * Pure scroll-position logic for the chat surface (§14). Kept DOM-free so the
 * "should we keep following the stream?" decision is unit-testable without a
 * real scroll container.
 */

/**
 * Distance from the bottom, in px, within which the chat counts as "pinned" and
 * auto-follows new/streaming messages. Generous on purpose: a browser can report
 * a fractional `scrollTop` at the true bottom, leaving a tiny positive
 * `scrollHeight - scrollTop - clientHeight` even when visually bottomed out, and
 * the threshold absorbs that rounding.
 */
export const PIN_THRESHOLD_PX = 50;

/** The scroll geometry the pin check needs — a subset of an element's metrics. */
export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/**
 * True when the container is scrolled to (or within {@link PIN_THRESHOLD_PX} of)
 * the bottom. Drives auto-follow: pinned keeps the newest turn in view; once the
 * reader scrolls up past the threshold they are freed, until they return to the
 * bottom and re-arm the follow.
 */
export function isPinnedToBottom({ scrollHeight, scrollTop, clientHeight }: ScrollMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight < PIN_THRESHOLD_PX;
}
