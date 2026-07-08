import { getSetting } from "@/lib/settings";

/**
 * The single source of truth for the sidebar's Claude model IDs (§14, ratified
 * "Sidebar-model" decision). A correction to any of these is a one-line change
 * here — nothing else hardcodes a model string.
 *
 * IDs verified against the live Anthropic docs during Phase 7 on 2026-07-08:
 * https://platform.claude.com/docs/en/about-claude/models/overview
 *   - latest Sonnet → claude-sonnet-5   (Claude Sonnet 5)
 *   - latest Opus   → claude-opus-4-8   (Claude Opus 4.8)
 *   - latest Fable  → claude-fable-5    (Claude Fable 5)
 * The plan's examples are illustrative only; these strings are the verified ones.
 */
export const MODELS = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-4-8",
  fable: "claude-fable-5",
} as const;

/** The ratified default when nothing overrides it: latest Sonnet (§14). */
export const DEFAULT_MODEL: string = MODELS.sonnet;

/** The settings-table key holding the chosen model (§6 settings table). */
export const MODEL_SETTING_KEY = "model";

/** A selectable model in `/settings`, in display order. */
export interface ModelChoice {
  id: string;
  label: string;
  family: "Sonnet" | "Opus" | "Fable";
  blurb: string;
}

/**
 * The runtime-switchable set (§14): latest Sonnet, Opus, and Fable. Sonnet leads
 * as the default — the balanced speed/cost pick for a document-scoped sidebar.
 */
export const MODEL_CHOICES: ModelChoice[] = [
  {
    id: MODELS.sonnet,
    label: "Claude Sonnet 5",
    family: "Sonnet",
    blurb: "Balanced speed and intelligence. The default.",
  },
  {
    id: MODELS.opus,
    label: "Claude Opus 4.8",
    family: "Opus",
    blurb: "Deeper reasoning for harder documents.",
  },
  {
    id: MODELS.fable,
    label: "Claude Fable 5",
    family: "Fable",
    blurb: "Anthropic's most capable model; highest cost.",
  },
];

const KNOWN = new Set<string>(MODEL_CHOICES.map((c) => c.id));

/** Whether `id` is one of the three ratified, offerable models. */
export function isKnownModel(id: string | null | undefined): id is string {
  return typeof id === "string" && KNOWN.has(id);
}

/** Where a resolved model came from — surfaced in `/settings` for transparency. */
export type ModelSource = "settings" | "env" | "default";

export interface ResolvedModel {
  model: string;
  source: ModelSource;
}

/**
 * Resolve the active sidebar model with the ratified precedence (§14):
 * settings-table value **wins** over the `WAYPOINT_MODEL` env default, which
 * wins over the built-in default. A settings value is honored only if it is a
 * known choice (guards against a stale/hand-edited row); the env default is
 * trusted as an operator-set string so a newer model can be pinned without a
 * code change.
 */
export function resolveModelDetail(): ResolvedModel {
  const fromSettings = getSetting(MODEL_SETTING_KEY);
  if (isKnownModel(fromSettings)) return { model: fromSettings, source: "settings" };

  const fromEnv = process.env.WAYPOINT_MODEL?.trim();
  if (fromEnv) return { model: fromEnv, source: "env" };

  return { model: DEFAULT_MODEL, source: "default" };
}

/** The active sidebar model id (§14). */
export function resolveModel(): string {
  return resolveModelDetail().model;
}
