import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceBrief } from "@/lib/voice/brief";
import { Interview, type InterviewDraft, type InterviewStore } from "@/lib/voice/interview";

const brief: VoiceBrief = {
  version: 1,
  title: "RDS plan",
  intro: "Migration plan.",
  questions: [
    {
      itemId: "i1",
      number: 1,
      type: "text",
      spoken: "How long do we stay on the big instance?",
      prompt: "Sizing: how long?",
      options: [],
      suggested: [],
      notes: [],
    },
    {
      itemId: "i2",
      number: 2,
      type: "choice",
      select: "single",
      spoken: "How should v1 handle auth?",
      prompt: "Auth model for v1:",
      options: [
        { label: "Single shared token", spoken: "one shared token" },
        { label: "Per-device tokens", spoken: "a token per device" },
        { label: "Tailscale-only, no app auth", spoken: "Tailscale only" },
      ],
      suggested: ["Tailscale-only, no app auth"],
      notes: ["Tailscale gives device identity for free."],
    },
    {
      itemId: "i3",
      number: 3,
      type: "choice",
      select: "multi",
      spoken: "Which environments go first?",
      prompt: "Which environments?",
      options: [
        { label: "staging", spoken: "staging" },
        { label: "production", spoken: "production" },
        { label: "dev", spoken: "dev" },
      ],
      suggested: ["staging", "dev"],
      notes: [],
    },
  ],
  background: [{ topic: "Cost", text: "The upgraded class costs 400 dollars a month more." }],
};

const EMPTY: InterviewDraft = { text: "", selected: [], other: "", status: null };

function makeStore(initial: Record<string, InterviewDraft> = {}) {
  const drafts: Record<string, InterviewDraft> = { ...initial };
  const store: InterviewStore & { drafts: typeof drafts } = {
    drafts,
    getDraft: (id) => drafts[id] ?? { ...EMPTY },
    writeDraft: vi.fn((id: string, d: InterviewDraft) => {
      drafts[id] = d;
    }),
    submit: vi.fn(async () => {}),
    setStyle: vi.fn(),
    endCall: vi.fn(),
  };
  return store;
}

let store: ReturnType<typeof makeStore>;
let interview: Interview;

beforeEach(() => {
  // The document pre-checks the author's suggestions, as the review page seeds them.
  store = makeStore({
    i2: { ...EMPTY, selected: ["Tailscale-only, no app auth"] },
    i3: { ...EMPTY, selected: ["staging", "dev"] },
  });
  interview = new Interview(brief, store);
});

const run = (name: string, args: unknown = {}) => interview.execute(name, JSON.stringify(args));

describe("walking the questions", () => {
  it("presents questions in order with spoken options and the author's suggestion", async () => {
    const q1 = await run("next_question");
    expect(q1).toMatchObject({ number: 1, of: 3, kind: "free text", question: "How long do we stay on the big instance?" });

    await run("record_answer", { number: 1, text: "Through end of quarter." });
    const q2 = await run("next_question");
    expect(q2).toMatchObject({
      number: 2,
      kind: "choice, pick one",
      options: [
        { number: 1, say: "one shared token" },
        { number: 2, say: "a token per device" },
        { number: 3, say: "Tailscale only" },
      ],
      author_suggestion: ["Tailscale only"],
      has_background: true,
    });
    // A pre-checked author suggestion is not presented as the reviewer's answer.
    expect(q2.current_answer).toBeUndefined();
  });

  it("does not advance until the question is answered, flagged or skipped", async () => {
    expect((await run("next_question")).number).toBe(1);
    expect((await run("next_question")).number).toBe(1);
    await run("skip_question", { number: 1 });
    expect((await run("next_question")).number).toBe(2);
  });

  it("skips questions the reviewer answered before the call", async () => {
    interview = new Interview(brief, store, ["i1"]);
    expect((await run("next_question")).number).toBe(2);
  });

  it("reports done with flagged numbers once everything is covered", async () => {
    await run("record_answer", { number: 1, text: "A quarter." });
    await run("flag_question", { number: 2 });
    await run("record_answer", { number: 3, options: [1] });
    expect(await run("next_question")).toMatchObject({ done: true, flagged: [2] });
  });

  it("go_to_question returns the question with what the reviewer recorded", async () => {
    await run("record_answer", { number: 2, options: [2], note: "Tailscale is flaky on the CI box" });
    const q = await run("go_to_question", { number: 2 });
    expect(q.current_answer).toBe("a token per device; note: Tailscale is flaky on the CI box");
  });

  it("errors on a question number that does not exist", async () => {
    expect((await run("go_to_question", { number: 9 })).error).toMatch(/run from 1 to 3/);
    expect((await run("record_answer", { number: 0, text: "x" })).error).toBeDefined();
  });
});

describe("record_answer", () => {
  it("writes a text answer with status answered", async () => {
    const res = await run("record_answer", { number: 1, text: "  Through end of quarter.  " });
    expect(res).toEqual({ ok: true, number: 1, recorded: "Through end of quarter." });
    expect(store.drafts.i1).toEqual({ text: "Through end of quarter.", selected: [], other: "", status: "answered" });
  });

  it("writes canonical labels for a choice, replacing the author's pre-check", async () => {
    const res = await run("record_answer", { number: 2, options: [2] });
    expect(res.recorded).toBe("a token per device");
    expect(store.drafts.i2.selected).toEqual(["Per-device tokens"]);
    expect(store.drafts.i2.status).toBe("answered");
  });

  it("keeps document order for a multi-select regardless of spoken order", async () => {
    await run("record_answer", { number: 3, options: [3, 1, 3] });
    expect(store.drafts.i3.selected).toEqual(["staging", "dev"]);
  });

  it("refuses two options on a single-select and writes nothing", async () => {
    const res = await run("record_answer", { number: 2, options: [1, 2] });
    expect(res.error).toMatch(/takes one option/);
    expect(res.options).toHaveLength(3);
    expect(store.writeDraft).not.toHaveBeenCalled();
  });

  it("refuses an option that does not exist", async () => {
    const res = await run("record_answer", { number: 2, options: [4] });
    expect(res.error).toMatch(/Option 4 does not exist/);
    expect(store.writeDraft).not.toHaveBeenCalled();
  });

  it("accepts a note-only answer on a choice (text-only is valid per the SPEC)", async () => {
    await run("record_answer", { number: 2, note: "Depends on the audit." });
    expect(store.drafts.i2).toMatchObject({ selected: [], other: "Depends on the audit.", status: "answered" });
  });

  it("refuses an empty answer", async () => {
    expect((await run("record_answer", { number: 1 })).error).toBeDefined();
    expect((await run("record_answer", { number: 2 })).error).toBeDefined();
  });

  it("keep_current accepts the existing content and marks it answered", async () => {
    const res = await run("record_answer", { number: 2, keep_current: true });
    expect(res.recorded).toBe("Tailscale only");
    expect(store.drafts.i2).toMatchObject({ selected: ["Tailscale-only, no app auth"], status: "answered" });
  });

  it("keep_current on an empty question is an error", async () => {
    expect((await run("record_answer", { number: 1, keep_current: true })).error).toMatch(/no answer/);
  });

  it("answering a flagged question clears the flag", async () => {
    await run("flag_question", { number: 1 });
    expect(store.drafts.i1.status).toBe("flagged");
    await run("record_answer", { number: 1, text: "Decided: a quarter." });
    expect(store.drafts.i1.status).toBe("answered");
  });
});

describe("flag and skip", () => {
  it("keep the content and set the status", async () => {
    await run("flag_question", { number: 2 });
    expect(store.drafts.i2).toEqual({ ...EMPTY, selected: ["Tailscale-only, no app auth"], status: "flagged" });
    await run("skip_question", { number: 3 });
    expect(store.drafts.i3.status).toBe("skipped");
  });
});

describe("lookup", () => {
  it("returns the question's own notes, the prompt and the suggestion", async () => {
    const res = await run("lookup", { topic: "why tailscale", number: 2 });
    expect(res.found).toEqual([
      "The question as written: Auth model for v1:",
      "The author suggested: Tailscale only.",
      "Tailscale gives device identity for free.",
    ]);
  });

  it("finds document background by keyword", async () => {
    const res = await run("lookup", { topic: "what's the cost difference" });
    expect(res.found).toEqual(["Cost: The upgraded class costs 400 dollars a month more."]);
  });

  it("says the document does not cover an unknown topic", async () => {
    const res = await run("lookup", { topic: "office snacks" });
    expect(res.found).toEqual([]);
    expect(res.message).toMatch(/does not cover/);
  });
});

describe("whats_left", () => {
  it("lists uncovered questions and flagged ones", async () => {
    await run("record_answer", { number: 1, text: "A quarter." });
    await run("flag_question", { number: 2 });
    expect(await run("whats_left")).toEqual({
      left: [{ number: 3, question: "Which environments go first?" }],
      flagged: [2],
      answered: 2,
      total: 3,
    });
  });
});

describe("read-back and submit", () => {
  it("refuses to submit before the read-back", async () => {
    const res = await run("submit_review");
    expect(res.error).toMatch(/Ask whether they'd like a read-back/);
    expect(store.submit).not.toHaveBeenCalled();
  });

  it("reads back every question, marking what the call did not touch", async () => {
    await run("record_answer", { number: 1, text: "A quarter." });
    await run("skip_question", { number: 2 });
    const res = await run("get_readback");
    expect(res.answers).toEqual([
      { number: 1, question: "How long do we stay on the big instance?", answer: "A quarter." },
      { number: 2, question: "How should v1 handle auth?", answer: "Skipped." },
      {
        number: 3,
        question: "Which environments go first?",
        answer: "Not answered in this call; it stays as the document has it: staging, dev",
      },
    ]);
  });

  it("refuses a submit in the same turn as the read-back (the reviewer has not confirmed)", async () => {
    await run("get_readback");
    const res = await run("submit_review");
    expect(res.error).toMatch(/wait for them to confirm/);
    expect(store.submit).not.toHaveBeenCalled();
  });

  it("voids the read-back when an answer changes after it", async () => {
    await run("get_readback");
    interview.noteReviewerTurn(); // "Actually, make 1 two quarters."
    await run("record_answer", { number: 1, text: "Two quarters." });
    expect((await run("submit_review")).error).toMatch(/Ask whether they'd like a read-back/);

    await run("get_readback");
    interview.noteReviewerTurn(); // "Yes, that's right."
    expect((await run("submit_review")).ok).toBe(true);
  });

  it("submits after the read-back and the reviewer's confirmation, then asks the call to end", async () => {
    await run("get_readback");
    interview.noteReviewerTurn();
    const res = await run("submit_review");
    expect(res.ok).toBe(true);
    expect(store.submit).toHaveBeenCalledTimes(1);
    expect(store.endCall).toHaveBeenCalledWith("submitted");
    expect(interview.isSubmitted).toBe(true);

    await run("submit_review");
    expect(store.submit).toHaveBeenCalledTimes(1);
  });

  it("reports a failed submit so the model can tell the reviewer, and does not end the call", async () => {
    store.submit = vi.fn(async () => {
      throw new Error("HTTP 500");
    });
    await run("get_readback");
    interview.noteReviewerTurn();
    const res = await run("submit_review");
    expect(res.error).toMatch(/Submitting failed \(HTTP 500\)/);
    expect(store.endCall).not.toHaveBeenCalled();
    expect(interview.isSubmitted).toBe(false);
  });
});

describe("other tools", () => {
  it("set_style records brief or thorough", async () => {
    expect(await run("set_style", { style: "thorough" })).toEqual({ ok: true, style: "thorough" });
    expect(store.setStyle).toHaveBeenCalledWith("thorough");
    expect((await run("set_style", { style: "chatty" })).error).toBeDefined();
  });

  it("end_call stops without submitting", async () => {
    await run("end_call");
    expect(store.endCall).toHaveBeenCalledWith("stopped");
    expect(store.submit).not.toHaveBeenCalled();
  });

  it("rejects bad JSON and unknown tools", async () => {
    expect((await interview.execute("record_answer", "{nope")).error).toMatch(/not valid JSON/);
    expect((await run("delete_everything")).error).toMatch(/no tool called/);
  });
});

describe("showQuestion", () => {
  it("is told which question is being presented", async () => {
    const showQuestion = vi.fn();
    interview = new Interview(brief, { ...store, showQuestion });
    await run("next_question");
    await run("go_to_question", { number: 3 });
    expect(showQuestion.mock.calls).toEqual([
      ["i1", 1],
      ["i3", 3],
    ]);
  });
});

describe("optional read-back", () => {
  async function coverAll() {
    await run("record_answer", { number: 1, text: "A quarter." });
    await run("record_answer", { number: 2, options: [3] });
    await run("record_answer", { number: 3, options: [1] });
    return run("next_question");
  }

  it("the wrap-up asks whether they want a read-back", async () => {
    const done = await coverAll();
    expect(done.done).toBe(true);
    expect(String(done.message)).toMatch(/whether they'd like a quick read-back/);
  });

  it("submits without a read-back once the reviewer answers the offer", async () => {
    await coverAll();
    interview.noteReviewerTurn(); // "No, just submit."
    const res = await run("submit_review", { readback_declined: true });
    expect(res.ok).toBe(true);
    expect(store.submit).toHaveBeenCalledTimes(1);
    expect(store.endCall).toHaveBeenCalledWith("submitted");
  });

  it("refuses readback_declined before the reviewer has answered the offer", async () => {
    await coverAll();
    const res = await run("submit_review", { readback_declined: true });
    expect(res.error).toMatch(/Ask whether they'd like a read-back first/);
    expect(store.submit).not.toHaveBeenCalled();
  });

  it("refuses readback_declined before every question is covered", async () => {
    await run("record_answer", { number: 1, text: "A quarter." });
    interview.noteReviewerTurn();
    const res = await run("submit_review", { readback_declined: true });
    expect(res.error).toMatch(/Not every question is covered yet/);
  });

  it("a change after the wrap-up means asking again", async () => {
    await coverAll();
    interview.noteReviewerTurn(); // "Actually, change 1."
    await run("record_answer", { number: 1, text: "Two quarters." });
    interview.noteReviewerTurn();
    expect((await run("submit_review", { readback_declined: true })).error).toMatch(/Not every question is covered yet/);

    await run("next_question"); // wrap-up again
    interview.noteReviewerTurn(); // "No read-back."
    expect((await run("submit_review", { readback_declined: true })).ok).toBe(true);
  });

  it("a plain submit with neither a read-back nor a decline is refused", async () => {
    await coverAll();
    interview.noteReviewerTurn();
    expect((await run("submit_review")).error).toMatch(/Ask whether they'd like a read-back/);
  });
});

