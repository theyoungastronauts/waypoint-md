import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The Anthropic SDK is always mocked: tests never reach the network.
const mock = vi.hoisted(() => ({
  text: "",
  fail: false,
  calls: 0,
  lastParams: null as unknown as { model: string; system: string; messages: Array<{ content: string }> },
}));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (params: typeof mock.lastParams) => {
        mock.calls++;
        mock.lastParams = params;
        if (mock.fail) throw new Error("upstream down");
        return { content: [{ type: "text", text: mock.text }] };
      },
    };
  }
  return { default: FakeAnthropic };
});

import { setupTestDb } from "@/test/db";
import { POST as postBrief } from "@/app/api/documents/[id]/voice/brief/route";
import { ingestDocument } from "@/lib/ingest/service";

const kitchenSink = readFileSync(
  path.resolve(process.cwd(), "packages/spec/fixtures/kitchen-sink.md"),
  "utf8",
);

const GOOD_OUTPUT = JSON.stringify({
  intro: "This is the RDS migration plan.",
  questions: [
    { number: 1, spoken: "Should we keep the bigger instance?", notes: [] },
    { number: 2, spoken: "How should v1 handle auth?", options: ["One shared token", "A token per device", "Tailscale only"] },
    { number: 3, spoken: "Which environments go first?", options: ["staging", "production", "dev"] },
  ],
  background: [],
});

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  mock.text = GOOD_OUTPUT;
  mock.fail = false;
  mock.calls = 0;
});

function post(docId: string) {
  return postBrief(new Request(`http://localhost/api/documents/${docId}/voice/brief`, { method: "POST" }), {
    params: Promise.resolve({ id: docId }),
  });
}

describe("POST /api/documents/:id/voice/brief", () => {
  it("answers 400 voice_unavailable without the OpenAI key, and never calls Claude", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const res = await post(id);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("voice_unavailable");
    expect(mock.calls).toBe(0);
  });

  it("answers 400 voice_unavailable without the Anthropic key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    expect((await post(id)).status).toBe(400);
  });

  it("404s an unknown document", async () => {
    expect((await post("nope")).status).toBe(404);
  });

  it("400s a document with no questions", async () => {
    const { id } = ingestDocument({ raw: "# Just prose\n", sourceType: "paste" });
    const res = await post(id);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("no_questions");
  });

  it("makes the brief on the first call and serves it from cache after", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });

    const first = await post(id);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.cached).toBe(false);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.brief.questions).toHaveLength(3);
    expect(body.brief.questions[1].options.map((o: { label: string }) => o.label)).toEqual([
      "Single shared token",
      "Per-device tokens",
      "Tailscale-only, no app auth",
    ]);
    expect(body.brief.questions[1].suggested).toEqual(["Tailscale-only, no app auth"]);
    expect(mock.lastParams.messages[0].content).toContain("Question 2 (choice, single):");
    expect(mock.calls).toBe(1);

    const second = await post(id);
    const cached = await second.json();
    expect(cached.cached).toBe(true);
    expect(cached.brief).toEqual(body.brief);
    expect(mock.calls).toBe(1);
  });

  it("does not cache an upstream failure (502 ai_error), so the next press retries", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    mock.fail = true;
    const res = await post(id);
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("ai_error");

    mock.fail = false;
    const retry = await post(id);
    expect(retry.status).toBe(200);
    expect((await retry.json()).cached).toBe(false);
  });

  it("502s ai_bad_output on unparseable model output", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    mock.text = "Sorry, I can't do that.";
    const res = await post(id);
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("ai_bad_output");
  });

  it("502s ai_bad_output on JSON of the wrong shape", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    mock.text = JSON.stringify({ questions: "nope" });
    expect((await post(id)).status).toBe(502);
  });
});
