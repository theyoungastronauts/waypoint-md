# Phase 7 — AI sidebar chat (P5a) — Verification

**Verdict: PASS WITH WARNINGS.** Reviewer (fresh session), local Node v20.19.5 / pnpm 10.12.4. Reviewed the uncommitted working tree. `ANTHROPIC_API_KEY` absent at review time → the **live smoke is PENDING** (see Outstanding); the degradation path and every mock-verifiable behavior were exercised instead, per the ratified ANTHROPIC_API_KEY row ("never block on the key").

## Standing gates — all green

- **typecheck / lint:** clean (spec, cli, web). Engines warn (node>=22 vs v20.19.5) — the ratified expected state.
- **test:** **282 passed / 33 files** in ~2.9s. New this phase: chat SSE route (6), context windowing (9), settings API (4), model precedence (5), insert-into-answer (6), agent degradation RTL (3). The **jsdom/RTL addition did not slow or destabilize the suite** — only two files opt into `@vitest-environment jsdom`; total environment setup ~0.5s.
- **build:** Next standalone OK; `/settings` and `/api/documents/[id]/chat` compiled and behind Middleware.
- **#1 non-negotiable:** Phase 7 does not touch `packages/spec`, ingest, or export. `apply.test.ts` + `invariants.test.ts` ran green inside the 282. Byte-fidelity holds.

## Client boundary — key cannot reach the browser (verified)

- No `anthropic`/`x-api-key`/`sk-ant`/`ANTHROPIC` markers in `.next/static` (client bundles). SDK code lives only in `.next/server/app/api/documents/[id]/chat/route.js`.
- `@anthropic-ai/sdk` is imported only in the server route handler; no `"use client"` file references anthropic or the key; **no `NEXT_PUBLIC_*` anywhere**.
- Capability is server-driven two ways, no client leak: SSR prop (`aiEnabled()` → `ReviewView`/`ItemCard`) **and** the health flag. Served `/d/:id` HTML (fake key) contains neither the key value nor `anthropic`.
- Chat and settings routes are **auth-covered** — caught by the middleware matcher, not in `OPEN_PATHS`; only `/api/health` + login stay open.

## Degradation end-to-end (no key) — clean

Live standalone server, open mode, no key. Loud no-auth startup warning fired.
- `GET /api/health` → `aiEnabled:false`.
- `POST /api/documents/:id/chat` → **400 `ai_unavailable`** (GET too); nothing streamed or persisted.
- SSR `/d/:id`: **no `role="tab"` tablist, no "Explain" button, no chat panel** — while the review UI itself renders fully (Download annotated, cards, prose present). Phases 1–6 intact.
- Fake key → affordances render: tablist + "Explain" present in SSR; `aiEnabled:true`; key still absent from HTML.

## Model precedence + persistence — verified live

On a real server with `WAYPOINT_MODEL=claude-opus-4-8`:
- No settings row → `source:env`, `model:claude-opus-4-8`.
- `POST /api/settings {model: fable}` → `source:settings`, `model:claude-fable-5` (wins over env).
- `POST {model:"gpt-4o"}` → **400** (closed offer set; only the 3 ratified choices).
- **Restart the server (env still opus) → `model:claude-fable-5`, `source:settings`.** Persistence wins over env across a restart — the exact scenario the plan calls out. Unknown/stale settings value falls through to env/default (guard `isKnownModel`, unit-tested).

## Model IDs — verified against the live citation

Fetched `https://platform.claude.com/docs/en/about-claude/models/overview`. All three IDs in `lib/ai/models.ts` match the live Claude API ID column exactly: `claude-sonnet-5` (default), `claude-opus-4-8`, `claude-fable-5`. **Nothing else hardcodes a model ID** — grep for `claude-` across `apps/web`+`packages` returns only `models.ts` and tests. The one-line-correction property from §RISK-4 holds.

## Context assembly (cost posture) — windowing verified at the boundary

Pure module, directly tested. A throwaway boundary probe (removed) confirmed the `<= SMALL_DOC_CHARS` (6000) branch precisely: **exactly 6000 chars → whole doc** (`windowed:false`, `## Full document`); **6001 chars → windowed** (`## Section around the focused item`); **over-threshold + no focus → leading excerpt** (`## Document excerpt (start)`). Existing tests also cover the huge-single-section clamp (≈1200 before / 2400 after, `…` cut markers) and that a distant section is dropped. A large doc is **never shipped wholesale** — confirmed. The always-present compact item index preserves whole-doc awareness cheaply.

## SSE robustness + the persist/discard decision — sound

- Cancel test passes: read until first delta, cancel like a disconnecting client, and the partial the reviewer saw **is persisted**; `rejections` array empty → **no unhandled rejection**. The upstream error listener (`stream.on("error", () => {})`) plus the `for await` catch are what prevent it.
- **DECISION judged — I agree with it:** partial **persisted on client cancel** (the reviewer already saw that text; a reload should match the UI) / partial **discarded on upstream error** (may be truncated mid-token/malformed). Both branches guard `if (assistantText)`, so no empty assistant row is written; the client also filters an empty assistant bubble. Coherent and defensible.

## Chat persistence — correct, with one ordering bug (W2 below)

One thread per document (keyed by `document_id`, no thread id), turns in `chat_messages`, oldest-first. Route persists the user turn up front (survives reload), then feeds the last 20 messages to the model. GET returns the persisted thread. All good **except** the window-ordering edge case in W2.

## Warnings (non-blocking, but fix before the live smoke)

**W1 — Repo-root `.env` is NOT loaded in standalone/production mode (only in dev).**
`instrumentation.ts` → `loadRepoEnv()` probes `../../.env` and `./.env` relative to `process.cwd()`. In `next dev` cwd is `apps/web`, so `../../.env` = repo-root `.env` ✓. But the **standalone** `server.js` does `process.chdir(__dirname)` → cwd becomes `.next/standalone/apps/web`, so both candidates miss the repo root. **Verified live:** with a valid key placed *only* in a repo-root `.env` and the standalone server started without the env var, `GET /api/health` returned **`aiEnabled:false`**. This directly contradicts the executor's stated intent ("check this fires in production standalone mode too"). Mitigation that keeps it a WARN not a FAIL: Docker/compose passes `ANTHROPIC_API_KEY` through real `process.env` (so containerized deploys are unaffected), and the ratified requirement literally says "load it in dev." But a desktop user running the standalone build (§16's recommended "run on a home box") with the key in a repo-root `.env` would silently lose AI. **Fix:** resolve the repo root by walking up from `__dirname`/cwd to the `pnpm-workspace.yaml` marker (or add candidates up the tree) rather than assuming a fixed depth. File: `apps/web/lib/env.ts`.

**W2 — History window can start with an `assistant` turn after 10+ exchanges → real Anthropic API 400.**
`route.ts` builds history as `listChatMessages(id).slice(-HISTORY_MESSAGES)` (20) after appending the user turn. With strict user/assistant alternation, once a thread exceeds 10 completed exchanges the 20-message window begins on an **assistant** message (simulated: POST #11 onward, `window[0].role === "assistant"`). The Messages API requires the first message to use the `user` role, so a real key would return 400 on long single-document threads. The mocked SDK ignores ordering, so tests are green; the PENDING live smoke wouldn't catch it unless someone runs 11+ turns. (Cancel/error turns that persist a user with no assistant also make consecutive same-role messages — those the API merges, so only the *leading-assistant* case is a hard error.) **Fix (trivial):** after slicing, drop leading non-user messages, e.g. `while (history.length && history[0].role !== "user") history.shift();`. File: `apps/web/app/api/documents/[id]/chat/route.ts` (~line 112).

## Executor deviations — judged

- **New deps** (`@anthropic-ai/sdk`, `dotenv`, `@testing-library/react`+`dom`, `jsdom`, vitest JSX config): Accept. Suite stayed fast; JSX runtime set to automatic matches Next.
- **Capability on SSR prop + health flag, no separate bootstrap endpoint:** Accept — simpler, both server-driven, no client leak. Good call.
- **Settings honored only for known models while `WAYPOINT_MODEL` is trusted verbatim:** Accept and verified. Lets an operator pin a newer model via env without a code change while guarding a stale/hand-edited settings row; matches §14.
- **System-prompt document context + `max_tokens: 2048`, no prompt caching in v1:** Accept for v1. Context rides in `system`, messages carry only turns (so first-message-role matters — see W2). Caching is a later cost optimization, out of scope.
- **Partial-persist-on-cancel semantics:** Accept (see SSE section).
- **Repo-root `.env` via `instrumentation.ts`:** Accept the approach; the standalone-cwd gap is W1.

## Outstanding

- **PENDING — live streamed round-trip smoke.** No `ANTHROPIC_API_KEY` at review time. When a key lands, run one real chat round-trip against a running server: stream a reply, insert-into-answer on the focused item, Explain from a card, and switch models in `/settings`. **W2 makes an 11+-turn thread the most valuable smoke case**, and **W1 means the smoke must pass the key via real env (or fix W1 first)** — a repo-root `.env` alone won't enable AI on the standalone server.

## Run summary

- Gates: typecheck ✓ · lint ✓ · test ✓ (282/33) · build ✓ — all on Node 20.19.5.
- Live probes on the standalone server (throwaway HOME/data dir, torn down; ports 3517–3520 cleared): degradation (no key), affordances (fake key), model precedence across restart, unknown-model rejection, repo-root `.env` standalone gap (W1), key-not-in-HTML.
- Static/bundle grep: no key or SDK in client output.
- Model IDs cross-checked against the live docs page.
- Working tree left unchanged (temp `.env` and probe test removed; no stray artifacts). **Did not commit or stage** — the lead commits.
