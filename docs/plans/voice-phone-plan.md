# Waypoint Voice — phone number: implementation plan

**Source:** [voice-phone-spec.md](voice-phone-spec.md) and its digest (Tyler, 2026-10-15). Decisions are not revisited here.

Worktree `~/prj/waypoint-wt-voice`, branch `feat/voice-phone`. Same gates after each phase: typecheck, lint, test, build. Nothing deploys without Tyler's go; avoid deploying while a call is live (Q11: no guard).

## Decisions (from the review)

| # | Decision |
|---|---|
| Q1 | Twilio Elastic SIP Trunking, used only as a number that forwards to OpenAI. No Twilio code. |
| Q2 | A local Canadian number. |
| Q3 | PIN by keypad or spoken. |
| Q4 | 4-digit PIN. |
| Q5 | Caller-ID allowlist (Tyler's number) plus the document PIN. Log Twilio's carrier verification header on first calls. |
| Q6 | PIN shown on the review page next to Talk, and in `waypoint push` output. |
| Q7 | Every document with questions gets a PIN; it stops working once the review is completed, pulled or superseded (archived). |
| Q8 | "Press 0 or say latest" opens the most recent pending review, after confirming its title. Full menu later. |
| Q10 | Waypoint-only; no extra effort spent on reuse. |
| Q11 | No deploy guard. |

## Technical shape

- Call flow: Twilio → `sip:proj_…@sip.api.openai.com;transport=tls` → OpenAI fires `realtime.call.incoming` to `POST /api/voice/phone/webhook` (public via the review tunnel, signature-verified) → allowlist check → `POST /v1/realtime/calls/{id}/accept` with a lobby session (final voice set here; it can't change later) → server opens the sideband `wss://api.openai.com/v1/realtime?call_id=…` → lobby takes the PIN (DTMF `input_audio_buffer.dtmf_event_received` or spoken via a tool) → `session.update` swaps in the document's interview instructions and tools → the existing `Interview` executor runs server-side against the database.
- Server-side store: drafts built exactly as the review page builds them (`renderReviewDocument` + `buildSyntheticInits` + `initialDraft`), writes through `upsertResponse` (the function behind the autosave PUT), submit through `updateDocument(status: completed)`.
- Transcript: same `voice_sessions` record and format, written server-side.
- Node 20 in production has no global WebSocket, so the sideband uses the `ws` package.

## Phases

1. **PINs.** `documents.phone_pin` (migration), assigned at ingest to documents with questions, unique among live documents; boot-time backfill for live documents; lookup only matches pending/in_review. Shown next to Talk and returned by the push API; the CLI prints it.
2. **Webhook.** Standard Webhooks signature check with `OPENAI_WEBHOOK_SECRET`, replay window, dedupe on `webhook-id`; allowlist from `WAYPOINT_PHONE_ALLOWLIST`; reject or accept with the lobby config. Open path in middleware (exact match). `phoneEnabled()` gate.
3. **Call runtime.** Sideband client per call: lobby (DTMF digits, spoken PIN tool, latest shortcut, three misses then hang up), swap to the interview, server-side store, transcript, hang up after the goodbye via `POST /hangup`.
4. **Ops + live test.** Runbook for Twilio, the OpenAI webhook and the tunnel path; Tyler applies; first live call logs SIP headers.
