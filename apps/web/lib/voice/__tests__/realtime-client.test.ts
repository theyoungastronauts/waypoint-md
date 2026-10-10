import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOODBYE_FALLBACK_MS,
  RealtimeCall,
  type RealtimeCallHandlers,
  type RealtimeDeps,
} from "@/lib/voice/realtime-client";

class FakeChannel {
  readyState: "connecting" | "open" | "closed" = "connecting";
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  emit(event: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

class FakePeer {
  channel = new FakeChannel();
  channelLabel = "";
  tracks: unknown[] = [];
  local: unknown = null;
  remote: { type: string; sdp: string } | null = null;
  closed = false;
  connectionState = "new";
  ontrack: ((e: { streams: unknown[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addTrack(track: unknown) {
    this.tracks.push(track);
  }
  createDataChannel(label: string) {
    this.channelLabel = label;
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 offer" };
  }
  async setLocalDescription(d: unknown) {
    this.local = d;
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remote = d;
  }
  close() {
    this.closed = true;
  }
}

function makeTrack() {
  return { stop: vi.fn(), kind: "audio" };
}

function setup(overrides: Partial<RealtimeDeps> = {}) {
  const peer = new FakePeer();
  const track = makeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const audio = { srcObject: null as unknown } as HTMLAudioElement;
  const fetchMock = vi.fn(async () => new Response("v=0 answer", { status: 201 }));
  const deps: RealtimeDeps = {
    getUserMedia: vi.fn(async () => stream),
    createPeerConnection: () => peer as unknown as RTCPeerConnection,
    fetch: fetchMock as unknown as typeof fetch,
    audioElement: audio,
    setTimeout: ((fn: () => void, ms: number) => setTimeout(fn, ms)) as typeof setTimeout,
    clearTimeout: ((t: ReturnType<typeof setTimeout>) => clearTimeout(t)) as typeof clearTimeout,
    ...overrides,
  };
  const handlers = {
    onToolCall: vi.fn(async (name: string) => ({ ok: true, tool: name })),
    onUtterance: vi.fn(),
    onCaption: vi.fn(),
    onToolRecord: vi.fn(),
    onPhase: vi.fn(),
    onEnded: vi.fn(),
  } satisfies RealtimeCallHandlers;
  const call = new RealtimeCall(deps, handlers);
  return { call, peer, track, audio, fetchMock, handlers, deps };
}

/** Let queued promise chains (tool handling) run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("RealtimeCall — connecting", () => {
  it("adds the mic track, opens oai-events, and exchanges SDP with the short-lived key", async () => {
    const { call, peer, track, fetchMock, handlers } = setup();
    await call.start({ clientSecret: "ek_abc", callsUrl: "https://api.openai.com/v1/realtime/calls" });

    expect(peer.tracks).toEqual([track]);
    expect(peer.channelLabel).toBe("oai-events");
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: "v=0 offer",
      headers: { authorization: "Bearer ek_abc", "content-type": "application/sdp" },
    });
    expect(peer.remote).toEqual({ type: "answer", sdp: "v=0 answer" });
    expect(handlers.onPhase).toHaveBeenCalledWith("connecting");

    peer.channel.open();
    expect(handlers.onPhase).toHaveBeenLastCalledWith("live");
    // The model is asked to speak first.
    expect(peer.channel.sent).toEqual([{ type: "response.create" }]);
  });

  it("plays the model's audio track", async () => {
    const { call, peer, audio } = setup();
    await call.start({ clientSecret: "ek", callsUrl: "u" });
    const remote = { id: "remote" };
    peer.ontrack?.({ streams: [remote] });
    expect(audio.srcObject).toBe(remote);
  });

  it("ends with a readable message when the mic is blocked, and never calls out", async () => {
    const { call, fetchMock, handlers } = setup({
      getUserMedia: vi.fn(async () => {
        throw new DOMException("denied", "NotAllowedError");
      }),
    });
    await call.start({ clientSecret: "ek", callsUrl: "u" });
    expect(handlers.onEnded).toHaveBeenCalledWith("error", expect.stringMatching(/Microphone access was blocked/));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ends with an error and releases the mic when the SDP exchange is refused", async () => {
    const { call, peer, track, handlers } = setup({
      fetch: vi.fn(async () => new Response("no", { status: 401 })) as unknown as typeof fetch,
    });
    await call.start({ clientSecret: "ek", callsUrl: "u" });
    expect(handlers.onEnded).toHaveBeenCalledWith("error", expect.stringMatching(/HTTP 401/));
    expect(track.stop).toHaveBeenCalled();
    expect(peer.closed).toBe(true);
  });

  it("releases a mic granted after the reviewer already hung up", async () => {
    let grant!: (s: MediaStream) => void;
    const track = makeTrack();
    const { call, handlers } = setup({
      getUserMedia: () => new Promise<MediaStream>((r) => (grant = r)),
    });
    const starting = call.start({ clientSecret: "ek", callsUrl: "u" });
    call.hangup();
    grant({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream);
    await starting;
    expect(track.stop).toHaveBeenCalled();
    expect(handlers.onEnded).toHaveBeenCalledTimes(1);
    expect(handlers.onEnded).toHaveBeenCalledWith("hangup", undefined);
  });
});

describe("RealtimeCall — events", () => {
  async function live() {
    const ctx = setup();
    await ctx.call.start({ clientSecret: "ek", callsUrl: "u" });
    ctx.peer.channel.open();
    ctx.peer.channel.sent.length = 0;
    return ctx;
  }

  it("reports reviewer and voice utterances and live captions", async () => {
    const { peer, handlers } = await live();
    peer.channel.emit({ type: "conversation.item.input_audio_transcription.completed", transcript: " Brief please. " });
    peer.channel.emit({ type: "response.output_audio_transcript.delta", delta: "Great, " });
    peer.channel.emit({ type: "response.output_audio_transcript.delta", delta: "first question." });
    peer.channel.emit({ type: "response.output_audio_transcript.done", transcript: "Great, first question." });

    expect(handlers.onUtterance.mock.calls).toEqual([
      ["reviewer", "Brief please."],
      ["voice", "Great, first question."],
    ]);
    expect(handlers.onCaption.mock.calls.map((c) => c[0])).toEqual(["Great, ", "Great, first question.", ""]);
  });

  it("runs every tool call in a response, returns each output, then asks for one response", async () => {
    const { peer, handlers } = await live();
    peer.channel.emit({
      type: "response.done",
      response: {
        output: [
          { type: "message", content: [] },
          { type: "function_call", name: "set_style", call_id: "c1", arguments: '{"style":"brief"}' },
          { type: "function_call", name: "next_question", call_id: "c2", arguments: "{}" },
        ],
      },
    });
    await flush();

    expect(handlers.onToolCall.mock.calls).toEqual([
      ["set_style", '{"style":"brief"}'],
      ["next_question", "{}"],
    ]);
    expect(peer.channel.sent).toEqual([
      { type: "conversation.item.create", item: { type: "function_call_output", call_id: "c1", output: '{"ok":true,"tool":"set_style"}' } },
      { type: "conversation.item.create", item: { type: "function_call_output", call_id: "c2", output: '{"ok":true,"tool":"next_question"}' } },
      { type: "response.create" },
    ]);
    expect(handlers.onToolRecord).toHaveBeenCalledTimes(2);
  });

  it("never runs the same call_id twice", async () => {
    const { peer, handlers } = await live();
    const done = {
      type: "response.done",
      response: { output: [{ type: "function_call", name: "skip_question", call_id: "c9", arguments: '{"number":1}' }] },
    };
    peer.channel.emit(done);
    peer.channel.emit(done);
    await flush();
    expect(handlers.onToolCall).toHaveBeenCalledTimes(1);
  });

  it("turns a throwing tool into an error output instead of breaking the call", async () => {
    const { peer, handlers } = await live();
    handlers.onToolCall.mockRejectedValueOnce(new Error("boom"));
    peer.channel.emit({
      type: "response.done",
      response: { output: [{ type: "function_call", name: "record_answer", call_id: "c1", arguments: "{}" }] },
    });
    await flush();
    expect(peer.channel.sent[0]).toMatchObject({
      item: { output: JSON.stringify({ error: "The tool failed: boom" }) },
    });
  });

  it("ignores junk on the channel", async () => {
    const { peer, handlers } = await live();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    peer.channel.onmessage?.({ data: "not json" });
    peer.channel.emit({ type: "something.new" });
    expect(handlers.onEnded).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ends as dropped when the connection fails, releasing the mic", async () => {
    const { peer, track, handlers } = await live();
    peer.connectionState = "failed";
    peer.onconnectionstatechange?.();
    expect(handlers.onEnded).toHaveBeenCalledWith("dropped", expect.any(String));
    expect(track.stop).toHaveBeenCalled();
  });
});

describe("RealtimeCall — ending", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  async function live() {
    const ctx = setup();
    await ctx.call.start({ clientSecret: "ek", callsUrl: "u" });
    ctx.peer.channel.open();
    return ctx;
  }

  it("hang up releases everything once and reports it", async () => {
    const { call, peer, track, audio, handlers } = await live();
    call.hangup();
    call.hangup();
    call.dispose();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(peer.closed).toBe(true);
    expect(peer.channel.closed).toBe(true);
    expect(audio.srcObject).toBeNull();
    expect(handlers.onEnded).toHaveBeenCalledTimes(1);
    expect(handlers.onEnded).toHaveBeenCalledWith("hangup", undefined);
  });

  it("after submit, waits for the goodbye and for playback to stop before hanging up", async () => {
    vi.useFakeTimers();
    const { call, peer, handlers } = await live();
    call.endAfterGoodbye("submitted");

    // The goodbye: a response with no tool calls.
    peer.channel.emit({ type: "response.done", response: { output: [{ type: "message" }] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(handlers.onEnded).not.toHaveBeenCalled();

    peer.channel.emit({ type: "output_audio_buffer.stopped" });
    await vi.advanceTimersByTimeAsync(500);
    expect(handlers.onEnded).toHaveBeenCalledWith("submitted", undefined);
    vi.useRealTimers();
  });

  it("hangs up after a fallback delay if playback never reports stopping", async () => {
    vi.useFakeTimers();
    const { call, peer, handlers } = await live();
    call.endAfterGoodbye("stopped");
    peer.channel.emit({ type: "response.done", response: { output: [] } });
    await vi.advanceTimersByTimeAsync(GOODBYE_FALLBACK_MS - 1);
    expect(handlers.onEnded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(handlers.onEnded).toHaveBeenCalledWith("stopped", undefined);
    vi.useRealTimers();
  });

  it("does not treat audio stopping mid-call as a goodbye", async () => {
    vi.useFakeTimers();
    const { peer, handlers } = await live();
    peer.channel.emit({ type: "output_audio_buffer.stopped" });
    await vi.advanceTimersByTimeAsync(GOODBYE_FALLBACK_MS * 2);
    expect(handlers.onEnded).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
