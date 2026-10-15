import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The call runtime is mocked: this file tests the gate, not the call.
const runtime = vi.hoisted(() => ({ answerCall: vi.fn(async () => {}), rejectCall: vi.fn(async () => {}) }));
vi.mock("@/lib/voice/phone/runtime", () => runtime);
// `after()` runs its callback once the response is sent; run it inline here.
const afterTasks = vi.hoisted(() => [] as Array<() => Promise<void>>);
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<void>) => afterTasks.push(fn) };
});

import { POST } from "@/app/api/voice/phone/webhook/route";

const key = Buffer.from("webhook-signing-key-for-tests-0123");
const SECRET = `whsec_${key.toString("base64")}`;
let seq = 0;

function signed(body: unknown, opts: { secret?: Buffer; id?: string; ts?: number } = {}) {
  const raw = JSON.stringify(body);
  const id = opts.id ?? `wh_${++seq}`;
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", opts.secret ?? key).update(`${id}.${ts}.${raw}`).digest("base64");
  return new Request("http://localhost/api/voice/phone/webhook", {
    method: "POST",
    headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` },
    body: raw,
  });
}

const incoming = (from: string, callId = "rtc_abc") => ({
  object: "event",
  type: "realtime.call.incoming",
  data: {
    call_id: callId,
    sip_headers: [
      { name: "From", value: from },
      { name: "To", value: "sip:+17785550000@sip.api.openai.com" },
    ],
  },
});

async function runAfter() {
  while (afterTasks.length) await afterTasks.shift()!();
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("OPENAI_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("WAYPOINT_PHONE_ALLOWLIST", "+1 604 555 0100");
  runtime.answerCall.mockClear();
  runtime.rejectCall.mockClear();
  afterTasks.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/voice/phone/webhook", () => {
  it("answers a call from an allowlisted number", async () => {
    const res = await POST(signed(incoming('"Tyler" <sip:+16045550100@pstn.twilio.com>;tag=1')));
    expect(res.status).toBe(200);
    await runAfter();
    expect(runtime.answerCall).toHaveBeenCalledWith("sk-test", "rtc_abc");
    expect(runtime.rejectCall).not.toHaveBeenCalled();
  });

  it("declines a call from any other number, even with an allowlisted display name", async () => {
    await POST(signed(incoming('"+16045550100" <sip:+19995550123@pstn.twilio.com>')));
    await runAfter();
    expect(runtime.rejectCall).toHaveBeenCalledWith("sk-test", "rtc_abc");
    expect(runtime.answerCall).not.toHaveBeenCalled();
  });

  it("declines a call with no usable caller id", async () => {
    await POST(signed(incoming("sip:anonymous@anonymous.invalid")));
    await runAfter();
    expect(runtime.rejectCall).toHaveBeenCalled();
  });

  it("401s a bad signature and does nothing", async () => {
    const res = await POST(signed(incoming("sip:+16045550100@x"), { secret: Buffer.from("wrong-key-wrong-key-wrong-key-0000") }));
    expect(res.status).toBe(401);
    await runAfter();
    expect(runtime.answerCall).not.toHaveBeenCalled();
    expect(runtime.rejectCall).not.toHaveBeenCalled();
  });

  it("401s a replayed (stale) webhook", async () => {
    const res = await POST(signed(incoming("sip:+16045550100@x"), { ts: Math.floor(Date.now() / 1000) - 3600 }));
    expect(res.status).toBe(401);
  });

  it("acts on a redelivered webhook only once", async () => {
    await POST(signed(incoming("sip:+16045550100@x"), { id: "wh_same" }));
    const again = await POST(signed(incoming("sip:+16045550100@x"), { id: "wh_same" }));
    expect((await again.json()).duplicate).toBe(true);
    await runAfter();
    expect(runtime.answerCall).toHaveBeenCalledTimes(1);
  });

  it("acknowledges other event types without acting", async () => {
    const res = await POST(signed({ type: "realtime.call.ended", data: {} }));
    expect((await res.json()).ignored).toBe("realtime.call.ended");
    await runAfter();
    expect(runtime.answerCall).not.toHaveBeenCalled();
  });

  it("404s while calling in is not set up", async () => {
    vi.stubEnv("WAYPOINT_PHONE_ALLOWLIST", "");
    const res = await POST(signed(incoming("sip:+16045550100@x")));
    expect(res.status).toBe(404);
  });
});
