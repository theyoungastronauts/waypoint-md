import { after, NextResponse } from "next/server";
import { getOpenAiKey, getPhoneAllowlist, getWebhookSecret, phoneEnabled } from "@/lib/voice/config";
import { answerCall, rejectCall } from "@/lib/voice/phone/runtime";
import { callerNumber, SeenWebhooks, sipHeader, verifyWebhook } from "@/lib/voice/phone/webhook";

export const dynamic = "force-dynamic";

const seen = new SeenWebhooks();

/**
 * POST /api/voice/phone/webhook — OpenAI's `realtime.call.incoming` webhook
 * (Waypoint Voice, phone). Public, because OpenAI calls it through the review
 * tunnel; the Standard Webhooks signature is the gate. Every call from a number
 * outside `WAYPOINT_PHONE_ALLOWLIST` is declined before anything is said
 * (decision Q5); an allowed call is answered into the lobby.
 *
 * Responds 200 at once and does the call control after the response, so
 * OpenAI is never left waiting on Waypoint.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = getWebhookSecret();
  const apiKey = getOpenAiKey();
  if (!secret || !apiKey || !phoneEnabled()) {
    return NextResponse.json({ error: { code: "phone_unavailable", message: "Calling in is not set up." } }, { status: 404 });
  }

  const rawBody = await req.text();
  const verdict = verifyWebhook(
    secret,
    {
      id: req.headers.get("webhook-id"),
      timestamp: req.headers.get("webhook-timestamp"),
      signature: req.headers.get("webhook-signature"),
    },
    rawBody,
  );
  if (!verdict.ok) {
    console.warn(`[phone] webhook rejected: ${verdict.reason}`);
    return NextResponse.json({ error: { code: "invalid_signature", message: "Invalid webhook." } }, { status: 401 });
  }
  if (!seen.firstTime(verdict.id)) return NextResponse.json({ ok: true, duplicate: true });

  let event: { type?: unknown; data?: { call_id?: unknown; sip_headers?: unknown } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Body was not JSON." } }, { status: 400 });
  }
  if (event.type !== "realtime.call.incoming") return NextResponse.json({ ok: true, ignored: event.type ?? null });

  const callId = typeof event.data?.call_id === "string" ? event.data.call_id : null;
  if (!callId) return NextResponse.json({ error: { code: "invalid_event", message: "No call id." } }, { status: 400 });

  const headers = event.data?.sip_headers as Parameters<typeof sipHeader>[0];
  const caller = callerNumber(sipHeader(headers, "From"));
  const allowed = caller !== null && getPhoneAllowlist().includes(caller);
  // Carrier caller-ID verification, logged on every call so Q5's check can be
  // tightened once real values are seen. Never the caller's number itself.
  const verstat = sipHeader(headers, "X-Twilio-VerStat") ?? "(none)";
  const pai = sipHeader(headers, "P-Asserted-Identity") ? "present" : "absent";
  console.info(
    `[phone] incoming ${callId} from ${allowed ? "an allowlisted number" : "an unknown number"} verstat=${verstat} p-asserted-identity=${pai}`,
  );

  after(async () => {
    try {
      if (allowed) await answerCall(apiKey, callId);
      else await rejectCall(apiKey, callId);
    } catch (err) {
      console.error(`[phone] call control for ${callId} failed:`, err);
    }
  });
  return NextResponse.json({ ok: true });
}
