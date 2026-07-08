import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Anthropic SDK regardless of key presence (§14 test requirement). The
// fake stream yields scripted text deltas and can "hold" mid-stream so a client
// cancel can be exercised deterministically.
const mock = vi.hoisted(() => ({
  config: { chunks: ["Hello", " world"] as string[], holdAfterIndex: -1 },
  lastParams: null as unknown as { model: string; system: string; messages: unknown[] },
}));

vi.mock("@anthropic-ai/sdk", () => {
  function makeFakeStream(config: { chunks: string[]; holdAfterIndex: number }) {
    let aborted = false;
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    return {
      get aborted() {
        return aborted;
      },
      on() {
        return this;
      },
      abort() {
        aborted = true;
        release();
      },
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < config.chunks.length; i++) {
          yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: config.chunks[i] } };
          if (config.holdAfterIndex >= 0 && i === config.holdAfterIndex) {
            await held;
            if (aborted) {
              const err = new Error("aborted");
              err.name = "AbortError";
              throw err;
            }
          }
        }
      },
    };
  }
  class FakeAnthropic {
    // A default constructor accepts (and ignores) the `{ apiKey }` the route passes.
    messages = {
      stream: (params: { model: string; system: string; messages: unknown[] }) => {
        mock.lastParams = params;
        return makeFakeStream(mock.config);
      },
    };
  }
  return { default: FakeAnthropic };
});

import { setupTestDb } from "@/test/db";
import { GET as getChat, POST as postChat } from "@/app/api/documents/[id]/chat/route";
import { listChatMessages } from "@/lib/chat";
import { getDocumentDetail } from "@/lib/documents";
import { ingestDocument } from "@/lib/ingest/service";

const kitchenSink = readFileSync(
  path.resolve(process.cwd(), "packages/spec/fixtures/kitchen-sink.md"),
  "utf8",
);

let cleanup: () => void;
const rejections: unknown[] = [];
const onRejection = (r: unknown) => rejections.push(r);

beforeAll(async () => {
  cleanup = await setupTestDb();
  process.on("unhandledRejection", onRejection);
});
afterAll(() => {
  process.off("unhandledRejection", onRejection);
  cleanup?.();
});

const KEY = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-test-key";
  mock.config = { chunks: ["Hello", " world"], holdAfterIndex: -1 };
  rejections.length = 0;
});
afterEach(() => {
  if (KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = KEY;
});

function post(docId: string, body: unknown) {
  return postChat(
    new Request(`http://localhost/api/documents/${docId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: docId }) },
  );
}

function get(docId: string) {
  return getChat(new Request(`http://localhost/api/documents/${docId}/chat`), {
    params: Promise.resolve({ id: docId }),
  });
}

/** Drain an SSE response body into {full, done, error}. */
async function drain(res: Response): Promise<{ full: string; done: boolean; error: string | null }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let done = false;
  let error: string | null = null;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const ev = parseFrame(frame);
      if (ev?.event === "delta") full += ev.data.text ?? "";
      else if (ev?.event === "done") done = true;
      else if (ev?.event === "error") error = ev.data.message ?? "error";
    }
  }
  return { full, done, error };
}

function parseFrame(frame: string): { event: string; data: { text?: string; message?: string } } | null {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("POST /api/documents/:id/chat", () => {
  it("streams deltas and persists both the user and assistant turns", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });

    const res = await post(docId, { message: "What is this doc about?" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const { full, done } = await drain(res);
    expect(full).toBe("Hello world");
    expect(done).toBe(true);

    const thread = listChatMessages(docId);
    expect(thread.map((m) => [m.role, m.content])).toEqual([
      ["user", "What is this doc about?"],
      ["assistant", "Hello world"],
    ]);

    // The request carried the resolved model + assembled document context.
    expect(mock.lastParams.model).toBe("claude-sonnet-5");
    expect(mock.lastParams.system).toContain("Document context");
  });

  it("scopes context to the focused item and includes prior history", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const focusedItemId = getDocumentDetail(docId)!.items[0].id;

    await drain(await post(docId, { message: "first" }));
    await drain(await post(docId, { message: "second", focusedItemId }));

    // History window ends with the latest user turn; both turns are present.
    const roles = (mock.lastParams.messages as Array<{ role: string; content: string }>).map((m) => m.role);
    expect(roles).toContain("assistant"); // the first turn's reply is in history
    expect((mock.lastParams.messages as Array<{ content: string }>).at(-1)?.content).toBe("second");
  });

  it("history window never starts with an assistant turn (W2 regression)", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });

    // 11 exchanges = 22 rows; slice(-20) would start mid-exchange on an
    // assistant message, which the Messages API rejects with a 400.
    for (let i = 0; i < 11; i++) {
      await drain(await post(docId, { message: `turn ${i}` }));
    }

    const messages = mock.lastParams.messages as Array<{ role: string; content: string }>;
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].role).toBe("user");
    expect(messages.at(-1)?.content).toBe("turn 10");
  });

  it("GET returns the persisted thread", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    await drain(await post(docId, { message: "hi" }));

    const res = await get(docId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toMatchObject({ role: "user", content: "hi" });
  });

  it("404s for an unknown document (with a key set)", async () => {
    const res = await post("no-such-doc", { message: "hi" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("degrades cleanly when no API key is set — POST and GET both 400", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });

    const res = await post(docId, { message: "hi" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("ai_unavailable");

    const g = await get(docId);
    expect(g.status).toBe(400);
    // Nothing was streamed or persisted.
    expect(listChatMessages(docId)).toHaveLength(0);
  });

  it("persists the partial assistant turn on a client cancel — no unhandled rejection", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    mock.config = { chunks: ["Partial answer"], holdAfterIndex: 0 };

    const res = await post(docId, { message: "cancel me" });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read until the first delta arrives, then cancel like a disconnecting client.
    let buf = "";
    let sawPartial = false;
    while (!sawPartial) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      if (buf.includes("Partial answer")) sawPartial = true;
    }
    expect(sawPartial).toBe(true);
    await reader.cancel(); // triggers the route's stream cancel() → upstream abort

    // The partial the reviewer saw is persisted (documented behavior), and no
    // promise was left unhandled.
    let assistant: string | undefined;
    for (let i = 0; i < 30 && assistant === undefined; i++) {
      await sleep(20);
      assistant = listChatMessages(docId).find((m) => m.role === "assistant")?.content;
    }
    expect(assistant).toBe("Partial answer");
    await sleep(20);
    expect(rejections).toEqual([]);
  });
});
