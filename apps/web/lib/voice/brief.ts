import { createHash } from "node:crypto";
import { parseDocument, type ChoiceSelect, type ItemType } from "@waypoint/spec";
import { z } from "zod";
import type { DocumentDetail } from "@/lib/documents";

/**
 * The voice brief (Waypoint Voice): a version of a review document meant to be
 * heard. Claude writes the spoken parts once per document version; the voice
 * model reads from it during the call.
 *
 * The trust boundary is the same as adoptive import's: model output is untrusted.
 * Claude is never asked for ids or option labels. The skeleton — which questions
 * exist, their item ids, their canonical option labels — is built here from the
 * database, and Claude only supplies spoken wording keyed by question number and
 * option position. Anything missing or malformed falls back to the document's
 * own text, so a bad model response degrades the wording, never the answers.
 *
 * This module is pure (no DB, network or env); persistence and the Anthropic
 * call live in `briefs.ts` and the route.
 */

/** Bumped whenever the brief's shape or prompt changes, so cached briefs regenerate. */
export const BRIEF_FORMAT_VERSION = 2;

/** Ceiling on the document text handed to Claude alongside the questions. */
export const BRIEF_SOURCE_CAP = 60_000;

const SPOKEN_MAX = 1_200;
const NOTE_MAX = 1_500;
const MAX_NOTES_PER_QUESTION = 8;
const MAX_BACKGROUND = 20;

/** One question as the database and source describe it, before any rewriting. */
export interface BriefSourceQuestion {
  itemId: string;
  /** 1-based position in review order (convention items, then synthetic ones). */
  number: number;
  wpId: string | null;
  type: ItemType;
  select?: ChoiceSelect;
  promptMd: string;
  /** Canonical labels, with the author's pre-checked suggestion marked. */
  options: Array<{ label: string; suggested: boolean }>;
  /** The author's `wp:rationale`, when the question has one. */
  rationale?: string;
  /** For a synthetic (adoptive-import) item: the source quote it was anchored to. */
  anchorQuote?: string;
}

export interface BriefSource {
  title: string;
  rawMd: string;
  questions: BriefSourceQuestion[];
}

export interface VoiceBriefOption {
  /** The canonical label — the value written into the draft. */
  label: string;
  /** How the option is said out loud. */
  spoken: string;
}

export interface VoiceBriefQuestion {
  itemId: string;
  number: number;
  type: ItemType;
  select?: ChoiceSelect;
  /** The question rewritten to work out loud. */
  spoken: string;
  /** The original prompt as plain text, for "what does it actually say?". */
  prompt: string;
  options: VoiceBriefOption[];
  /** Canonical labels the author pre-checked as a suggestion. */
  suggested: string[];
  /** Background the voice model can look up for this question. */
  notes: string[];
}

export interface VoiceBrief {
  version: number;
  title: string;
  /** A short spoken overview of what the document is about. */
  intro: string;
  questions: VoiceBriefQuestion[];
  /** Document-level background notes, looked up by topic. */
  background: Array<{ topic: string; text: string }>;
}

/**
 * Build the brief's skeleton from a document: questions in the order the review
 * page shows them (convention items, then synthetic ones), with each choice
 * question's rationale taken from the parsed source.
 */
export function buildBriefSource(detail: DocumentDetail): BriefSource {
  const parsed = parseDocument(detail.rawMd);
  const rationaleByWpId = new Map<string, string>();
  for (const item of parsed.items) {
    if (item.rationale) rationaleByWpId.set(item.wpId, item.rationale);
  }

  const ordered = [
    ...detail.items.filter((it) => !it.synthetic).sort((a, b) => a.orderIndex - b.orderIndex),
    ...detail.items.filter((it) => it.synthetic).sort((a, b) => a.orderIndex - b.orderIndex),
  ];

  const questions = ordered.map((it, index): BriefSourceQuestion => {
    const type: ItemType = it.type === "choice" ? "choice" : "text";
    const question: BriefSourceQuestion = {
      itemId: it.id,
      number: index + 1,
      wpId: it.wpId,
      type,
      promptMd: it.promptMd ?? "",
      options:
        type === "choice"
          ? (it.config?.options ?? []).map((o) => ({ label: o.label, suggested: o.checked === true }))
          : [],
    };
    if (type === "choice") question.select = it.config?.select ?? "single";
    const rationale = it.wpId ? rationaleByWpId.get(it.wpId) : undefined;
    if (rationale) question.rationale = rationale;
    if (it.synthetic && it.anchor?.exact) question.anchorQuote = it.anchor.exact;
    return question;
  });

  return { title: detail.title ?? "Untitled document", rawMd: detail.rawMd, questions };
}

/**
 * The cache key for a brief: the source bytes, the question skeleton (adoptive
 * import can add items to an existing document) and the format version.
 */
export function briefCacheKey(source: BriefSource): string {
  const hash = createHash("sha256");
  hash.update(`v${BRIEF_FORMAT_VERSION}\n`);
  hash.update(source.rawMd);
  hash.update("\n");
  hash.update(
    JSON.stringify(
      source.questions.map((q) => [q.itemId, q.type, q.select ?? null, q.promptMd, q.options]),
    ),
  );
  return hash.digest("hex");
}

/** The role instruction for the brief pass. JSON out, wording only. */
export const BRIEF_SYSTEM_PROMPT = [
  "You prepare Waypoint review documents to be answered by voice. A separate, fast voice",
  "model will interview the reviewer: read each question aloud, offer the options, take",
  "the answer. It does not reason about the decisions, so everything it needs to sound",
  "natural and to answer background questions must come from you.",
  "",
  "For the document and numbered questions you are given, write:",
  "- `intro`: two or three spoken sentences on what the document is and what is being decided.",
  "- For every question, keyed by its `number`:",
  "  - `spoken`: the question rewritten to work out loud. Short sentences, no markdown, no",
  "    bullet lists, no URLs or code read character by character. Keep its meaning exactly.",
  "  - `options` (choice questions only): one short spoken phrase per option, in the SAME",
  "    order and the SAME count as given. Short enough to hold in your head after hearing",
  "    them once, but distinct from each other. Do not mark or mention the author's",
  "    suggestion in these phrases; it is reported to the voice model separately.",
  "  - `notes`: background the reviewer might ask about (\"why did you suggest that?\",",
  "    \"what's the cost difference?\"), drawn ONLY from the document. Include the author's",
  "    rationale when there is one. Spoken style. Empty list if there is nothing useful.",
  "- `background`: document-level notes by topic (context, constraints, numbers, names) the",
  "  reviewer might ask about mid-call. Only facts stated in the document.",
  "",
  "Never invent facts, options or recommendations that are not in the document.",
  "",
  "Respond with ONLY a JSON object, no prose and no code fence, of the form:",
  '{"intro":"…","questions":[{"number":1,"spoken":"…","options":["…","…"],"notes":["…"]}],',
  '"background":[{"topic":"…","text":"…"}]}',
].join("\n");

/** Build the user turn: the numbered questions, then the (capped) document. */
export function buildBriefUserPrompt(source: BriefSource): string {
  const questions = source.questions.map((q) => {
    const lines = [`Question ${q.number} (${q.type === "choice" ? `choice, ${q.select}` : "free text"}):`];
    lines.push(q.promptMd.trim());
    if (q.anchorQuote) lines.push(`It refers to this passage: "${q.anchorQuote}"`);
    q.options.forEach((o, i) => {
      lines.push(`  Option ${i + 1}: ${o.label}${o.suggested ? "  [the author's suggestion]" : ""}`);
    });
    if (q.rationale) lines.push(`Author's rationale: ${q.rationale.trim()}`);
    return lines.join("\n");
  });

  const doc =
    source.rawMd.length > BRIEF_SOURCE_CAP
      ? `${source.rawMd.slice(0, BRIEF_SOURCE_CAP)}\n\n[document truncated for length]`
      : source.rawMd;

  return [
    `Document title: ${source.title}`,
    "",
    "Questions:",
    "",
    questions.join("\n\n"),
    "",
    "Full document:",
    "---",
    doc,
    "---",
  ].join("\n");
}

const spokenString = z.string().trim().min(1);

/** The model's response envelope. Lenient on extras, strict on types. */
export const briefOutputSchema = z.object({
  intro: z.string().trim().optional(),
  questions: z
    .array(
      z.object({
        number: z.number().int(),
        spoken: spokenString.optional(),
        options: z.array(z.string()).optional(),
        notes: z.array(z.string()).optional(),
      }),
    )
    .max(500)
    .optional(),
  background: z
    .array(z.object({ topic: spokenString, text: spokenString }))
    .optional(),
});

export type BriefOutput = z.infer<typeof briefOutputSchema>;

/**
 * Merge Claude's wording onto the skeleton. Every source question appears
 * exactly once, in order, with its own item id and canonical labels. Spoken
 * wording is used only when it is present and well-formed — option phrases only
 * when there is exactly one per option — and the document's own text fills in
 * everything else.
 */
export function assembleBrief(source: BriefSource, output: BriefOutput): VoiceBrief {
  const byNumber = new Map<number, NonNullable<BriefOutput["questions"]>[number]>();
  for (const q of output.questions ?? []) {
    if (!byNumber.has(q.number)) byNumber.set(q.number, q);
  }

  const questions = source.questions.map((src): VoiceBriefQuestion => {
    const written = byNumber.get(src.number);
    const prompt = plainText(src.promptMd);

    const spokenOptions = written?.options?.map((o) => o.trim());
    const optionsUsable =
      spokenOptions !== undefined &&
      spokenOptions.length === src.options.length &&
      spokenOptions.every((o) => o.length > 0);

    const notes = (written?.notes ?? [])
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
      .slice(0, MAX_NOTES_PER_QUESTION)
      .map((n) => clip(n, NOTE_MAX));
    if (notes.length === 0 && src.rationale) notes.push(clip(plainText(src.rationale), NOTE_MAX));

    const question: VoiceBriefQuestion = {
      itemId: src.itemId,
      number: src.number,
      type: src.type,
      spoken: clip(written?.spoken?.trim() || prompt || `Question ${src.number}`, SPOKEN_MAX),
      prompt,
      options: src.options.map((o, i) => ({
        label: o.label,
        spoken: clip(optionsUsable ? spokenOptions[i] : plainText(o.label), SPOKEN_MAX),
      })),
      suggested: src.options.filter((o) => o.suggested).map((o) => o.label),
      notes,
    };
    if (src.select) question.select = src.select;
    return question;
  });

  return {
    version: BRIEF_FORMAT_VERSION,
    title: source.title,
    intro: clip(output.intro?.trim() || `This is the review for ${source.title}.`, SPOKEN_MAX),
    questions,
    background: (output.background ?? [])
      .slice(0, MAX_BACKGROUND)
      .map((b) => ({ topic: clip(b.topic, 200), text: clip(b.text, NOTE_MAX) })),
  };
}

/** Light markdown → plain text, for fallbacks and the read-aloud prompt. */
export function plainText(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
