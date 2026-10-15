import type { VoiceBrief } from "../brief";
import { Interview, type InterviewStore } from "../interview";
import { buildInstructions } from "../realtime";
import type { TranscriptEntry } from "../transcript";
import { VOICE_TOOLS } from "../tools-spec";
import { LOBBY_GREETING } from "./lobby";

/**
 * One phone call (Waypoint Voice, phone), driven from the server over the
 * Realtime sideband WebSocket. There is no browser in a phone call, so this is
 * the server's counterpart of the browser's `RealtimeCall` + `VoiceCall`: it
 * runs the lobby (keypad or spoken PIN, the "latest" shortcut, three misses and
 * out), then swaps the session to the chosen review's interview and runs the
 * same {@link Interview} executor against the database.
 *
 * Everything external is injected ({@link PhoneCallDeps}) so the whole flow is
 * tested with a fake socket. Events used (developers.openai.com, checked
 * 2026-10-15): `input_audio_buffer.dtmf_event_received` (SIP only),
 * `input_audio_buffer.speech_started`, `conversation.item.input_audio_transcription.completed`,
 * `response.output_audio_transcript.done`, `response.created` / `response.done`,
 * `output_audio_buffer.stopped`.
 */

/** The parts of a WebSocket the call uses (`ws` in production, a fake in tests). */
export interface SidebandSocket {
  send(data: string): void;
  close(): void;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
}

export interface OpenedReview {
  brief: VoiceBrief;
  store: InterviewStore;
  /** Items answered or skipped before the call; the interview moves past them. */
  answeredBefore: string[];
  /** Append transcript entries to the call's `voice_sessions` record. */
  record(entries: TranscriptEntry[]): void;
  /** Close the record: submitted only if the review was really submitted. */
  close(status: "ended" | "submitted"): void;
}

export interface PhoneCallDeps {
  callId: string;
  /** The sideband socket, already constructed for this call. */
  socket: SidebandSocket;
  findByPin(pin: string): { id: string; title: string | null } | null;
  findLatest(): { id: string; title: string | null } | null;
  /** Prepare the review for voice: brief (made or cached), drafts, call record. */
  openReview(documentId: string): Promise<OpenedReview>;
  /** End the call for good (`POST /v1/realtime/calls/{id}/hangup`). */
  hangup(): Promise<void>;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): string;
  log(message: string): void;
}

export const MAX_PIN_MISSES = 3;
/** After the goodbye, hang up this long after playback stops… */
const GOODBYE_TAIL_MS = 600;
/** …or, if playback never reports stopping, after an estimate of the goodbye's length. */
const MIN_GOODBYE_MS = 3_000;
const MAX_GOODBYE_MS = 20_000;
/** Once a call is ending, hang up after this long no matter what the model does. */
export const HARD_STOP_MS = 30_000;

type Phase = "lobby" | "opening" | "interview" | "ending" | "ended";

interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

interface FunctionCallItem {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
  status?: string;
}

export class PhoneCall {
  private readonly deps: PhoneCallDeps;
  private phase: Phase = "lobby";
  private digits = "";
  private misses = 0;
  private latestOffered: { id: string; title: string | null } | null = null;
  private review: OpenedReview | null = null;
  private interview: Interview | null = null;
  /** Lobby transcript, kept until a review (and its call record) exists. */
  private pending: TranscriptEntry[] = [];
  /** A response is in progress on OpenAI's side (ours or one voice detection started). */
  private responseActive = false;
  /** The response we asked for and haven't seen created yet (re-sent if it was refused). */
  private awaitingCreated: Record<string, unknown> | null = null;
  private queuedResponse: Record<string, unknown> | null = null;
  private pendingEnd: "submitted" | "stopped" | null = null;
  /**
   * The goodbye is the first finished, tool-free response created after the call
   * started ending — never an earlier one still playing. Responses are numbered
   * as they are created to tell them apart.
   */
  private createdCount = 0;
  private readonly responseSeq = new Map<string, number>();
  private endFromSeq = Number.POSITIVE_INFINITY;
  private goodbyeResponseId: string | null = null;
  private goodbyeTimer: unknown = null;
  private hardStopTimer: unknown = null;
  private readonly transcriptByResponse = new Map<string, string>();
  /** Three wrong PINs: no more tries on this call. */
  private locked = false;
  private readonly handledCalls = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(deps: PhoneCallDeps) {
    this.deps = deps;
    deps.socket.on("open", () => this.say(LOBBY_GREETING));
    deps.socket.on("message", (data) => this.onMessage(data));
    deps.socket.on("close", () => {
      // The sideband is gone: nothing can save answers any more, so make sure the
      // phone line doesn't stay open in silence. If the caller already hung up,
      // this fails harmlessly.
      if (this.phase !== "ended") this.hangupQuietly();
      this.finish("sideband closed");
    });
    deps.socket.on("error", (err) => this.deps.log(`[phone] ${deps.callId} sideband error: ${err.message}`));
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  // --- events --------------------------------------------------------------

  private onMessage(data: unknown): void {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(String(data)) as RealtimeEvent;
    } catch {
      return;
    }
    switch (event.type) {
      case "input_audio_buffer.dtmf_event_received":
        if (typeof event.event === "string") this.enqueue(() => this.onDigit(event.event as string));
        break;
      case "input_audio_buffer.speech_started":
        this.enqueue(() => this.interview?.noteReviewerTurn());
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
        if (text) {
          this.enqueue(() => this.interview?.noteReviewerTurn());
          this.addTranscript({ role: "reviewer", at: this.deps.now(), text });
        }
        break;
      }
      case "response.output_audio_transcript.done": {
        const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
        if (text) {
          if (typeof event.response_id === "string") this.transcriptByResponse.set(event.response_id, text);
          this.addTranscript({ role: "voice", at: this.deps.now(), text });
        }
        break;
      }
      case "response.created": {
        this.responseActive = true;
        this.awaitingCreated = null;
        const id = (event.response as { id?: unknown } | undefined)?.id;
        this.createdCount += 1;
        if (typeof id === "string") this.responseSeq.set(id, this.createdCount);
        break;
      }
      case "response.done":
        this.responseActive = false;
        // With tool calls, the reply to their results comes first; anything
        // queued goes out after that reply instead.
        if (!this.onResponseDone(event)) this.flushQueuedResponse();
        break;
      case "output_audio_buffer.stopped": {
        // Only the goodbye's own playback finishing shortens the wait.
        const id = event.response_id;
        if (this.goodbyeResponseId && (typeof id !== "string" || id === this.goodbyeResponseId)) {
          this.scheduleHangup(GOODBYE_TAIL_MS);
        }
        break;
      }
      case "error":
        this.onError(event);
        break;
      default:
        break;
    }
  }

  /** Handle a finished response; true when it carried tool calls to run. */
  private onResponseDone(event: RealtimeEvent): boolean {
    const response = event.response as { id?: unknown; status?: unknown; output?: unknown[] } | undefined;
    if (response?.status === "cancelled") return false;
    const calls = (response?.output ?? []).filter(isFunctionCall);
    if (calls.length === 0) {
      const id = typeof response?.id === "string" ? response.id : null;
      const seq = id ? (this.responseSeq.get(id) ?? this.createdCount) : this.createdCount;
      if (this.pendingEnd && !this.goodbyeResponseId && seq >= this.endFromSeq) {
        this.goodbyeResponseId = id ?? "unknown";
        this.scheduleHangup(estimateSpeechMs((id && this.transcriptByResponse.get(id)) || ""));
      }
      return false;
    }
    this.enqueue(() => this.runToolCalls(calls));
    return true;
  }

  /**
   * A refused `response.create` must not silence the call. If another response
   * was already running, ours goes out after it; otherwise the slot is freed.
   */
  private onError(event: RealtimeEvent): void {
    const err = event.error as { message?: unknown; code?: unknown } | undefined;
    this.deps.log(
      `[phone] ${this.deps.callId} realtime error: ${typeof err?.code === "string" ? err.code + " " : ""}${typeof err?.message === "string" ? err.message : ""}`,
    );
    if (!this.awaitingCreated) return;
    const refused = this.awaitingCreated;
    this.awaitingCreated = null;
    if (err?.code === "conversation_already_has_active_response") {
      // Something else is speaking; its response.done flushes ours.
      this.queuedResponse = this.queuedResponse ?? refused;
      this.responseActive = true;
    } else {
      this.responseActive = false;
      this.flushQueuedResponse();
    }
  }

  private async runToolCalls(calls: FunctionCallItem[]): Promise<void> {
    const fresh = calls.filter((c) => !this.handledCalls.has(c.call_id) && (c.status ?? "completed") === "completed");
    if (fresh.length === 0) {
      this.flushQueuedResponse();
      return;
    }
    for (const call of fresh) {
      this.handledCalls.add(call.call_id);
      let result: Record<string, unknown>;
      try {
        result = this.interview
          ? await this.interview.execute(call.name, call.arguments)
          : this.runLobbyTool(call.name, call.arguments);
      } catch (err) {
        result = { error: `The tool failed: ${err instanceof Error ? err.message : "unknown error"}` };
      }
      const output = JSON.stringify(result);
      this.addTranscript({ role: "tool", at: this.deps.now(), name: call.name, args: call.arguments, result: output });
      if (this.phase === "ended") return;
      this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output } });
    }
    this.requestResponse({});
  }

  // --- lobby ---------------------------------------------------------------

  private onDigit(digit: string): void {
    if (this.phase !== "lobby" || this.locked) return;
    if (digit === "*") {
      this.digits = "";
      return;
    }
    if (digit === "0" && this.digits === "") {
      const latest = this.deps.findLatest();
      if (!latest) {
        this.say("There's no open review right now. Goodbye.", "stopped");
        return;
      }
      this.latestOffered = latest;
      this.say(`Your latest review is ${latest.title ?? "untitled"}. Should I open it? Say yes, or enter a PIN.`);
      return;
    }
    if (digit === "#") {
      if (this.digits.length > 0) this.tryPin(this.digits);
      return;
    }
    if (!/^\d$/.test(digit)) return;
    this.digits += digit;
    if (this.digits.length === 4) this.tryPin(this.digits);
  }

  private runLobbyTool(name: string, rawArgs: string): Record<string, unknown> {
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      return { error: "The tool arguments were not valid JSON." };
    }

    if (name === "find_latest") {
      const latest = this.deps.findLatest();
      if (!latest) return { error: "There is no open review right now." };
      this.latestOffered = latest;
      return { title: latest.title ?? "Untitled review", message: "Tell them the title and ask if that's the one." };
    }

    if (name === "open_review") {
      if (this.locked) return { error: "No more tries on this call. Say goodbye." };
      if (this.phase !== "lobby") return { error: "A review is already opening." };
      if (args.use_latest === true) {
        if (!this.latestOffered) return { error: "Call find_latest and confirm the title first." };
        const doc = this.latestOffered;
        this.open(doc, false);
        return { ok: true, title: doc.title, message: `Say: "Opening ${doc.title ?? "it"}. One moment."` };
      }
      const pin = typeof args.pin === "string" ? args.pin.replace(/\D/g, "") : "";
      const doc = this.deps.findByPin(pin);
      if (!doc) return this.miss(false);
      this.open(doc, false);
      return { ok: true, title: doc.title, message: `Say: "Opening ${doc.title ?? "it"}. One moment."` };
    }

    return { error: `There is no tool called ${name} yet. Ask which review they want.` };
  }

  private tryPin(pin: string): void {
    this.digits = "";
    const doc = this.deps.findByPin(pin);
    if (!doc) {
      this.miss(true);
      return;
    }
    this.open(doc, true);
  }

  /** A wrong PIN. Spoken PINs report through the tool result; keypad ones are said directly. */
  private miss(viaKeypad: boolean): Record<string, unknown> {
    this.misses += 1;
    if (this.misses >= MAX_PIN_MISSES) {
      this.locked = true;
      if (viaKeypad) this.say("That PIN didn't match either. Goodbye.", "stopped");
      else this.beginEnding("stopped");
      return { error: "No review has that PIN, and that was the last try. Say goodbye; the call will end." };
    }
    if (viaKeypad) this.say("I didn't find a review with that PIN. Try again.");
    return { error: "No open review has that PIN. Say so briefly and ask them to try again." };
  }

  /** Open a review: announce it, prepare the brief, then hand the call to the interview. */
  private open(doc: { id: string; title: string | null }, announce: boolean): void {
    this.phase = "opening";
    if (announce) this.say(`Opening ${doc.title ?? "your review"}. One moment.`);
    this.deps.log(`[phone] ${this.deps.callId} opening review ${doc.id}`);
    void this.deps
      .openReview(doc.id)
      .then((review) => {
        if (this.phase === "ended") {
          // The caller hung up while the review was opening: keep what was said.
          review.record(this.pending);
          this.pending = [];
          review.close("ended");
          return;
        }
        this.review = review;
        review.record(this.pending);
        this.pending = [];
        // A submit or end_call in the interview also ends the phone call.
        const store: InterviewStore = {
          ...review.store,
          endCall: (reason) => {
            review.store.endCall(reason);
            this.beginEnding(reason);
          },
        };
        this.interview = new Interview(review.brief, store, review.answeredBefore);
        this.send({
          type: "session.update",
          session: { type: "realtime", instructions: buildInstructions(review.brief), tools: VOICE_TOOLS },
        });
        this.phase = "interview";
        this.requestResponse({});
      })
      .catch((err: unknown) => {
        this.deps.log(`[phone] ${this.deps.callId} could not open ${doc.id}: ${err instanceof Error ? err.message : err}`);
        this.say("Sorry, I couldn't get that review ready. Please try again later. Goodbye.", "stopped");
      });
  }

  // --- plumbing ------------------------------------------------------------

  /** Have the model say exactly this. With `end`, hang up once it has been said. */
  private say(text: string, end?: "stopped"): void {
    if (end) {
      this.beginEnding(end);
      if (this.phase === "lobby" || this.phase === "opening") this.phase = "ending";
    }
    this.requestResponse({ instructions: `Say exactly this, then stop: "${text.replace(/"/g, "'")}"`, tool_choice: "none" });
  }

  /**
   * The call is ending: the next finished, tool-free response (created from
   * now on) is the goodbye. A hard stop guarantees the hang-up even if the model
   * keeps calling tools instead of saying goodbye.
   */
  private beginEnding(reason: "submitted" | "stopped"): void {
    if (this.pendingEnd) return;
    this.pendingEnd = reason;
    this.endFromSeq = this.createdCount + 1;
    this.hardStopTimer = this.deps.setTimeout(() => {
      this.hangupQuietly();
      this.finish("hard stop");
    }, HARD_STOP_MS);
  }

  /** Send `response.create` now, or right after the response in progress finishes. */
  private requestResponse(response: Record<string, unknown>): void {
    if (this.responseActive) {
      this.queuedResponse = response;
      return;
    }
    this.responseActive = true;
    this.awaitingCreated = response;
    this.send({ type: "response.create", ...(Object.keys(response).length > 0 ? { response } : {}) });
  }

  private flushQueuedResponse(): void {
    if (!this.queuedResponse || this.responseActive) return;
    const next = this.queuedResponse;
    this.queuedResponse = null;
    this.requestResponse(next);
  }

  private scheduleHangup(ms: number): void {
    if (this.goodbyeTimer) this.deps.clearTimeout(this.goodbyeTimer);
    this.goodbyeTimer = this.deps.setTimeout(() => {
      this.hangupQuietly();
      this.finish("hung up");
    }, ms);
  }

  private hangupQuietly(): void {
    void this.deps.hangup().catch((err: unknown) => {
      this.deps.log(`[phone] ${this.deps.callId} hangup: ${err instanceof Error ? err.message : err}`);
    });
  }

  private addTranscript(entry: TranscriptEntry): void {
    if (this.review) this.review.record([entry]);
    else this.pending.push(entry);
  }

  private enqueue(task: () => void | Promise<void>): void {
    this.queue = this.queue.then(task).catch((err: unknown) => {
      this.deps.log(`[phone] ${this.deps.callId} handler failed: ${err instanceof Error ? err.message : err}`);
    });
  }

  private send(event: Record<string, unknown>): void {
    if (this.phase === "ended") return;
    try {
      this.deps.socket.send(JSON.stringify(event));
    } catch (err) {
      this.deps.log(`[phone] ${this.deps.callId} send failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private finish(why: string): void {
    if (this.phase === "ended") return;
    this.phase = "ended";
    if (this.goodbyeTimer) this.deps.clearTimeout(this.goodbyeTimer);
    this.goodbyeTimer = null;
    if (this.hardStopTimer) this.deps.clearTimeout(this.hardStopTimer);
    this.hardStopTimer = null;
    // A submit may still be settling when the caller hangs up: wait for it.
    void (this.interview?.settled() ?? Promise.resolve()).then(() => {
      this.review?.close(this.interview?.isSubmitted ? "submitted" : "ended");
    });
    try {
      this.deps.socket.close();
    } catch {
      // already closed
    }
    this.deps.log(`[phone] ${this.deps.callId} ended (${why})`);
  }
}

function isFunctionCall(item: unknown): item is FunctionCallItem {
  if (!item || typeof item !== "object") return false;
  const it = item as Record<string, unknown>;
  return it.type === "function_call" && typeof it.name === "string" && typeof it.call_id === "string" && typeof it.arguments === "string";
}

/** A rough length for a spoken line: about 2.5 words a second, plus a beat. */
export function estimateSpeechMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(MAX_GOODBYE_MS, Math.max(MIN_GOODBYE_MS, Math.round((words / 2.5) * 1000) + 1_000));
}
