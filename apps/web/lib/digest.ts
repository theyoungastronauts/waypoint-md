import {
  applyReview,
  parseDocument,
  type Comment as SpecComment,
  type Item as SpecItem,
  type ItemResponse,
} from "@waypoint/spec";
import { attachmentPathsByWpId } from "./attachments-export";
import { buildReviewState } from "./review-state";
import { effectiveStatus, type EffectiveStatus } from "./review-status";
import { buildSyntheticEntries, type SyntheticEntry } from "./synthetic-export";
import type { DocumentDetail } from "./documents";

/**
 * The **digest** export (§11 output 2, SPEC §9): a compact, deterministic
 * rendering of a document's review state that an agent can act on without
 * re-reading the whole source. It is defined precisely in `docs/SPEC.md` §9
 * because agents parse it — it is a contract, not prose.
 *
 * Single source of truth. The digest describes exactly the same review state as
 * the annotated export, so it is built *from* the annotated markdown: we run the
 * splice writer, parse the result back, and render its merged items + comments.
 * This means an untouched pre-filled draft (§5.2) and a reviewer's override both
 * surface identically in the digest and the annotated file — they can never
 * disagree. Synthetic (adoptive-import) responses are not spliced (§5.7), so
 * they are collected from the DB and appended separately, mirroring the
 * annotated `## Waypoint responses` section.
 *
 * Pure function of `(detail, reviewedAt)` — no DB, no env, no `Date.now()` — so
 * the format is snapshot-testable and byte-stable for a given input.
 */
export function buildDigest(detail: DocumentDetail, reviewedAt: string): string {
  // Reuse the export's exact review state, minus the synthetic append: parsing
  // the annotated body yields the merged per-item responses and every comment.
  const review = buildReviewState(detail, reviewedAt);
  const annotated = applyReview(detail.rawMd, review);
  const parsed = parseDocument(annotated);
  const synthetic = buildSyntheticEntries(detail);

  const statuses = parsed.items.map((it) => effectiveStatus(it.response ?? null));
  const counts = tallyStatuses(statuses);
  const attachmentPaths = attachmentPathsByWpId(detail);

  const title =
    detail.title ?? asString(parsed.frontmatter.title) ?? "Untitled document";
  const project = detail.projectName ?? asString(parsed.frontmatter.project);
  const source = detail.sourcePath ?? detail.sourceUrl ?? asString(parsed.frontmatter.source);

  const frontmatter = renderFrontmatter({
    title,
    project,
    source,
    status: detail.status,
    reviewedAt,
    counts,
    total: parsed.items.length,
    commentCount: parsed.comments.length,
    syntheticCount: synthetic.length,
  });

  const sections: string[] = [`# Digest — ${oneLine(title)}`];
  const questions = renderQuestions(parsed.items, statuses, attachmentPaths);
  if (questions) sections.push(questions);
  const comments = renderComments(parsed.comments);
  if (comments) sections.push(comments);
  const structured = renderStructured(synthetic);
  if (structured) sections.push(structured);

  return `${frontmatter}\n\n${sections.join("\n\n")}\n`;
}

interface StatusCounts {
  answered: number;
  flagged: number;
  skipped: number;
  untouched: number;
}

function tallyStatuses(statuses: EffectiveStatus[]): StatusCounts {
  const counts: StatusCounts = { answered: 0, flagged: 0, skipped: 0, untouched: 0 };
  for (const s of statuses) counts[s] += 1;
  return counts;
}

interface FrontmatterInput {
  title: string;
  project: string | null | undefined;
  source: string | null | undefined;
  status: string;
  reviewedAt: string;
  counts: StatusCounts;
  total: number;
  commentCount: number;
  syntheticCount: number;
}

/** The YAML frontmatter summary — a fixed, ordered key set (SPEC §9). */
function renderFrontmatter(input: FrontmatterInput): string {
  const lines = ["---", "waypoint_digest: 1", `title: ${yamlStr(input.title)}`];
  if (input.project) lines.push(`project: ${yamlStr(input.project)}`);
  if (input.source) lines.push(`source: ${yamlStr(input.source)}`);
  lines.push(
    `status: ${yamlStr(input.status)}`,
    `reviewed_at: ${yamlStr(input.reviewedAt)}`,
    `answered: ${input.counts.answered}`,
    `flagged: ${input.counts.flagged}`,
    `skipped: ${input.counts.skipped}`,
    `untouched: ${input.counts.untouched}`,
    `total: ${input.total}`,
    `comments: ${input.commentCount}`,
    `synthetic: ${input.syntheticCount}`,
    "---",
  );
  return lines.join("\n");
}

/** `## Questions` — one entry per `wp:` item in document order. Empty → "". */
function renderQuestions(
  items: SpecItem[],
  statuses: EffectiveStatus[],
  attachmentPaths: Map<string, string[]>,
): string {
  if (items.length === 0) return "";
  const entries = items.map((item, i) => {
    const heading = `### ${item.wpId || "(no id)"} · ${typeLabel(item)} · ${statuses[i]}`;
    const lines = [heading, `**Q:** ${oneLine(stripWpMarkup(item.promptMd))}`, ...answerLines(item)];
    // Attachments are additive (B-4): the paths are listed here, not folded into
    // the answer body, so the digest's Q→A stays clean for agents to parse (§9).
    const paths = item.wpId ? attachmentPaths.get(item.wpId) : undefined;
    if (paths && paths.length > 0) lines.push(`**Attachments:** ${paths.join(", ")}`);
    return lines.join("\n");
  });
  return `## Questions\n\n${entries.join("\n\n")}`;
}

/**
 * The answer field(s) for one item: `**A:**` for text; for choice,
 * `**Selected:**`, then the author's `**Why:**` (the `wp:rationale`, SPEC 1.1.0)
 * and the reviewer's `**Note:**` (the `wp:answer` elaboration) as distinct
 * fields — the split that keeps agent rationale out of the reviewer's slot (§9.3).
 */
function answerLines(item: SpecItem): string[] {
  const response = item.response;
  if (item.type === "choice") {
    const selected = response?.selected ?? [];
    const lines = [`**Selected:** ${selected.length > 0 ? selected.join(", ") : "_(none)_"}`];
    const why = stripWpMarkup(item.rationale ?? "").trim();
    if (why) lines.push(`**Why:** ${why}`);
    const other = stripWpMarkup(response?.other ?? "").trim();
    if (other) lines.push(`**Note:** ${other}`);
    return lines;
  }
  const text = stripWpMarkup(response?.text ?? "").trim();
  return [`**A:** ${text || "_(no answer)_"}`];
}

/** `## Comments` — reviewer + source-authored comments with their quoted anchors. */
function renderComments(comments: SpecComment[]): string {
  if (comments.length === 0) return "";
  const entries = comments.map((c) => {
    const lines = [`### ${c.id || "(no id)"}`, `**Anchor:** ${quote(c.anchor.exact)}`];
    const body = c.bodyMd.trim();
    if (body) lines.push(`**Comment:** ${body}`);
    const suggestion = c.suggestionMd?.trim();
    if (suggestion) lines.push(`**Suggestion:** ${suggestion}`);
    return lines.join("\n");
  });
  return `## Comments\n\n${entries.join("\n\n")}`;
}

/**
 * `## Structured responses` — synthetic (adoptive-import) answers, numbered in
 * anchor order (§5.7). Only answered items reach here (buildSyntheticEntries
 * filters), matching the annotated append's "only when warranted" rule.
 */
function renderStructured(entries: SyntheticEntry[]): string {
  if (entries.length === 0) return "";
  const blocks = entries.map((entry, i) => {
    const status = effectiveStatus(withStatus(entry.value, entry.status));
    const lines = [
      `### ${i + 1} · ${entry.type === "choice" ? "choice" : "text"} · ${status}`,
      `**Anchor:** ${quote(entry.anchorExact)}`,
      `**Q:** ${oneLine(entry.promptMd)}`,
      ...syntheticAnswerLines(entry),
    ];
    return lines.join("\n");
  });
  return `## Structured responses\n\n${blocks.join("\n\n")}`;
}

function syntheticAnswerLines(entry: SyntheticEntry): string[] {
  if (entry.type === "choice") {
    const selected = entry.value?.selected ?? [];
    const lines = [`**Selected:** ${selected.length > 0 ? selected.join(", ") : "_(none)_"}`];
    const other = stripWpMarkup(entry.value?.other ?? "").trim();
    if (other) lines.push(`**Note:** ${other}`);
    return lines;
  }
  const text = stripWpMarkup(entry.value?.text ?? "").trim();
  return [`**A:** ${text || "_(no answer)_"}`];
}

/**
 * Defensive scrub of `wp:` structural markup that a splice may have folded into a
 * prompt or answer value (Phase 9 W1). A comment anchored *inside* a question or
 * answer block splices in right after the anchored paragraph; because the digest
 * is derived by re-parsing the annotated export, that raw `<!-- wp:comment -->`
 * block would otherwise land in the surrounding `promptMd`/answer text and
 * pollute the `**Q:**`/`**A:**` fields. The comment still surfaces intact in the
 * `## Comments` section — nothing is lost — so here we just strip the folded-in
 * markup. A normal document has no `wp:` markup in these fields, so this is a
 * no-op there; agents parsing the digest (§9) never see stray comment syntax.
 */
function stripWpMarkup(s: string): string {
  return s
    // Whole comment blocks first, including any nested suggestion + body text.
    .replace(/<!--\s*wp:comment\b[\s\S]*?<!--\s*\/wp:comment\s*-->/g, "")
    // Any residual standalone wp: open/close markers.
    .replace(/<!--\s*\/?wp:[\s\S]*?-->/g, "");
}

/** Combine a synthetic entry's value + stored status into an {@link ItemResponse}. */
function withStatus(value: SyntheticEntry["value"], status: string | null): ItemResponse | null {
  if (!value && !status) return null;
  const merged: ItemResponse = { ...(value ?? {}) };
  if (status === "answered" || status === "flagged" || status === "skipped") merged.status = status;
  return merged;
}

/** Collapse all internal whitespace to single spaces — prompts stay one line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Wrap an anchor quote in double quotes, collapsed to one line for readability. */
function quote(s: string): string {
  return `"${oneLine(s).replace(/"/g, '\\"')}"`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A YAML double-quoted scalar; newlines flattened so the value stays on one line. */
function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}

/** `text` / `choice (single)` / `choice (multi)` for the entry heading. */
function typeLabel(item: SpecItem): string {
  if (item.type !== "choice") return "text";
  return `choice (${item.select ?? "single"})`;
}
