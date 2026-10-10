import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Claude is mocked (the brief); OpenAI is mocked via a stubbed global fetch.
const mock = vi.hoisted(() => ({ claudeCalls: 0 }));
vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async () => {
        mock.claudeCalls++;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ intro: "RDS plan.", questions: [{ number: 1, spoken: "Keep the big instance?" }] }),
            },
          ],
        };
      },
    };
  }
  return { default: FakeAnthropic };
});

import { setupTestDb } from "@/test/db";
import { POST as postSession } from "@/app/api/documents/[id]/voice/session/route";
import { GET as getVoiceSession, PATCH as patchVoiceSession } from "@/app/api/voice-sessions/[id]/route";
import { GET as listSessions } from "@/app/api/documents/[id]/voice/sessions/route";
import { ingestDocument } from "@/lib/ingest/service";
import { CLIENT_SECRETS_URL, REALTIME_MODEL } from "@/lib/voice/realtime";
import { MAX_TRANSCRIPT_ENTRIES } from "@/lib/voice/transcript";
import { updateVoiceSession } from "@/lib/voice/sessions";
import { updateDocument } from "@/lib/documents";

const kitchenSink = readFileSync(
  path.resolve(process.cwd(), "packages/spec/fixtures/kitchen-sink.md"),
  "utf8",
);

const fetchMock = vi.fn();

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "sk-openai-secret");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ value: "ek_short_lived", expires_at: 1_900_000_000, session: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  mock.claudeCalls = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function start(docId: string) {
  return postSession(new Request(`http://localhost/api/documents/${docId}/voice/session`, { method: "POST" }), {
    params: Promise.resolve({ id: docId }),
  });
}

function patch(sessionId: string, body: unknown) {
  return patchVoiceSession(
    new Request(`http://localhost/api/voice-sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
}

function get(sessionId: string) {
  return getVoiceSession(new Request(`http://localhost/api/voice-sessions/${sessionId}`), {
    params: Promise.resolve({ id: sessionId }),
  });
}

describe("POST /api/documents/:id/voice/session", () => {
  it("answers 400 voice_unavailable without the OpenAI key and never calls out", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const res = await start(id);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("voice_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mock.claudeCalls).toBe(0);
  });

  it("mints a short-lived key with the session baked in, and never returns the real key", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const res = await start(id);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.clientSecret).toBe("ek_short_lived");
    expect(body.expiresAt).toBe(1_900_000_000);
    expect(body.model).toBe(REALTIME_MODEL);
    expect(body.callsUrl).toBe("https://api.openai.com/v1/realtime/calls");
    expect(body.brief.questions).toHaveLength(3);
    expect(typeof body.sessionId).toBe("string");
    expect(JSON.stringify(body)).not.toContain("sk-openai-secret");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CLIENT_SECRETS_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer sk-openai-secret");
    const sent = JSON.parse(init.body);
    expect(sent.expires_after).toEqual({ anchor: "created_at", seconds: 600 });
    expect(sent.session.type).toBe("realtime");
    expect(sent.session.model).toBe(REALTIME_MODEL);
    expect(sent.session.audio.output.voice).toBe("marin");
    expect(sent.session.audio.input.turn_detection).toEqual({ type: "semantic_vad" });
    expect(sent.session.tools.map((t: { name: string }) => t.name)).toContain("record_answer");
    expect(sent.session.instructions).toContain('"RDS Migration Plan"');
    expect(sent.session.instructions).toContain("brief or thorough");
  });

  it("reuses the cached brief on a second call", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    await start(id);
    await start(id);
    expect(mock.claudeCalls).toBe(1);
  });

  it("502s voice_upstream when OpenAI refuses, without leaking the upstream body", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    fetchMock.mockResolvedValueOnce(new Response("{\"error\":\"bad key sk-openai-secret\"}", { status: 401 }));
    const res = await start(id);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("voice_upstream");
    expect(JSON.stringify(body)).not.toContain("sk-openai-secret");
  });

  it("502s voice_upstream when the network fails", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect((await start(id)).status).toBe(502);
  });

  it("502s voice_upstream on an unexpected response shape", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ nope: true }), { status: 200 }));
    expect((await start(id)).status).toBe(502);
  });
});

describe("PATCH /api/voice-sessions/:id", () => {
  async function newSession(): Promise<string> {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    return (await (await start(id)).json()).sessionId;
  }

  async function completeDocumentOf(sessionId: string): Promise<void> {
    const documentId = (await (await get(sessionId)).json()).session.documentId;
    updateDocument(documentId, { status: "completed" });
  }

  it("appends transcript entries across calls and records the style", async () => {
    const sid = await newSession();
    await patch(sid, {
      append: [{ role: "voice", at: "2026-10-09T00:00:00Z", text: "Brief or thorough?" }],
    });
    const res = await patch(sid, {
      mode: "brief",
      append: [
        { role: "reviewer", at: "2026-10-09T00:00:01Z", text: "Brief." },
        { role: "tool", at: "2026-10-09T00:00:02Z", name: "set_style", args: "{\"style\":\"brief\"}", result: "{\"ok\":true}" },
      ],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).session).toMatchObject({ status: "active", mode: "brief", entries: 3 });

    const full = (await (await get(sid)).json()).session;
    expect(full.transcript.map((e: { role: string }) => e.role)).toEqual(["voice", "reviewer", "tool"]);
  });

  it("refuses submitted while the document is not completed (409)", async () => {
    const sid = await newSession();
    const res = await patch(sid, { status: "submitted" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("not_submitted");
  });

  it("keeps submitted when a later hang-up reports ended", async () => {
    const sid = await newSession();
    await completeDocumentOf(sid);
    expect((await patch(sid, { status: "submitted" })).status).toBe(200);
    const res = await patch(sid, { status: "ended" });
    const { session } = await res.json();
    expect(session.status).toBe("submitted");
    const full = (await (await get(sid)).json()).session;
    expect(full.submittedAt).toBeTruthy();
    expect(full.endedAt).toBeTruthy();
  });

  it("marks a hang-up without submit as ended", async () => {
    const sid = await newSession();
    const { session } = await (await patch(sid, { status: "ended" })).json();
    expect(session.status).toBe("ended");
  });

  it("rejects malformed entries and unknown fields", async () => {
    const sid = await newSession();
    expect((await patch(sid, { append: [{ role: "admin", at: "x", text: "hi" }] })).status).toBe(400);
    expect((await patch(sid, { status: "active" })).status).toBe(400);
    expect((await patch(sid, { transcript: [] })).status).toBe(400);
  });

  it("404s an unknown session", async () => {
    expect((await patch("nope", { status: "ended" })).status).toBe(404);
    expect((await get("nope")).status).toBe(404);
  });

  it("drops entries past the ceiling instead of failing", async () => {
    const sid = await newSession();
    const entry = { role: "voice" as const, at: "t", text: "x" };
    updateVoiceSession(sid, { append: Array.from({ length: MAX_TRANSCRIPT_ENTRIES - 1 }, () => entry) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await patch(sid, { append: [entry, entry, entry] });
    expect(res.status).toBe(200);
    expect((await res.json()).session.entries).toBe(MAX_TRANSCRIPT_ENTRIES);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("GET /api/documents/:id/voice/sessions", () => {
  it("lists a document's calls with transcripts, even with voice switched off", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const sid = (await (await start(id)).json()).sessionId;
    await patch(sid, { append: [{ role: "reviewer", at: "t", text: "hello" }], status: "ended" });

    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await listSessions(new Request(`http://localhost/api/documents/${id}/voice/sessions`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const { sessions } = await res.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: sid, status: "ended", transcript: [{ role: "reviewer", text: "hello" }] });
  });

  it("404s an unknown document", async () => {
    const res = await listSessions(new Request("http://localhost/api/documents/nope/voice/sessions"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });
});
