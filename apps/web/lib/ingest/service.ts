import {
  parseDocument,
  SPEC_MARKER,
  SPEC_VERSION,
  type Frontmatter,
  type Warning,
} from "@waypoint/spec";
import { createDocument, toPersistItems } from "../documents";

/** How the bytes arrived (§7). CLI lands in Phase 5 but the type is stable now. */
export type IngestSourceType = "cli" | "upload" | "paste" | "path" | "url";

export interface IngestInput {
  /** Exact document bytes as a string — never normalized (§6, §7). */
  raw: string;
  sourceType: IngestSourceType;
  title?: string | null;
  projectId?: string | null;
  sourcePath?: string | null;
  sourceUrl?: string | null;
  pushedFromHost?: string | null;
}

export interface IngestResult {
  id: string;
  /** Relative review URL for the new document. */
  url: string;
  title: string | null;
  warnings: Warning[];
}

/** First ATX heading text, used as a title fallback. */
function firstHeading(raw: string): string | null {
  const match = /^#{1,6}[ \t]+(.+?)[ \t]*#*\s*$/m.exec(raw);
  return match ? match[1].trim() : null;
}

function deriveTitle(
  explicit: string | null | undefined,
  frontmatter: Frontmatter,
  raw: string,
): string | null {
  const chosen = explicit?.trim();
  if (chosen) return chosen;
  if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
    return frontmatter.title.trim();
  }
  return firstHeading(raw);
}

/**
 * The one internal ingest service every door converges on (§7): parse the raw
 * bytes, derive a title, and persist the document + items. `raw_md` is stored
 * byte-for-byte; parse warnings are returned (surfaced, never fatal). New
 * documents land `pending`; supersede semantics live in {@link createDocument}.
 */
export function ingestDocument(input: IngestInput): IngestResult {
  const parsed = parseDocument(input.raw);
  const title = deriveTitle(input.title, parsed.frontmatter, input.raw);
  const specVersion = parsed.frontmatter.waypoint === SPEC_MARKER ? SPEC_VERSION : null;

  const id = createDocument({
    rawMd: input.raw,
    title,
    frontmatter: parsed.frontmatter,
    sourceType: input.sourceType,
    sourcePath: input.sourcePath ?? null,
    sourceUrl: input.sourceUrl ?? null,
    pushedFromHost: input.pushedFromHost ?? null,
    specVersion,
    projectId: input.projectId ?? null,
    items: toPersistItems(parsed.items),
  });

  return { id, url: `/d/${id}`, title, warnings: parsed.warnings };
}
