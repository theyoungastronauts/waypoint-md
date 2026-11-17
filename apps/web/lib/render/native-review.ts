import { capCommentAnchor, type CommentAnchor, type Item, type Warning } from "@waypoint/spec";
import { initialDraft, type Draft, type PersistedResponse, type ReviewItemInit } from "@/components/review/types";
import type { DocumentDetail } from "../documents";
import { buildSyntheticInits, renderReviewDocument } from "./review";

/**
 * A review document already parsed, for native clients (the Houston app): the same segment walk the
 * web review uses ({@link renderReviewDocument}), but as markdown and plain data instead of
 * sanitized HTML, so a native client renders a review without ever parsing the convention itself.
 * The server stays the only parser: a review answered natively exports exactly as one answered on
 * the web, because answers go back through the same `PUT /api/items/:id/response`.
 */

export interface NativeQuestion {
  /** The DB item id: the `PUT /api/items/:id/response` target and `itemId` in the digest. */
  itemId: string;
  wpId: string;
  type: "text" | "choice";
  select: "single" | "multi" | null;
  promptMd: string;
  /** Choice options in source order; `checked` is the pre-check in the source (the author's suggestion). */
  options: { label: string; checked: boolean }[];
  /** The author's "why this option" (choice questions, SPEC 1.1.0), read only. */
  rationaleMd: string | null;
  /** What the reviewer starts from: the saved answer, else the draft embedded in the source (web `initialDraft`). */
  draft: Draft;
  /** True when `draft` came from a saved answer rather than the source. */
  saved: boolean;
  /** A ready quote anchor on the question's first prompt line, for a comment on the whole question. */
  commentAnchor: CommentAnchor | null;
  /** Parse warnings about this question. */
  warnings: { code: string; message: string }[];
  /** Synthetic (adoptive-import) questions: the source quote they were anchored to. */
  anchorExact?: string;
}

export type NativeSegment = { kind: "prose"; markdown: string } | ({ kind: "question" } & NativeQuestion);

export interface NativeReview {
  document: {
    id: string;
    title: string | null;
    status: string;
    projectName: string | null;
    createdAt: string;
    updatedAt: string;
  };
  segments: NativeSegment[];
  /** Questions with no `wp:` block in the source (adoptive import), shown after the document. */
  structured: NativeQuestion[];
  comments: { id: string; anchor: CommentAnchor; bodyMd: string; suggestionMd: string | null; createdAt: string }[];
  warnings: { code: string; message: string }[];
}

function warningJson(w: Warning): { code: string; message: string } {
  return { code: w.code, message: w.message };
}

/** The first non-empty line of the prompt, located in the source, with up to 32 chars of context either side. */
export function questionAnchor(rawMd: string, item: Item): CommentAnchor | null {
  const start = item.spans.questionOpen.end;
  const stop =
    item.spans.rationaleOpen?.start ?? item.spans.answerOpen?.start ?? item.spans.questionClose?.start ?? item.spans.block.end;
  const prompt = rawMd.slice(start, stop);
  const line = prompt.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!line) return null;
  const exact = line.trim();
  const at = start + prompt.indexOf(exact);
  return capCommentAnchor({
    exact,
    prefix: rawMd.slice(Math.max(0, at - 32), at),
    suffix: rawMd.slice(at + exact.length, at + exact.length + 32),
  });
}

function question(init: ReviewItemInit, rawMd: string | null): NativeQuestion {
  const item = init.item;
  const persisted: PersistedResponse | null = init.persisted;
  return {
    itemId: init.itemId,
    wpId: item.wpId,
    type: item.type === "choice" ? "choice" : "text",
    select: item.type === "choice" ? (item.select ?? "single") : null,
    promptMd: item.promptMd,
    options: (item.options ?? []).map((o) => ({ label: o.label, checked: o.checked })),
    rationaleMd: item.rationale ?? null,
    draft: initialDraft(init),
    saved: persisted !== null,
    commentAnchor: rawMd === null ? null : questionAnchor(rawMd, item),
    warnings: init.warnings.map(warningJson),
    ...(init.synthetic ? { anchorExact: init.synthetic.anchorExact } : {}),
  };
}

/** A leading YAML frontmatter block, which the web's pipeline (remark-frontmatter) never renders. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function buildNativeReview(detail: DocumentDetail): NativeReview {
  const render = renderReviewDocument(detail.rawMd, detail.items);
  const segments: NativeSegment[] = [];
  for (const segment of render.segments) {
    if (segment.kind !== "prose") {
      segments.push({ kind: "question", ...question(segment, detail.rawMd) });
      continue;
    }
    const markdown = segment.sourceStart === 0 ? segment.source.replace(FRONTMATTER, "") : segment.source;
    if (markdown.trim().length > 0) segments.push({ kind: "prose", markdown });
  }
  return {
    document: {
      id: detail.id,
      title: detail.title,
      status: detail.status,
      projectName: detail.projectName,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    },
    segments,
    structured: buildSyntheticInits(detail.items).map((init) => question(init, null)),
    comments: detail.comments.map((c) => ({
      id: c.id,
      anchor: c.anchor,
      bodyMd: c.bodyMd,
      suggestionMd: c.suggestionMd,
      createdAt: c.createdAt,
    })),
    warnings: render.docWarnings.map(warningJson),
  };
}
