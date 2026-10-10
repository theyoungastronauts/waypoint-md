/**
 * The browser side of a Waypoint Voice call: one WebRTC connection to OpenAI
 * Realtime, opened with the short-lived key the server minted. No React here —
 * the protocol lives in this class so it can be driven by fakes in tests, and
 * the `VoiceCall` component wraps it for the page.
 *
 * Flow (developers.openai.com, Realtime WebRTC guide, checked 2026-10-09):
 * microphone track + an `oai-events` data channel → SDP offer POSTed to
 * `/v1/realtime/calls` with the client key (`Content-Type: application/sdp`) →
 * the answer SDP comes back as text. Events then flow over the data channel:
 * tool calls arrive in `response.done`, results go back as
 * `conversation.item.create` (`function_call_output`) plus one `response.create`.
 *
 * Teardown mirrors the dictation input's discipline: every exit path (hang-up,
 * a dropped connection, an error, unmount) stops every mic track and closes the
 * channel and the peer connection, and is safe to call more than once.
 */

export type CallPhase = "idle" | "connecting" | "live" | "ended";

export type CallEndReason = "hangup" | "submitted" | "stopped" | "dropped" | "error";

export interface ToolCallRecord {
  name: string;
  args: string;
  result: string;
}

export interface RealtimeCallHandlers {
  /** Run one tool call; the returned object is sent back as the call's output. */
  onToolCall(name: string, args: string): Promise<Record<string, unknown>>;
  /** A finished utterance: what the reviewer said, or what the voice said. */
  onUtterance?(role: "reviewer" | "voice", text: string): void;
  /** Live caption of the voice model's current sentence (cleared with ""). */
  onCaption?(text: string): void;
  /** Every tool call with its result, for the transcript. */
  onToolRecord?(record: ToolCallRecord): void;
  onPhase?(phase: CallPhase): void;
  onEnded?(reason: CallEndReason, message?: string): void;
}

/** Browser primitives, injectable so the protocol is testable without a browser. */
export interface RealtimeDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createPeerConnection(): RTCPeerConnection;
  fetch: typeof fetch;
  /** Where the model's voice plays. */
  audioElement: HTMLAudioElement;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

/** After the goodbye's `response.done`, hang up this long later if playback never reports it stopped. */
export const GOODBYE_FALLBACK_MS = 8_000;
/** A short tail after playback stops, so the last syllable isn't clipped. */
const GOODBYE_TAIL_MS = 400;

interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

interface FunctionCallItem {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
}

export class RealtimeCall {
  private readonly deps: RealtimeDeps;
  private readonly handlers: RealtimeCallHandlers;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private phase: CallPhase = "idle";
  private readonly handledCalls = new Set<string>();
  /** Set by end_call / submit: hang up after the model's next spoken reply. */
  private pendingEnd: "submitted" | "stopped" | null = null;
  private goodbyeTimer: ReturnType<typeof setTimeout> | null = null;
  private goodbyeArmed = false;
  /** Serializes tool handling so two `response.done`s never interleave writes. */
  private queue: Promise<void> = Promise.resolve();

  constructor(deps: RealtimeDeps, handlers: RealtimeCallHandlers) {
    this.deps = deps;
    this.handlers = handlers;
  }

  get currentPhase(): CallPhase {
    return this.phase;
  }

  async start(opts: { clientSecret: string; callsUrl: string }): Promise<void> {
    if (this.phase !== "idle") throw new Error("A call can only be started once.");
    this.setPhase("connecting");
    try {
      const stream = await this.deps.getUserMedia({ audio: true });
      if (this.isEnded()) {
        // Hung up while the permission prompt was open: release the mic at once.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;

      const pc = this.deps.createPeerConnection();
      this.pc = pc;
      pc.ontrack = (e) => {
        this.deps.audioElement.srcObject = e.streams[0] ?? null;
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          this.finish("dropped", "The connection to the voice service dropped.");
        }
      };
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

      const channel = pc.createDataChannel("oai-events");
      this.channel = channel;
      channel.onopen = () => {
        this.setPhase("live");
        // The model speaks first: greeting, then "brief or thorough?".
        this.send({ type: "response.create" });
      };
      channel.onmessage = (e: MessageEvent) => this.onMessage(e.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const res = await this.deps.fetch(opts.callsUrl, {
        method: "POST",
        body: offer.sdp,
        headers: { authorization: `Bearer ${opts.clientSecret}`, "content-type": "application/sdp" },
      });
      if (!res.ok) throw new Error(`The voice service refused the connection (HTTP ${res.status}).`);
      const answer = await res.text();
      if (this.isEnded()) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (err) {
      this.finish("error", describeError(err));
    }
  }

  /** The reviewer pressed Hang up. Nothing is submitted. */
  hangup(): void {
    this.finish("hangup");
  }

  /**
   * End the call after the model's goodbye (end_call or a successful submit).
   * The goodbye is the response the model makes after this tool result.
   */
  endAfterGoodbye(reason: "submitted" | "stopped"): void {
    this.pendingEnd = reason;
  }

  /** Release everything. Idempotent; safe from any state, including unmount. */
  dispose(): void {
    this.finish("hangup");
  }

  // --- events --------------------------------------------------------------

  private onMessage(data: unknown): void {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(String(data)) as RealtimeEvent;
    } catch {
      console.warn("[voice] ignoring a non-JSON event");
      return;
    }

    switch (event.type) {
      case "conversation.item.input_audio_transcription.completed": {
        const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
        if (text) this.handlers.onUtterance?.("reviewer", text);
        break;
      }
      case "response.output_audio_transcript.delta": {
        if (typeof event.delta === "string") this.appendCaption(event.delta);
        break;
      }
      case "response.output_audio_transcript.done": {
        const text = typeof event.transcript === "string" ? event.transcript.trim() : "";
        this.caption = "";
        this.handlers.onCaption?.("");
        if (text) this.handlers.onUtterance?.("voice", text);
        break;
      }
      case "response.done": {
        const calls = functionCalls(event);
        if (calls.length === 0) {
          // A spoken reply with no tool calls. If a goodbye was due, this is it.
          // Armed synchronously so a quick "playback stopped" is not missed.
          if (this.pendingEnd && !this.goodbyeArmed) {
            this.goodbyeArmed = true;
            this.scheduleEnd(GOODBYE_FALLBACK_MS);
          }
          break;
        }
        this.queue = this.queue.then(() => this.runToolCalls(calls)).catch((err) => {
          console.error("[voice] tool handling failed:", err);
        });
        break;
      }
      case "output_audio_buffer.stopped":
        // The goodbye finished playing (WebRTC only). The fallback timer covers
        // a service that never sends it.
        if (this.goodbyeArmed) this.scheduleEnd(GOODBYE_TAIL_MS);
        break;
      case "error": {
        const err = event.error as { message?: unknown } | undefined;
        console.warn("[voice] realtime error:", typeof err?.message === "string" ? err.message : event);
        break;
      }
      default:
        break;
    }
  }

  private caption = "";
  private appendCaption(delta: string): void {
    this.caption += delta;
    this.handlers.onCaption?.(this.caption);
  }

  private async runToolCalls(all: FunctionCallItem[]): Promise<void> {
    const calls = all.filter((c) => !this.handledCalls.has(c.call_id));
    if (calls.length === 0) return;

    for (const call of calls) {
      this.handledCalls.add(call.call_id);
      let result: Record<string, unknown>;
      try {
        result = await this.handlers.onToolCall(call.name, call.arguments);
      } catch (err) {
        result = { error: `The tool failed: ${describeError(err)}` };
      }
      const output = JSON.stringify(result);
      this.handlers.onToolRecord?.({ name: call.name, args: call.arguments, result: output });
      if (this.phase === "ended") return;
      this.send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: call.call_id, output },
      });
    }
    // One response for the whole batch of results.
    this.send({ type: "response.create" });
  }

  // --- plumbing ------------------------------------------------------------

  private send(event: Record<string, unknown>): void {
    if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(event));
  }

  private scheduleEnd(ms: number): void {
    if (this.goodbyeTimer) this.deps.clearTimeout(this.goodbyeTimer);
    const reason = this.pendingEnd ?? "stopped";
    this.goodbyeTimer = this.deps.setTimeout(() => this.finish(reason), ms);
  }

  /** Re-read through a method: a hang-up can land during any await in start(). */
  private isEnded(): boolean {
    return this.phase === "ended";
  }

  private setPhase(phase: CallPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.handlers.onPhase?.(phase);
  }

  private finish(reason: CallEndReason, message?: string): void {
    if (this.phase === "ended") return;
    const wasStarted = this.phase !== "idle";
    this.setPhase("ended");

    if (this.goodbyeTimer) this.deps.clearTimeout(this.goodbyeTimer);
    this.goodbyeTimer = null;
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onmessage = null;
      try {
        this.channel.close();
      } catch {
        // already closed
      }
    }
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        // already closed
      }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.deps.audioElement.srcObject = null;
    this.channel = null;
    this.pc = null;
    this.stream = null;

    if (wasStarted) this.handlers.onEnded?.(reason, message);
  }
}

function functionCalls(event: RealtimeEvent): FunctionCallItem[] {
  const response = event.response as { output?: unknown[] } | undefined;
  return (response?.output ?? []).filter(isFunctionCall);
}

function isFunctionCall(item: unknown): item is FunctionCallItem {
  if (!item || typeof item !== "object") return false;
  const it = item as Record<string, unknown>;
  return (
    it.type === "function_call" &&
    typeof it.name === "string" &&
    typeof it.call_id === "string" &&
    typeof it.arguments === "string"
  );
}

function describeError(err: unknown): string {
  if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
    return "Microphone access was blocked. Allow the microphone for this site and try again.";
  }
  if (err instanceof DOMException && err.name === "NotFoundError") {
    return "No microphone was found.";
  }
  return err instanceof Error ? err.message : "Something went wrong starting the call.";
}
