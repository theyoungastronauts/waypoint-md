import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callerNumber, SeenWebhooks, sipHeader, verifyWebhook } from "@/lib/voice/phone/webhook";

const keyBytes = Buffer.from("a-test-signing-key-32-bytes-long!!");
const secret = `whsec_${keyBytes.toString("base64")}`;
const now = 1_800_000_000;

function sign(id: string, ts: number, body: string, key = keyBytes) {
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

describe("verifyWebhook", () => {
  const body = '{"type":"realtime.call.incoming"}';

  it("accepts a correctly signed webhook", () => {
    const v = verifyWebhook(secret, { id: "wh_1", timestamp: String(now), signature: sign("wh_1", now, body) }, body, now);
    expect(v).toEqual({ ok: true, id: "wh_1" });
  });

  it("accepts when any of several rotated signatures matches", () => {
    const sig = `v1,bm90IGl0 ${sign("wh_1", now, body)}`;
    expect(verifyWebhook(secret, { id: "wh_1", timestamp: String(now), signature: sig }, body, now).ok).toBe(true);
  });

  it("rejects a tampered body, a wrong key, and a different id", () => {
    const sig = sign("wh_1", now, body);
    expect(verifyWebhook(secret, { id: "wh_1", timestamp: String(now), signature: sig }, body + " ", now)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    const other = sign("wh_1", now, body, Buffer.from("some-other-key-entirely-here!!!!!"));
    expect(verifyWebhook(secret, { id: "wh_1", timestamp: String(now), signature: other }, body, now).ok).toBe(false);
    expect(verifyWebhook(secret, { id: "wh_2", timestamp: String(now), signature: sig }, body, now).ok).toBe(false);
  });

  it("rejects stale and future timestamps (replay window)", () => {
    for (const ts of [now - 301, now + 301]) {
      const v = verifyWebhook(secret, { id: "wh_1", timestamp: String(ts), signature: sign("wh_1", ts, body) }, body, now);
      expect(v).toEqual({ ok: false, reason: "stale_timestamp" });
    }
  });

  it("rejects missing headers and non-v1 schemes", () => {
    expect(verifyWebhook(secret, { id: null, timestamp: String(now), signature: "x" }, body, now)).toEqual({
      ok: false,
      reason: "missing_headers",
    });
    const v0 = sign("wh_1", now, body).replace("v1,", "v0,");
    expect(verifyWebhook(secret, { id: "wh_1", timestamp: String(now), signature: v0 }, body, now).ok).toBe(false);
  });
});

describe("SeenWebhooks", () => {
  it("acts on an id once and forgets the oldest past its bound", () => {
    const seen = new SeenWebhooks(2);
    expect(seen.firstTime("a")).toBe(true);
    expect(seen.firstTime("a")).toBe(false);
    seen.firstTime("b");
    seen.firstTime("c");
    expect(seen.firstTime("a")).toBe(true);
  });
});

describe("SIP header parsing", () => {
  it("reads headers from an array or a map, case-insensitively", () => {
    expect(sipHeader([{ name: "From", value: "x" }], "from")).toBe("x");
    expect(sipHeader({ FROM: "y" }, "From")).toBe("y");
    expect(sipHeader(undefined, "From")).toBeNull();
  });

  it("takes the caller number from the SIP URI, ignoring the display name", () => {
    expect(callerNumber('"+19999999999" <sip:+16045550100@pstn.twilio.com>;tag=abc')).toBe("+16045550100");
    expect(callerNumber("sip:16045550100@sip.example.com")).toBe("+16045550100");
    expect(callerNumber("<tel:+16045550100>")).toBe("+16045550100");
    expect(callerNumber("sip:anonymous@anonymous.invalid")).toBeNull();
    expect(callerNumber(null)).toBeNull();
  });
});
