import WebSocket from "ws";
import { draftToBody, initialDraft, type Draft } from "@/components/review/types";
import { getDocumentDetail, updateDocument } from "@/lib/documents";
import { buildSyntheticInits, renderReviewDocument } from "@/lib/render/review";
import { upsertResponse } from "@/lib/responses";
import type { InterviewStore } from "../interview";
import { getOrCreateBrief } from "../make-brief";
import { findLatestLiveDocument, findLiveDocumentByPin, LIVE_STATUSES } from "../phone-pins";
import { REALTIME_MODEL } from "../realtime";
import { createVoiceSession, updateVoiceSession } from "../sessions";
import { PhoneCall, type OpenedReview } from "./call";
import { lobbySessionConfig } from "./lobby";

/**
 * The production wiring for phone calls (Waypoint Voice, phone): OpenAI call
 * control, the sideband socket, and an {@link InterviewStore} over the database.
 * Kept apart from `call.ts` so the call logic is tested with fakes and this file
 * stays a thin layer of real I/O.
 */

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const SIDEBAND_URL = "wss://api.openai.com/v1/realtime";

/** Live calls by OpenAI call id, so a redelivered webhook never starts a second runtime. */
const activeCalls = new Map<string, PhoneCall>();

export function activeCallCount(): number {
  return activeCalls.size;
}

async function control(apiKey: string, callId: string, action: "accept" | "reject" | "hangup", body?: unknown) {
  const res = await fetch(`${CALLS_URL}/${encodeURIComponent(callId)}/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${action} failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
}

/** Decline a call that isn't allowed (603 Decline: no ringing, no voicemail prompt). */
export function rejectCall(apiKey: string, callId: string): Promise<void> {
  return control(apiKey, callId, "reject", { status_code: 603 });
}

/**
 * Answer an allowed call into the lobby and start driving it over the sideband.
 * Accept comes first: the docs open the sideband only once the call is accepted.
 */
export async function answerCall(apiKey: string, callId: string): Promise<void> {
  if (activeCalls.has(callId)) return;
  try {
    await control(apiKey, callId, "accept", lobbySessionConfig());
  } catch (err) {
    // Don't leave the caller ringing until it times out.
    await rejectCall(apiKey, callId).catch(() => {});
    throw err;
  }

  const socket = new WebSocket(`${SIDEBAND_URL}?call_id=${encodeURIComponent(callId)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const call = new PhoneCall({
    callId,
    socket,
    findByPin: findLiveDocumentByPin,
    findLatest: findLatestLiveDocument,
    openReview: openPhoneReview,
    hangup: () => control(apiKey, callId, "hangup"),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => new Date().toISOString(),
    log: (m) => console.info(m),
  });
  activeCalls.set(callId, call);
  socket.on("close", () => activeCalls.delete(callId));
}

/**
 * Prepare a review for a phone interview: its voice brief (made now or cached),
 * the drafts exactly as the review page would show them, and a call record.
 */
export async function openPhoneReview(documentId: string): Promise<OpenedReview> {
  const detail = getDocumentDetail(documentId);
  if (!detail) throw new Error(`document ${documentId} not found`);
  // Re-checked here: the review may have been finished since the caller picked it.
  if (!(LIVE_STATUSES as readonly string[]).includes(detail.status)) {
    throw new Error(`document ${documentId} is ${detail.status}, not open for review`);
  }
  const { brief } = await getOrCreateBrief(detail);

  // The same drafts the review page starts from: persisted answer, else the
  // draft embedded in the document.
  const { segments } = renderReviewDocument(detail.rawMd, detail.items);
  const inits = [
    ...segments.filter((s) => s.kind === "item"),
    ...buildSyntheticInits(detail.items),
  ];
  const drafts = new Map<string, Draft>();
  const types = new Map<string, "text" | "choice">();
  for (const init of inits) {
    drafts.set(init.itemId, initialDraft(init));
    types.set(init.itemId, init.item.type);
  }

  const session = createVoiceSession(documentId, REALTIME_MODEL);
  console.info(`[phone] review ${documentId} opened as voice session ${session.id}`);

  const store: InterviewStore = {
    getDraft: (itemId) => drafts.get(itemId) ?? { text: "", selected: [], other: "", status: null },
    // The function behind the autosave PUT — the same draft-save path as the page.
    writeDraft: (itemId, draft) => {
      const type = types.get(itemId);
      if (!type) throw new Error(`item ${itemId} is not on this review`);
      drafts.set(itemId, draft);
      const body = draftToBody(type, draft);
      upsertResponse(itemId, body.value, body.status);
    },
    submit: async () => {
      if (!updateDocument(documentId, { status: "completed" })) throw new Error("the review no longer exists");
    },
    setStyle: (mode) => {
      updateVoiceSession(session.id, { mode });
    },
    endCall: () => {},
  };

  return {
    brief,
    store,
    answeredBefore: [...drafts.entries()]
      .filter(([, d]) => d.status === "answered" || d.status === "skipped")
      .map(([id]) => id),
    record: (entries) => {
      if (entries.length > 0) updateVoiceSession(session.id, { append: entries });
    },
    close: (status) => {
      updateVoiceSession(session.id, { status });
    },
  };
}
