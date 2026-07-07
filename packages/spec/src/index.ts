/**
 * @waypoint/spec — the Waypoint review convention (SPEC v1).
 *
 * Phase 1 scaffold only: this file exports the spec version and placeholder
 * types so the app and CLI can wire against a stable module. The real parser,
 * splice writer, and golden fixtures land in Phase 2.
 */

/** Semver of the review convention. `docs/SPEC.md` is the public contract (§4). */
export const SPEC_VERSION = "1.0.0";

/** Frontmatter opt-in marker value (`waypoint: 1` in §5.1). */
export const SPEC_MARKER = 1;

/** Document frontmatter (§5.1). */
export interface Frontmatter {
  waypoint?: number;
  title?: string;
  project?: string;
  source?: string;
  [key: string]: unknown;
}

/** Question kind (§5.2 / §5.3). */
export type ItemType = "text" | "choice";

/** Selection cardinality for choice questions (§5.3). */
export type ChoiceSelect = "single" | "multi";

/** Per-item response status (§5.5). Absent = untouched. */
export type ResponseStatus = "answered" | "flagged" | "skipped";

/**
 * Placeholder shapes — intentionally minimal in Phase 1. Phase 2 replaces these
 * with the full definitions (spans, anchors, warnings, etc.) from types.ts.
 */
export interface Item {
  wpId: string;
  type: ItemType;
}

export interface Comment {
  id: string;
}

export interface Warning {
  message: string;
}

export interface ReviewState {
  responses?: Record<string, unknown>;
  comments?: Comment[];
}
