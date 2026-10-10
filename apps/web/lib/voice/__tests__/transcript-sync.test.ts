import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLUSH_INTERVAL_MS, TranscriptSync } from "@/lib/voice/transcript-sync";
import type { TranscriptEntry } from "@/lib/voice/transcript";

const entry = (text: string): TranscriptEntry => ({ role: "reviewer", at: "t", text });

let fetchMock: ReturnType<typeof vi.fn>;
const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TranscriptSync", () => {
  it("batches entries and PATCHes them to the session", async () => {
    const sync = new TranscriptSync("s1", fetchMock as unknown as typeof fetch);
    sync.push(entry("a"));
    sync.push(entry("b"));
    await sync.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/voice-sessions/s1");
    expect(bodies()[0]).toEqual({ append: [entry("a"), entry("b")] });
  });

  it("sends nothing when there is nothing to send", async () => {
    const sync = new TranscriptSync("s1", fetchMock as unknown as typeof fetch);
    await sync.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flushes on an interval once started", async () => {
    vi.useFakeTimers();
    const sync = new TranscriptSync("s1", fetchMock as unknown as typeof fetch);
    sync.start();
    sync.push(entry("a"));
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await sync.close("ended");
  });

  it("puts a failed batch back and sends it with the next one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    const sync = new TranscriptSync("s1", fetchMock as unknown as typeof fetch);
    sync.push(entry("a"));
    await sync.flush();
    sync.push(entry("b"));
    await sync.flush();
    expect(bodies()[1]).toEqual({ append: [entry("a"), entry("b")] });
    warn.mockRestore();
  });

  it("closes with the end status and keepalive, then ignores further entries", async () => {
    const sync = new TranscriptSync("s1", fetchMock as unknown as typeof fetch);
    sync.push(entry("last"));
    await sync.close("submitted");
    expect(bodies()).toEqual([{ status: "submitted", append: [entry("last")] }]);
    expect((fetchMock.mock.calls[0][1] as RequestInit).keepalive).toBe(true);

    sync.push(entry("late"));
    await sync.close("ended");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops keepalive for a final body too large for it", async () => {
    const sync = new TranscriptSync("s1", fetchMock as unknown as typeof fetch);
    for (let i = 0; i < 20; i++) sync.push(entry("x".repeat(5_000)));
    await sync.close("ended");
    expect((fetchMock.mock.calls.at(-1)![1] as RequestInit).keepalive).toBe(false);
  });

  it("records the style immediately", async () => {
    const sync = new TranscriptSync("s1", fetchMock as unknown as typeof fetch);
    await sync.setMode("thorough");
    expect(bodies()).toEqual([{ mode: "thorough" }]);
  });
});
