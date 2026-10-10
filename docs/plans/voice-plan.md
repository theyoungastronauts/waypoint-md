# Waypoint Voice (browser prototype) — Implementation Plan

**Source:** `~/tybrain/projects/waypoint-voice-brainstorm.md` and its digest. All product decisions are taken from there and are not revisited here.

Worktree `~/prj/waypoint-wt-voice`, branch `feat/voice`. Dev server on port 3130 against a throwaway data dir. The main checkout serves production; nothing is built or migrated there. Standing gates after every phase: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. `packages/spec`, the digest and `waypoint pull` do not change.

## Realtime facts (checked against developers.openai.com on 2026-10-09)

- Model `gpt-realtime-2.1` (the mini variant is weaker at function calling). Voice `marin`, `semantic_vad`, input transcription `gpt-4o-mini-transcribe`.
- Short-lived key: `POST https://api.openai.com/v1/realtime/client_secrets` with `{ expires_after: { anchor: "created_at", seconds }, session: { type: "realtime", model, instructions, tools, audio: {...} } }`; the key is `value`, expiry `expires_at` (unix seconds). Default TTL 600 s.
- WebRTC: data channel `oai-events`, then `POST https://api.openai.com/v1/realtime/calls` with `Authorization: Bearer <ek_…>`, `Content-Type: application/sdp`, body = offer SDP; the answer SDP is the response text. No beta header.
- Tool calls arrive on `response.done` (`output[].type == "function_call"`, `name`, `call_id`, `arguments`). Results go back as `conversation.item.create` (`function_call_output`) then `response.create`. User transcript: `conversation.item.input_audio_transcription.completed`; assistant transcript: `response.output_audio_transcript.done`.
- Cost estimate (full model): about $0.03–0.065 per minute, about $0.40 for a typical 10-minute call, plus about $0.003/min transcription.

## Phases

1. **Schema and capability gate.** Migration 0005: `voice_briefs` (document id, cache key, model, brief JSON) and `voice_sessions` (document id, mode, transcript JSON, status, timestamps). `voiceEnabled()` needs both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`; health reports `voiceEnabled`.
2. **Voice brief.** `POST /api/documents/:id/voice/brief` returns the cached brief or has Claude (the existing `resolveModel()`) write one: each question rewritten for listening, spoken option labels mapped to the real labels, background notes from `wp:rationale` and nearby prose. Untrusted output: zod-validated, item ids and labels checked against the document. Cache key = hash of `raw_md` + the item set + the brief format version.
3. **Session key.** `POST /api/documents/:id/voice/session` builds the interviewer instructions from the brief, defines the tools, mints a client secret and creates a `voice_sessions` row. Instructions and tools are fixed for the call (cache hits).
4. **Tool executor (browser).** `next_question`, `go_to_question`, `record_answer`, `flag`, `skip`, `lookup`, `whats_left`, `submit_review`. Writes go through the review page's response store, i.e. the same `PUT /api/items/:id/response` as tapping or typing. Choice answers must resolve to a real option or the tool returns the options so the model asks again. `submit_review` is the same `PATCH status: completed` as "Mark completed".
5. **Call UI.** `useRealtimeCall` (mic, peer connection, data channel, SDP exchange, teardown on hang-up and unmount), a Talk button and a call panel (status, current question, captions, hang up). Transcript saved as the call goes.
6. **Transcript on the review page.** A "Voice calls" panel and `GET /api/documents/:id/voice/sessions`.
7. **Live verification.** Needs both keys. Smoke test on :3130, then the success test: a real 5–8 question review answered eyes-off, digest matches intent.
