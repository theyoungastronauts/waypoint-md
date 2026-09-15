import type { MediaPublicationDetail } from "./publications";
import type { MediaCommentView } from "./review/comments";
import { formatRegion } from "./review/region";
import { anchorFor } from "./review/timecode";

/**
 * The **media digest** (SPEC §9.4, decision C-5): the same contract the document
 * digest satisfies (§9), for a render instead of a review doc. An agent pulls it
 * after a reviewer has been through the cut and acts on it without opening the
 * video — each entry says when in the cut the note applies, optionally where in
 * the frame, who made it, and what they said.
 *
 * Pure function of `(publication, comments, reviewedAt, options)` — no DB, no
 * env, no `Date.now()` — so the format is snapshot-testable and byte-stable for
 * a given input, exactly as `buildDigest` is.
 */

export interface MediaDigestOptions {
  /** Include notes that have been resolved; by default only open ones render. */
  includeResolved?: boolean;
}

/**
 * Render the digest. `comments` is every comment on the publication **in digest
 * order with its ordinals already assigned** (`toCommentViews` does both), so
 * the `c<n>` an agent resolves against means the same thing here and in
 * `GET /api/publications/:id/comments`. Filtering happens after numbering: a
 * digest of open notes can therefore skip numbers, and a note keeps its number
 * while the ones before it in the cut are being resolved.
 */
export function buildMediaDigest(
  publication: MediaPublicationDetail,
  comments: MediaCommentView[],
  reviewedAt: string,
  options: MediaDigestOptions = {},
): string {
  const rendered = options.includeResolved ? comments : comments.filter((c) => !c.resolved);
  const unresolved = comments.filter((c) => !c.resolved).length;

  const frontmatter = renderFrontmatter({
    title: publication.title,
    group: publication.group,
    label: publication.label,
    source: publication.urls.file,
    status: publication.revoked ? "revoked" : "published",
    reviewedAt,
    commentCount: rendered.length,
    unresolved,
  });

  const sections = [`# Digest — ${oneLine(publication.title)}`];
  const body = renderComments(rendered);
  if (body) sections.push(body);

  return `${frontmatter}\n\n${sections.join("\n\n")}\n`;
}

interface FrontmatterInput {
  title: string;
  group: string | null;
  label: string | null;
  source: string;
  status: string;
  reviewedAt: string;
  commentCount: number;
  unresolved: number;
}

/** Fixed, ordered key set (SPEC §9.4). `group` and `label` appear when known. */
function renderFrontmatter(input: FrontmatterInput): string {
  const lines = ["---", "waypoint_digest: 1", "kind: media", `title: ${yamlStr(input.title)}`];
  if (input.group) lines.push(`group: ${yamlStr(input.group)}`);
  if (input.label) lines.push(`label: ${yamlStr(input.label)}`);
  lines.push(
    `source: ${yamlStr(input.source)}`,
    `status: ${yamlStr(input.status)}`,
    `reviewed_at: ${yamlStr(input.reviewedAt)}`,
    `comments: ${input.commentCount}`,
    `unresolved: ${input.unresolved}`,
    "---",
  );
  return lines.join("\n");
}

/** `## Comments` — one entry per rendered note. Empty → "" (the section is omitted). */
function renderComments(comments: MediaCommentView[]): string {
  if (comments.length === 0) return "";
  const entries = comments.map((comment) => {
    const lines = [`### c${comment.ordinal}`, `**Anchor:** "${anchorFor(comment.timecodeMs)}"`];
    if (comment.region) lines.push(`**Region:** ${formatRegion(comment.region)}`);
    lines.push(`**By:** ${oneLine(comment.authorName)}`);
    lines.push(`**Comment:** ${escapeFieldLabels(comment.body.trim())}`);
    return lines.join("\n");
  });
  return `## Comments\n\n${entries.join("\n\n")}`;
}

/**
 * Neutralize field-label injection in a comment body. Bodies on a media
 * publication are typed by whoever holds a review link, and §9.3's value-span
 * rule makes **any** line starting with a `**Label:**` token a field boundary —
 * so a body containing a line `**By:** someone else` would otherwise forge a
 * field in the digest an agent parses.
 *
 * The fix is a leading backslash on such a line: markdown renders `\**By:**` as
 * the literal text `**By:**`, so the reviewer's words are unchanged on screen,
 * while the line no longer *begins* with a label token and so no longer ends the
 * `**Comment:**` value.
 */
export function escapeFieldLabels(body: string): string {
  return body
    .split("\n")
    .map((line) => (/^\*\*[A-Za-z][A-Za-z ]*:\*\*/.test(line) ? `\\${line}` : line))
    .join("\n");
}

/** Collapse all internal whitespace to single spaces — single-line fields stay so. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** A YAML double-quoted scalar; newlines flattened so the value stays on one line. */
function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}
