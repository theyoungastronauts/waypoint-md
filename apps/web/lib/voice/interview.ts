import type { VoiceBrief, VoiceBriefQuestion } from "./brief";
import type { VoiceToolName } from "./tools-spec";

/**
 * The interview executor (Waypoint Voice): runs the voice model's tool calls in
 * the browser against the review page's response store, so a spoken answer is
 * written through the same draft-save path as a tap or a keystroke and shows up
 * on the page as it happens.
 *
 * Pure apart from the {@link InterviewStore} it is handed — no DOM, no fetch —
 * so every tool's behaviour is unit-tested directly. Results are plain objects
 * the caller JSON-encodes into a `function_call_output`. Model-supplied
 * arguments are untrusted: every question number and option number is checked,
 * and a bad one returns an `error` the model is told to act on (usually: ask
 * again with the options), never a write.
 */

export type DraftStatus = "answered" | "flagged" | "skipped";

/** The draft shape the review page's response store keeps per item. */
export interface InterviewDraft {
  text: string;
  selected: string[];
  other: string;
  status: DraftStatus | null;
}

/** What the executor needs from the page. Implemented over `useResponses()`. */
export interface InterviewStore {
  getDraft(itemId: string): InterviewDraft;
  /** Persist a full draft with an explicit status (autosave + live card update). */
  writeDraft(itemId: string, draft: InterviewDraft): void;
  /** Mark the document completed — the same call as "Mark completed". */
  submit(): Promise<void>;
  setStyle(style: "brief" | "thorough"): void;
  /** Ask the call to hang up once the model's goodbye has played. */
  endCall(reason: "submitted" | "stopped"): void;
}

type Args = Record<string, unknown>;
export type ToolResult = Record<string, unknown>;

export class Interview {
  private readonly brief: VoiceBrief;
  private readonly store: InterviewStore;
  /** Items the reviewer had already answered (saved a response) before the call. */
  private readonly answeredBefore: Set<string>;
  /** Question numbers answered, flagged or skipped during this call. */
  private readonly covered = new Set<number>();
  private readbackGiven = false;
  private submitted = false;

  constructor(brief: VoiceBrief, store: InterviewStore, answeredBefore: Iterable<string> = []) {
    this.brief = brief;
    this.store = store;
    this.answeredBefore = new Set(answeredBefore);
  }

  get isSubmitted(): boolean {
    return this.submitted;
  }

  /** Run one tool call. `rawArgs` is the model's JSON argument string. */
  async execute(name: string, rawArgs: string): Promise<ToolResult> {
    let args: Args;
    try {
      const parsed: unknown = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Args) : {};
    } catch {
      return { error: "The tool arguments were not valid JSON. Try the call again." };
    }

    switch (name as VoiceToolName) {
      case "set_style":
        return this.setStyle(args);
      case "next_question":
        return this.nextQuestion();
      case "go_to_question":
        return this.withQuestion(args, (q) => this.present(q));
      case "record_answer":
        return this.withQuestion(args, (q) => this.recordAnswer(q, args));
      case "flag_question":
        return this.withQuestion(args, (q) => this.setStatus(q, "flagged"));
      case "skip_question":
        return this.withQuestion(args, (q) => this.setStatus(q, "skipped"));
      case "lookup":
        return this.lookup(args);
      case "whats_left":
        return this.whatsLeft();
      case "get_readback":
        return this.readback();
      case "submit_review":
        return this.submit();
      case "end_call":
        this.store.endCall("stopped");
        return { ok: true, message: "Say a short goodbye. The answers so far are saved as a draft." };
      default:
        return { error: `There is no tool called ${name}.` };
    }
  }

  // --- tools ---------------------------------------------------------------

  private setStyle(args: Args): ToolResult {
    const style = args.style;
    if (style !== "brief" && style !== "thorough") {
      return { error: "style must be brief or thorough. Ask the reviewer which they want." };
    }
    this.store.setStyle(style);
    return { ok: true, style };
  }

  private nextQuestion(): ToolResult {
    // Questions the reviewer answered before the call are done; the read-back
    // still covers them and go_to_question reaches them.
    const next = this.brief.questions.find((q) => !this.covered.has(q.number) && !this.answeredBefore.has(q.itemId));
    if (!next) {
      return {
        done: true,
        flagged: this.numbersWithStatus("flagged"),
        message:
          "Every question has been covered. Offer to revisit any flagged ones, then call get_readback and read it back.",
      };
    }
    return this.present(next);
  }

  private present(q: VoiceBriefQuestion): ToolResult {
    const draft = this.store.getDraft(q.itemId);
    const result: ToolResult = {
      number: q.number,
      of: this.brief.questions.length,
      kind: q.type === "text" ? "free text" : q.select === "multi" ? "choice, pick any" : "choice, pick one",
      question: q.spoken,
    };
    if (q.type === "choice") {
      result.options = q.options.map((o, i) => ({ number: i + 1, say: o.spoken }));
      if (q.suggested.length > 0) {
        result.author_suggestion = q.suggested.map((label) => this.spokenOption(q, label));
      }
    }
    if (q.notes.length > 0) result.has_background = true;

    const current = this.currentAnswer(q, draft);
    if (current) result.current_answer = current;
    return result;
  }

  private recordAnswer(q: VoiceBriefQuestion, args: Args): ToolResult {
    const draft = this.store.getDraft(q.itemId);
    const note = typeof args.note === "string" ? args.note.trim() : "";
    const text = typeof args.text === "string" ? args.text.trim() : "";

    if (args.keep_current === true) {
      if (!hasContent(draft)) {
        return { error: "There is no answer on this question to keep. Ask the reviewer for their answer." };
      }
      this.store.writeDraft(q.itemId, { ...draft, status: "answered" });
      this.covered.add(q.number);
      return { ok: true, number: q.number, recorded: this.describe(q, { ...draft, status: "answered" }) };
    }

    let next: InterviewDraft;
    if (q.type === "text") {
      const body = [text, note].filter((part) => part.length > 0).join("\n\n");
      if (!body) return { error: "No answer was given. Pass the reviewer's answer as text." };
      next = { ...draft, text: body, status: "answered" };
    } else {
      const picked = Array.isArray(args.options) ? args.options : [];
      const numbers: number[] = [];
      for (const n of picked) {
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > q.options.length) {
          return {
            error: `Option ${String(n)} does not exist. Repeat the options and ask again.`,
            options: q.options.map((o, i) => ({ number: i + 1, say: o.spoken })),
          };
        }
        if (!numbers.includes(n)) numbers.push(n);
      }
      if (q.select !== "multi" && numbers.length > 1) {
        return {
          error: "This question takes one option. Ask the reviewer to pick one.",
          options: q.options.map((o, i) => ({ number: i + 1, say: o.spoken })),
        };
      }
      if (numbers.length === 0 && !note) {
        return {
          error: "No option was chosen. Pass the option numbers, or a note if they answered without picking one.",
          options: q.options.map((o, i) => ({ number: i + 1, say: o.spoken })),
        };
      }
      // Canonical labels, in the document's option order.
      const selected = q.options
        .map((o, i) => (numbers.includes(i + 1) ? o.label : null))
        .filter((label): label is string => label !== null);
      next = { ...draft, selected, other: note, status: "answered" };
    }

    this.store.writeDraft(q.itemId, next);
    this.covered.add(q.number);
    return { ok: true, number: q.number, recorded: this.describe(q, next) };
  }

  private setStatus(q: VoiceBriefQuestion, status: "flagged" | "skipped"): ToolResult {
    const draft = this.store.getDraft(q.itemId);
    this.store.writeDraft(q.itemId, { ...draft, status });
    this.covered.add(q.number);
    return { ok: true, number: q.number, status };
  }

  private lookup(args: Args): ToolResult {
    const topic = typeof args.topic === "string" ? args.topic : "";
    const found: string[] = [];

    const q = typeof args.number === "number" ? this.question(args.number) : undefined;
    if (q) {
      found.push(`The question as written: ${q.prompt}`);
      if (q.suggested.length > 0) {
        found.push(`The author suggested: ${q.suggested.map((l) => this.spokenOption(q, l)).join(", ")}.`);
      }
      found.push(...q.notes);
    }

    const words = keywords(topic);
    const scored: Array<{ text: string; score: number }> = [];
    for (const b of this.brief.background) {
      scored.push({ text: `${b.topic}: ${b.text}`, score: overlap(words, `${b.topic} ${b.text}`) });
    }
    for (const other of this.brief.questions) {
      if (other === q) continue;
      for (const note of other.notes) scored.push({ text: note, score: overlap(words, note) });
    }
    scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .forEach((s) => found.push(s.text));

    if (found.length === 0) {
      return { found: [], message: "The document does not cover that. Say so; do not guess." };
    }
    return { found };
  }

  private whatsLeft(): ToolResult {
    const left = this.brief.questions
      .filter((q) => !this.covered.has(q.number) && !this.answeredBefore.has(q.itemId))
      .map((q) => ({ number: q.number, question: q.spoken }));
    return {
      left,
      flagged: this.numbersWithStatus("flagged"),
      answered: this.brief.questions.length - left.length,
      total: this.brief.questions.length,
    };
  }

  private readback(): ToolResult {
    this.readbackGiven = true;
    return {
      answers: this.brief.questions.map((q) => {
        const draft = this.store.getDraft(q.itemId);
        const handled = this.covered.has(q.number) || this.answeredBefore.has(q.itemId);
        return {
          number: q.number,
          question: q.spoken,
          answer: handled
            ? this.describe(q, draft)
            : hasContent(draft)
              ? `Not answered in this call; it stays as the document has it: ${this.describe(q, draft)}`
              : "Not answered.",
        };
      }),
      message: "Read these back briefly, then ask whether anything needs changing.",
    };
  }

  private async submit(): Promise<ToolResult> {
    if (!this.readbackGiven) {
      return { error: "Read back the answers first: call get_readback, read it, and get the reviewer's confirmation." };
    }
    if (this.submitted) return { ok: true, message: "Already submitted. Say goodbye." };
    try {
      await this.store.submit();
    } catch (err) {
      return {
        error: `Submitting failed (${err instanceof Error ? err.message : "unknown error"}). Tell the reviewer their answers are saved as a draft and they can submit from the page.`,
      };
    }
    this.submitted = true;
    this.store.endCall("submitted");
    return { ok: true, message: "Submitted. Say a short goodbye." };
  }

  // --- helpers -------------------------------------------------------------

  private withQuestion(args: Args, run: (q: VoiceBriefQuestion) => ToolResult): ToolResult {
    const q = typeof args.number === "number" ? this.question(args.number) : undefined;
    if (!q) {
      return { error: `There is no question ${String(args.number)}. Questions run from 1 to ${this.brief.questions.length}.` };
    }
    return run(q);
  }

  private question(n: number): VoiceBriefQuestion | undefined {
    return this.brief.questions.find((q) => q.number === n);
  }

  private numbersWithStatus(status: DraftStatus): number[] {
    return this.brief.questions.filter((q) => this.store.getDraft(q.itemId).status === status).map((q) => q.number);
  }

  private spokenOption(q: VoiceBriefQuestion, label: string): string {
    return q.options.find((o) => o.label === label)?.spoken ?? label;
  }

  /** What is on a question right now, if the reviewer (not the author) put it there. */
  private currentAnswer(q: VoiceBriefQuestion, draft: InterviewDraft): string | null {
    const reviewerOwned = this.covered.has(q.number) || this.answeredBefore.has(q.itemId);
    if (reviewerOwned && (hasContent(draft) || draft.status)) return this.describe(q, draft);
    // A pre-filled draft on a text question is the author's suggested answer.
    if (q.type === "text" && draft.text.trim()) return `The document has a pre-filled draft answer: ${draft.text.trim()}`;
    return null;
  }

  /** A spoken description of a draft, for confirmations and the read-back. */
  describe(q: VoiceBriefQuestion, draft: InterviewDraft): string {
    if (draft.status === "skipped") return "Skipped.";
    const parts: string[] = [];
    if (q.type === "text") {
      if (draft.text.trim()) parts.push(draft.text.trim());
    } else {
      if (draft.selected.length > 0) parts.push(draft.selected.map((l) => this.spokenOption(q, l)).join(", "));
      if (draft.other.trim()) parts.push(`note: ${draft.other.trim()}`);
    }
    const body = parts.length > 0 ? parts.join("; ") : "No answer";
    return draft.status === "flagged" ? `${body} (flagged to come back to)` : body;
  }
}

function hasContent(draft: InterviewDraft): boolean {
  return draft.text.trim().length > 0 || draft.selected.length > 0 || draft.other.trim().length > 0;
}

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "is", "it", "for", "what", "why", "how", "this", "that", "on", "in", "we", "you", "did", "do"]);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function overlap(words: string[], text: string): number {
  if (words.length === 0) return 0;
  const haystack = new Set(keywords(text));
  return words.filter((w) => haystack.has(w)).length;
}
