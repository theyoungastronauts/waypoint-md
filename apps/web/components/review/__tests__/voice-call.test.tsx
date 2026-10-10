// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Item } from "@waypoint/spec";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ChoiceGroup } from "@/components/review/choice-group";
import { FocusProvider } from "@/components/review/focus-context";
import { ResponsesProvider } from "@/components/review/responses-store";
import type { ReviewItemInit } from "@/components/review/types";
import { VoiceCall } from "@/components/review/voice-call";
import type { VoiceBrief } from "@/lib/voice/brief";

/**
 * The Talk button end to end against fakes: brief → session → WebRTC → the
 * voice model's tool calls → the on-screen card and the autosave PUT → read-back
 * → submit (PATCH completed) → transcript saved with status submitted.
 * The real browser APIs (RTCPeerConnection, getUserMedia) are stubbed; OpenAI
 * and the Waypoint API are a scripted fetch.
 */

const ITEM_ID = "item-1";
const DOC_ID = "doc-1";

const item: Item = {
  wpId: "q1",
  type: "choice",
  select: "single",
  promptMd: "Auth model?",
  options: [
    { label: "Shared token", checked: false, marker: { start: 0, end: 3 } },
    { label: "Per-device tokens", checked: false, marker: { start: 0, end: 3 } },
  ],
  spans: { block: { start: 0, end: 0 }, questionOpen: { start: 0, end: 0 } },
};
const init: ReviewItemInit = { itemId: ITEM_ID, item, promptHtml: "Auth model?", optionLabelsHtml: [], persisted: null, warnings: [] };

const brief: VoiceBrief = {
  version: 1,
  title: "Plan",
  intro: "A plan.",
  questions: [
    {
      itemId: ITEM_ID,
      number: 1,
      type: "choice",
      select: "single",
      spoken: "How should auth work?",
      prompt: "Auth model?",
      options: [
        { label: "Shared token", spoken: "one shared token" },
        { label: "Per-device tokens", spoken: "a token per device" },
      ],
      suggested: [],
      notes: [],
    },
  ],
  background: [],
};

class FakeChannel {
  readyState = "connecting";
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.readyState = "closed";
  }
}
let peer: FakePeer;
class FakePeer {
  channel = new FakeChannel();
  connectionState = "new";
  ontrack = null;
  onconnectionstatechange = null;
  closed = false;
  addTrack() {}
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {
    this.closed = true;
  }
}

const track = { stop: vi.fn() };
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (pred: (url: string, init?: RequestInit) => boolean) =>
  fetchMock.mock.calls.filter(([url, init]) => pred(String(url), init as RequestInit | undefined));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderCall(onSubmitted = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ResponsesProvider inits={[init]}>
        <FocusProvider>
          <VoiceCall docId={DOC_ID} onSubmitted={onSubmitted} />
          <ChoiceGroup itemId={ITEM_ID} item={item} optionLabelsHtml={[]} />
        </FocusProvider>
      </ResponsesProvider>
    </QueryClientProvider>,
  );
  return onSubmitted;
}

function emit(event: Record<string, unknown>) {
  act(() => {
    peer.channel.onmessage?.({ data: JSON.stringify(event) });
  });
}

const toolCall = (name: string, args: unknown, id: string) => ({
  type: "response.done",
  response: { output: [{ type: "function_call", name, call_id: id, arguments: JSON.stringify(args) }] },
});

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/voice/brief")) return json({ brief, model: "claude-sonnet-5", cached: true });
    if (url.endsWith("/voice/session")) {
      return json({ sessionId: "vs-1", clientSecret: "ek_x", callsUrl: "https://api.openai.com/v1/realtime/calls", brief });
    }
    if (url === "https://api.openai.com/v1/realtime/calls") return new Response("answer", { status: 201 });
    if (url.startsWith("/api/") && init) return json({});
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  // Called with `new`; returning an object makes that object the instance.
  vi.stubGlobal("RTCPeerConnection", function FakeRTCPeerConnection() {
    peer = new FakePeer();
    return peer;
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })) },
  });
  Element.prototype.scrollIntoView = vi.fn();
  track.stop.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // @ts-expect-error test cleanup of the stubbed property
  delete navigator.mediaDevices;
});

describe("VoiceCall", () => {
  it("renders nothing without WebRTC", () => {
    vi.stubGlobal("RTCPeerConnection", undefined);
    renderCall();
    expect(screen.queryByRole("button", { name: /talk/i })).toBeNull();
  });

  it("shows the server's message when the call cannot start", async () => {
    fetchMock.mockImplementationOnce(async () =>
      json({ error: { code: "voice_unavailable", message: "Voice requires both keys." } }, 400),
    );
    renderCall();
    fireEvent.click(await screen.findByRole("button", { name: /talk/i }));
    expect(await screen.findByText("Voice requires both keys.")).toBeTruthy();
  });

  it("runs an interview: answers land on the page, then read-back, submit and hang-up", async () => {
    const onSubmitted = renderCall();
    fireEvent.click(await screen.findByRole("button", { name: /talk/i }));

    await waitFor(() => expect(calls((u) => u.includes("realtime/calls")).length).toBe(1));
    expect(calls((u) => u.includes("realtime/calls"))[0][1]).toMatchObject({
      headers: { authorization: "Bearer ek_x", "content-type": "application/sdp" },
    });

    act(() => {
      peer.channel.readyState = "open";
      peer.channel.onopen?.();
    });
    expect(await screen.findByText("On the call")).toBeTruthy();
    expect(peer.channel.sent[0]).toEqual({ type: "response.create" });

    emit(toolCall("set_style", { style: "brief" }, "c1"));
    await waitFor(() => expect(calls((u, i) => u === "/api/voice-sessions/vs-1" && i?.body === '{"mode":"brief"}').length).toBe(1));

    emit(toolCall("next_question", {}, "c2"));
    expect(await screen.findByText(/question 1 of 1/)).toBeTruthy();

    emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "Per device, please." });
    expect(await screen.findByText("You: Per device, please.")).toBeTruthy();

    emit(toolCall("record_answer", { number: 1, options: [2] }, "c3"));
    await waitFor(() =>
      expect((screen.getByRole("radio", { name: /Per-device tokens/i }) as HTMLInputElement).checked).toBe(true),
    );
    await waitFor(() => {
      const puts = calls((u) => u === `/api/items/${ITEM_ID}/response`);
      expect(JSON.parse(puts.at(-1)![1]!.body as string)).toEqual({
        value: { selected: ["Per-device tokens"] },
        status: "answered",
      });
    });

    // Submit before the read-back is refused and nothing is marked completed.
    emit(toolCall("submit_review", {}, "c4"));
    await waitFor(() =>
      expect(peer.channel.sent.some((e) => JSON.stringify(e).includes("Read back the answers first"))).toBe(true),
    );
    expect(calls((u) => u === `/api/documents/${DOC_ID}`)).toHaveLength(0);

    emit(toolCall("get_readback", {}, "c5"));
    emit({ type: "input_audio_buffer.speech_started" }); // "Yes, that's right."
    emit(toolCall("submit_review", {}, "c6"));
    await waitFor(() => expect(calls((u) => u === `/api/documents/${DOC_ID}`)).toHaveLength(1));
    expect(JSON.parse(calls((u) => u === `/api/documents/${DOC_ID}`)[0][1]!.body as string)).toEqual({ status: "completed" });
    expect(onSubmitted).toHaveBeenCalledTimes(1);

    // The goodbye plays, then the call hangs up by itself.
    emit({ type: "response.done", response: { output: [{ type: "message" }] } });
    emit({ type: "output_audio_buffer.stopped" });
    expect(await screen.findByText(/Review submitted/)).toBeTruthy();
    expect(track.stop).toHaveBeenCalled();
    expect(peer.closed).toBe(true);

    // The transcript's final save carries the submitted status and the tool log.
    await waitFor(() => {
      const last = calls((u) => u === "/api/voice-sessions/vs-1").at(-1)!;
      const body = JSON.parse(last[1]!.body as string);
      expect(body.status).toBe("submitted");
    });
    const appended = calls((u) => u === "/api/voice-sessions/vs-1")
      .map(([, i]) => JSON.parse(i!.body as string))
      .flatMap((b) => b.append ?? []);
    expect(appended.some((e: { role: string; text?: string }) => e.role === "reviewer" && e.text === "Per device, please.")).toBe(true);
    expect(appended.filter((e: { role: string }) => e.role === "tool").map((e: { name: string }) => e.name)).toEqual([
      "set_style",
      "next_question",
      "record_answer",
      "submit_review",
      "get_readback",
      "submit_review",
    ]);
  });

  it("hang up mid-call releases the mic and saves the transcript as ended", async () => {
    renderCall();
    fireEvent.click(await screen.findByRole("button", { name: /talk/i }));
    await waitFor(() => expect(calls((u) => u.includes("realtime/calls")).length).toBe(1));
    act(() => {
      peer.channel.readyState = "open";
      peer.channel.onopen?.();
    });
    fireEvent.click(await screen.findByRole("button", { name: /hang up/i }));
    expect(await screen.findByText(/saved as a draft/)).toBeTruthy();
    expect(track.stop).toHaveBeenCalled();
    await waitFor(() => {
      const last = calls((u) => u === "/api/voice-sessions/vs-1").at(-1)!;
      expect(JSON.parse(last[1]!.body as string)).toEqual({ status: "ended" });
    });
    // The page refreshes so the new transcript appears under "Voice calls".
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("VoiceCall — review fixes", () => {
  async function connect() {
    fireEvent.click(await screen.findByRole("button", { name: /talk/i }));
    await waitFor(() => expect(calls((u) => u.includes("realtime/calls")).length).toBe(1));
    act(() => {
      peer.channel.readyState = "open";
      peer.channel.onopen?.();
    });
    await screen.findByText("On the call");
  }

  it("keeps the answer when the model records and flags in one batch", async () => {
    renderCall();
    await connect();
    emit({
      type: "response.done",
      response: {
        output: [
          { type: "function_call", name: "record_answer", call_id: "b1", arguments: '{"number":1,"options":[2]}' },
          { type: "function_call", name: "flag_question", call_id: "b2", arguments: '{"number":1}' },
        ],
      },
    });
    await waitFor(() => {
      const puts = calls((u) => u === `/api/items/${ITEM_ID}/response`);
      expect(puts).toHaveLength(2);
      expect(JSON.parse(puts.at(-1)![1]!.body as string)).toEqual({
        value: { selected: ["Per-device tokens"] },
        status: "flagged",
      });
    });
  });

  it("Hang up while preparing cancels: no session, no mic", async () => {
    let releaseBrief!: () => void;
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/voice/brief")) {
        await new Promise<void>((r) => (releaseBrief = r));
      }
      return base(url, init);
    });
    renderCall();
    fireEvent.click(await screen.findByRole("button", { name: /talk/i }));
    fireEvent.click(await screen.findByRole("button", { name: /hang up/i }));
    expect(await screen.findByText("Call cancelled.")).toBeTruthy();
    releaseBrief();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls((u) => u.endsWith("/voice/session"))).toHaveLength(0);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("unmounting while connecting opens no mic and closes the call record", async () => {
    let releaseSession!: () => void;
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/voice/session")) await new Promise<void>((r) => (releaseSession = r));
      return base(url, init);
    });
    renderCall();
    fireEvent.click(await screen.findByRole("button", { name: /talk/i }));
    await waitFor(() => expect(calls((u) => u.endsWith("/voice/session"))).toHaveLength(1));
    cleanup();
    releaseSession();
    await waitFor(() => {
      const last = calls((u) => u === "/api/voice-sessions/vs-1").at(-1);
      expect(last && JSON.parse(last[1]!.body as string)).toEqual({ status: "ended" });
    });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("submit waits for the last answer to save before marking the review completed", async () => {
    let releasePut!: () => void;
    const order: string[] = [];
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === `/api/items/${ITEM_ID}/response`) {
        await new Promise<void>((r) => (releasePut = r));
        order.push("put");
      }
      if (url === `/api/documents/${DOC_ID}`) order.push("complete");
      return base(url, init);
    });
    renderCall();
    await connect();
    emit(toolCall("record_answer", { number: 1, options: [1] }, "s1"));
    emit(toolCall("get_readback", {}, "s2"));
    emit({ type: "input_audio_buffer.speech_started" });
    emit(toolCall("submit_review", {}, "s3"));
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual([]);
    releasePut();
    await waitFor(() => expect(order).toEqual(["put", "complete"]));
  });
});
