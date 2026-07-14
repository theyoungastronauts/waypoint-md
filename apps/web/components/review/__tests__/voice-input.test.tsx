// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Item } from "@waypoint/spec";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuestionCard } from "@/components/review/question-card";
import { FocusProvider } from "@/components/review/focus-context";
import { ResponsesProvider } from "@/components/review/responses-store";
import type { PersistedResponse, ReviewItemInit } from "@/components/review/types";
import { VoiceInput } from "@/components/review/voice-input";

// --- A drivable stand-in for the browser's SpeechRecognition (browser-only). --
//
// The real Web Speech API only exists in a live browser, so jsdom tests stub it.
// The stub records the constructed instance so a test can fire `onresult` /
// `onerror` / `onend` exactly like the engine would.
type ResultItem = { transcript: string; isFinal: boolean };

class MockRecognition {
  static last: MockRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    MockRecognition.last = this;
  }
  /** Fire an onresult event carrying a cumulative result list (resultIndex 0). */
  emit(items: ResultItem[]) {
    const results = items.map((it) => ({ isFinal: it.isFinal, length: 1, 0: { transcript: it.transcript, confidence: 1 } }));
    act(() => this.onresult?.({ resultIndex: 0, results }));
  }
}

function stubSpeechRecognition() {
  MockRecognition.last = null;
  vi.stubGlobal("SpeechRecognition", MockRecognition);
}

describe("VoiceInput — degradation gate (isSupported)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the mic when SpeechRecognition is present", () => {
    stubSpeechRecognition();
    render(<VoiceInput onInsert={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^voice input$/i })).toBeTruthy();
  });

  it("renders nothing when SpeechRecognition is absent (Firefox / locked-down)", () => {
    // No stub: neither window.SpeechRecognition nor webkitSpeechRecognition exist.
    render(<VoiceInput onInsert={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^voice input$/i })).toBeNull();
  });
});

describe("VoiceInput — listening → stop inserts the transcript", () => {
  beforeEach(() => stubSpeechRecognition());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts listening, shows the live interim text, and inserts the final on stop", () => {
    const onInsert = vi.fn();
    render(<VoiceInput onInsert={onInsert} />);

    fireEvent.click(screen.getByRole("button", { name: /^voice input$/i }));
    // Recognition was configured for continuous, interim results and started.
    const rec = MockRecognition.last!;
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.start).toHaveBeenCalled();
    expect(screen.getByText(/listening/i)).toBeTruthy();

    // Interim, then final for the same utterance (resultIndex stays 0).
    rec.emit([{ transcript: "hello", isFinal: false }]);
    expect(screen.getByText("hello")).toBeTruthy();
    rec.emit([{ transcript: "hello world", isFinal: true }]);

    // Stop → the accumulated final transcript is inserted, back to idle.
    fireEvent.click(screen.getByRole("button", { name: /stop voice input and insert/i }));
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith("hello world");
    expect(screen.getByRole("button", { name: /^voice input$/i })).toBeTruthy();
    expect(rec.abort).toHaveBeenCalled(); // mic torn down
  });

  it("cancel discards the take without inserting", () => {
    const onInsert = vi.fn();
    render(<VoiceInput onInsert={onInsert} />);

    fireEvent.click(screen.getByRole("button", { name: /^voice input$/i }));
    MockRecognition.last!.emit([{ transcript: "throwaway", isFinal: true }]);
    fireEvent.click(screen.getByRole("button", { name: /cancel voice input/i }));

    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^voice input$/i })).toBeTruthy();
  });

  it("auto-end (engine onend) inserts what was captured", () => {
    const onInsert = vi.fn();
    render(<VoiceInput onInsert={onInsert} />);

    fireEvent.click(screen.getByRole("button", { name: /^voice input$/i }));
    const rec = MockRecognition.last!;
    rec.emit([{ transcript: "silence stopped me", isFinal: true }]);
    act(() => rec.onend?.());

    expect(onInsert).toHaveBeenCalledWith("silence stopped me");
    expect(screen.getByRole("button", { name: /^voice input$/i })).toBeTruthy();
  });
});

describe("VoiceInput — stop/restart during the permission grant doesn't orphan the mic (WARN-1)", () => {
  beforeEach(() => stubSpeechRecognition());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    // Remove the mediaDevices shim so other suites see jsdom's default (none).
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("releases the first session's stream when a stopped-and-restarted grant resolves stale", async () => {
    const track1 = { stop: vi.fn() };
    const track2 = { stop: vi.fn() };
    let resolve1!: (s: unknown) => void;
    let resolve2!: (s: unknown) => void;
    const getUserMedia = vi
      .fn()
      .mockReturnValueOnce(new Promise((r) => (resolve1 = r)))
      .mockReturnValueOnce(new Promise((r) => (resolve2 = r)));
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });

    render(<VoiceInput onInsert={vi.fn()} />);

    // Start #1 → getUserMedia #1 is pending (permission prompt open).
    fireEvent.click(screen.getByRole("button", { name: /^voice input$/i }));
    // Stop, then start #2 → generation advances while #1 is still pending.
    fireEvent.click(screen.getByRole("button", { name: /stop voice input and insert/i }));
    fireEvent.click(screen.getByRole("button", { name: /^voice input$/i }));

    // The FIRST grant now resolves — it belongs to a superseded session and its
    // track must be stopped, not left running (the leak WARN-1 describes).
    await act(async () => {
      resolve1({ getTracks: () => [track1] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(track1.stop).toHaveBeenCalled();

    // The current session's grant resolves and is retained (not stopped mid-session).
    await act(async () => {
      resolve2({ getTracks: () => [track2] });
      await Promise.resolve();
    });
    expect(track2.stop).not.toHaveBeenCalled();
  });
});

describe("VoiceInput — runtime failure reverts to idle without throwing", () => {
  beforeEach(() => stubSpeechRecognition());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mic-permission denied (not-allowed) reverts to idle with a hint, no insert", () => {
    const onInsert = vi.fn();
    render(<VoiceInput onInsert={onInsert} />);

    fireEvent.click(screen.getByRole("button", { name: /^voice input$/i }));
    const rec = MockRecognition.last!;

    expect(() => act(() => rec.onerror?.({ error: "not-allowed" }))).not.toThrow();

    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^voice input$/i })).toBeTruthy();
    expect(screen.getByText(/microphone access was blocked/i)).toBeTruthy();
    expect(rec.abort).toHaveBeenCalled();
  });

  it("transient 'no-speech' keeps listening (no revert, no hint)", () => {
    render(<VoiceInput onInsert={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^voice input$/i }));
    act(() => MockRecognition.last!.onerror?.({ error: "no-speech" }));
    // Still listening — the stop control is present, the idle mic is not.
    expect(screen.getByRole("button", { name: /stop voice input and insert/i })).toBeTruthy();
  });
});

// --- Integration: the transcript reaches the field and autosaves ------------
// Mirrors attach-file.test.tsx: assert the value lands in the real textarea and
// the autosave PUT carries it (the caret-insert → saveContent path).

const ITEM_ID = "item-1";
const ZERO_SPANS = { block: { start: 0, end: 0 }, questionOpen: { start: 0, end: 0 } };

function textInit(persisted: PersistedResponse | null): ReviewItemInit {
  const item: Item = { wpId: "q1", type: "text", promptMd: "Your answer?", spans: ZERO_SPANS };
  return { itemId: ITEM_ID, item, promptHtml: "Your answer?", optionLabelsHtml: [], persisted, warnings: [] };
}

function renderWith(node: ReactNode, init: ReviewItemInit) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResponsesProvider inits={[init]}>
        <FocusProvider>{node}</FocusProvider>
      </ResponsesProvider>
    </QueryClientProvider>,
  );
}

function lastPutBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = [...fetchMock.mock.calls].reverse().find(([url]) => String(url).includes("/api/items/"));
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe("VoiceInput — dictated text lands in the answer field and autosaves", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubSpeechRecognition();
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("splices the dictated transcript at the caret and saves it", async () => {
    renderWith(<QuestionCard itemId={ITEM_ID} />, textInit({ value: { text: "AB" }, status: "answered" }));

    const textarea = screen.getByPlaceholderText(/type your answer/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("AB");
    // Caret between "A" and "B"; the mic splices there like Attach file does.
    textarea.focus();
    textarea.setSelectionRange(1, 1);

    fireEvent.click(screen.getByRole("button", { name: /^voice input$/i }));
    MockRecognition.last!.emit([{ transcript: "spoken", isFinal: true }]);
    fireEvent.click(screen.getByRole("button", { name: /stop voice input and insert/i }));

    await waitFor(() => expect(textarea.value).toBe("AspokenB"));
    await waitFor(() => expect(lastPutBody(fetchMock).value.text).toBe("AspokenB"));
  });
});
