import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceBrief } from "@/lib/voice/brief";
import type { InterviewDraft, InterviewStore } from "@/lib/voice/interview";
import {
  MAX_PIN_MISSES,
  PhoneCall,
  estimateSpeechMs,
  type OpenedReview,
  type PhoneCallDeps,
  type SidebandSocket,
} from "@/lib/voice/phone/call";
import { LOBBY_GREETING } from "@/lib/voice/phone/lobby";
import type { TranscriptEntry } from "@/lib/voice/transcript";

class FakeSocket {
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  private handlers: Record<string, Array<(arg?: unknown) => void>> = {};
  on(event: string, fn: (arg?: unknown) => void) {
    (this.handlers[event] ??= []).push(fn);
    return this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  fire(event: string, arg?: unknown) {
    for (const fn of this.handlers[event] ?? []) fn(arg);
  }
  emit(evt: Record<string, unknown>) {
    this.fire("message", JSON.stringify(evt));
  }
}

const brief: VoiceBrief = {
  version: 2,
  title: "Kitchen",
  intro: "Kitchen decisions.",
  questions: [
    {
      itemId: "i1",
      number: 1,
      type: "choice",
      select: "single",
      spoken: "Cabinets?",
      prompt: "Cabinets?",
      options: [
        { label: "Semi-custom", spoken: "semi-custom" },
        { label: "Flat-pack", spoken: "flat-pack" },
      ],
      suggested: [],
      notes: [],
    },
  ],
  background: [],
};

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { openFails?: boolean } = {}) {
  const socket = new FakeSocket();
  const drafts: Record<string, InterviewDraft> = {};
  const recorded: TranscriptEntry[] = [];
  const closed: string[] = [];
  const store: InterviewStore = {
    getDraft: (id) => drafts[id] ?? { text: "", selected: [], other: "", status: null },
    writeDraft: vi.fn((id: string, d: InterviewDraft) => {
      drafts[id] = d;
    }),
    submit: vi.fn(async () => {}),
    setStyle: vi.fn(),
    endCall: vi.fn(),
  };
  const review: OpenedReview = {
    brief,
    store,
    answeredBefore: [],
    record: (entries) => recorded.push(...entries),
    close: (status) => closed.push(status),
  };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const deps: PhoneCallDeps = {
    callId: "rtc_1",
    socket: socket as unknown as SidebandSocket,
    findByPin: vi.fn((pin: string) => (pin === "4821" ? { id: "doc-1", title: "Kitchen" } : null)),
    findLatest: vi.fn(() => ({ id: "doc-2", title: "Offsite plan" })),
    openReview: vi.fn(async () => {
      if (opts.openFails) throw new Error("brief failed");
      return review;
    }),
    hangup: vi.fn(async () => {}),
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
    now: () => "t",
    log: () => {},
  };
  const call = new PhoneCall(deps);
  /** Complete the response in flight (spoken, no tool calls). */
  const finishResponse = (transcript = "ok") => {
    socket.emit({ type: "response.output_audio_transcript.done", transcript });
    socket.emit({ type: "response.done", response: { status: "completed", output: [{ type: "message" }] } });
  };
  const toolCall = (name: string, args: unknown, id: string) =>
    socket.emit({
      type: "response.done",
      response: { status: "completed", output: [{ type: "function_call", name, call_id: id, arguments: JSON.stringify(args) }] },
    });
  const responses = () => socket.sent.filter((e) => e.type === "response.create");
  return { call, socket, deps, store, drafts, recorded, closed, timers, finishResponse, toolCall, responses };
}

describe("PhoneCall — lobby", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.socket.fire("open");
  });

  it("greets with the lobby line as soon as the sideband opens", () => {
    expect(t.responses()).toHaveLength(1);
    expect(JSON.stringify(t.responses()[0])).toContain(LOBBY_GREETING);
  });

  it("opens a review from four keypad digits, then swaps the session to its interview", async () => {
    t.finishResponse();
    for (const d of "4821") t.socket.emit({ type: "input_audio_buffer.dtmf_event_received", event: d });
    await flush();
    expect(t.deps.findByPin).toHaveBeenCalledWith("4821");
    expect(JSON.stringify(t.responses().at(-1))).toContain("Opening Kitchen. One moment.");
    expect(t.deps.openReview).toHaveBeenCalledWith("doc-1");

    // The swap waits for the "one moment" line to finish, then starts the interview.
    t.finishResponse("Opening Kitchen. One moment.");
    await flush();
    const update = t.socket.sent.find((e) => e.type === "session.update") as { session: { instructions: string; tools: Array<{ name: string }> } };
    expect(update.session.instructions).toContain('"Kitchen"');
    expect(update.session.tools.map((x) => x.name)).toContain("record_answer");
    expect(t.call.currentPhase).toBe("interview");
    expect(t.responses().at(-1)).toEqual({ type: "response.create" });
  });

  it("never sends a new response while one is playing", async () => {
    // The greeting is still playing when the digits arrive.
    for (const d of "4821") t.socket.emit({ type: "input_audio_buffer.dtmf_event_received", event: d });
    await flush();
    expect(t.responses()).toHaveLength(1);
    t.finishResponse();
    expect(t.responses()).toHaveLength(2);
  });

  it("# submits a short entry and * clears it", async () => {
    t.finishResponse();
    for (const d of ["9", "*", "4", "8", "2", "1"]) t.socket.emit({ type: "input_audio_buffer.dtmf_event_received", event: d });
    await flush();
    expect(t.deps.findByPin).toHaveBeenCalledWith("4821");

    const u = setup();
    u.socket.fire("open");
    u.finishResponse();
    for (const d of ["1", "2", "#"]) u.socket.emit({ type: "input_audio_buffer.dtmf_event_received", event: d });
    await flush();
    expect(u.deps.findByPin).toHaveBeenCalledWith("12");
  });

  it("says a wrong keypad PIN didn't match, and hangs up after three misses", async () => {
    for (let i = 0; i < MAX_PIN_MISSES; i++) {
      t.finishResponse();
      for (const d of "1111") t.socket.emit({ type: "input_audio_buffer.dtmf_event_received", event: d });
      await flush();
    }
    expect(JSON.stringify(t.responses().at(-1))).toContain("Goodbye");
    t.finishResponse("That PIN didn't match either. Goodbye.");
    expect(t.timers).toHaveLength(1);
    t.timers[0].fn();
    expect(t.deps.hangup).toHaveBeenCalled();
    expect(t.socket.closed).toBe(true);
    expect(t.deps.openReview).not.toHaveBeenCalled();
  });

  it("0 offers the latest review; a spoken yes opens it", async () => {
    t.finishResponse();
    t.socket.emit({ type: "input_audio_buffer.dtmf_event_received", event: "0" });
    await flush();
    expect(JSON.stringify(t.responses().at(-1))).toContain("Your latest review is Offsite plan");
    t.finishResponse();
    t.toolCall("open_review", { use_latest: true }, "c1");
    await flush();
    expect(t.deps.openReview).toHaveBeenCalledWith("doc-2");
  });

  it("opens a spoken PIN through the tool, and reports a miss as a tool error", async () => {
    t.finishResponse();
    t.toolCall("open_review", { pin: "1 2 3 4" }, "c1");
    await flush();
    const miss = t.socket.sent.find((e) => e.type === "conversation.item.create") as { item: { output: string } };
    expect(JSON.parse(miss.item.output).error).toMatch(/No open review has that PIN/);

    t.finishResponse();
    t.toolCall("open_review", { pin: "4821" }, "c2");
    await flush();
    expect(t.deps.openReview).toHaveBeenCalledWith("doc-1");
  });

  it("refuses open_review(use_latest) before the latest was offered", async () => {
    t.finishResponse();
    t.toolCall("open_review", { use_latest: true }, "c1");
    await flush();
    const out = t.socket.sent.find((e) => e.type === "conversation.item.create") as { item: { output: string } };
    expect(JSON.parse(out.item.output).error).toMatch(/find_latest/);
  });
});

describe("PhoneCall — interview", () => {
  async function inInterview() {
    const t = setup();
    t.socket.fire("open");
    t.finishResponse("greeting");
    t.socket.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "four eight two one" });
    for (const d of "4821") t.socket.emit({ type: "input_audio_buffer.dtmf_event_received", event: d });
    await flush();
    t.finishResponse("Opening Kitchen. One moment.");
    await flush();
    return t;
  }

  it("keeps the lobby transcript, then records the interview on the call record", async () => {
    const t = await inInterview();
    expect(t.recorded.map((e) => e.role)).toEqual(["voice", "reviewer", "voice"]);
  });

  it("runs interview tools against the store", async () => {
    const t = await inInterview();
    t.toolCall("record_answer", { number: 1, options: [2] }, "c1");
    await flush();
    expect(t.drafts.i1).toMatchObject({ selected: ["Flat-pack"], status: "answered" });
    const out = t.socket.sent.filter((e) => e.type === "conversation.item.create").at(-1) as { item: { output: string } };
    expect(JSON.parse(out.item.output).recorded).toBe("flat-pack");
  });

  it("after a confirmed read-back, submits, says goodbye, hangs up, and closes the record as submitted", async () => {
    const t = await inInterview();
    t.toolCall("get_readback", {}, "c1");
    await flush();
    t.finishResponse("Here's what I have. Anything to change?");
    t.socket.emit({ type: "input_audio_buffer.speech_started" });
    t.toolCall("submit_review", {}, "c2");
    await flush();
    expect(t.store.submit).toHaveBeenCalled();

    t.finishResponse("All set, it's submitted. Goodbye.");
    expect(t.timers.at(-1)!.ms).toBe(estimateSpeechMs("All set, it's submitted. Goodbye."));
    t.socket.emit({ type: "output_audio_buffer.stopped" });
    t.timers.at(-1)!.fn();
    await flush();
    expect(t.deps.hangup).toHaveBeenCalled();
    expect(t.closed).toEqual(["submitted"]);
  });

  it("closes the record as ended when the sideband drops mid-review, and makes sure the line is hung up", async () => {
    const t = await inInterview();
    t.socket.fire("close");
    await flush();
    expect(t.closed).toEqual(["ended"]);
    expect(t.deps.hangup).toHaveBeenCalledTimes(1);
  });

  it("does not hang up twice after its own goodbye", async () => {
    const t = await inInterview();
    t.toolCall("end_call", {}, "c1");
    await flush();
    t.finishResponse("Saved as a draft. Bye.");
    t.timers.at(-1)!.fn();
    t.socket.fire("close");
    await flush();
    expect(t.deps.hangup).toHaveBeenCalledTimes(1);
    expect(t.closed).toEqual(["ended"]);
  });
});

describe("PhoneCall — failures", () => {
  it("apologizes and hangs up when the review can't be prepared", async () => {
    const t = setup({ openFails: true });
    t.socket.fire("open");
    t.finishResponse();
    for (const d of "4821") t.socket.emit({ type: "input_audio_buffer.dtmf_event_received", event: d });
    await flush();
    t.finishResponse();
    await flush();
    expect(JSON.stringify(t.responses().at(-1))).toContain("couldn't get that review ready");
    t.finishResponse("Sorry… Goodbye.");
    t.timers.at(-1)!.fn();
    expect(t.deps.hangup).toHaveBeenCalled();
  });

  it("ignores cancelled responses and unfinished calls", async () => {
    const t = setup();
    t.socket.fire("open");
    t.socket.emit({
      type: "response.done",
      response: { status: "cancelled", output: [{ type: "function_call", name: "open_review", call_id: "c1", arguments: '{"pin":"4821"}' }] },
    });
    await flush();
    expect(t.deps.openReview).not.toHaveBeenCalled();
  });
});
