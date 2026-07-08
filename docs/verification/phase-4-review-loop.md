# Phase 4 — Interactive review + annotated export (P2b) — Verification

**Verdict:** PASS WITH WARNINGS

**Reviewer:** reviewer agent (fresh session) · **Date:** 2026-07-07 · **Scope:** the uncommitted Phase 4 working tree
**Environment:** local Node v20.19.5 shell (no `nvm`), pnpm 10.12.4 — the ratified gate machine

This phase completes the ratified P2 exit: a full file-first review loop with zero CLI. I ran the standing gates, read the implementation end-to-end, and exercised a real production server hands-on (ingest → answer everything → export → diff → re-parse). The core contract holds under live testing. Four warnings are real but v1-acceptable; none breaks a spec invariant or the export contract.

---

## Standing gates (Node 20 shell) — all green

| Gate | Result |
|---|---|
| `pnpm typecheck` | Done (spec, cli, web) |
| `pnpm lint` | Done (no errors) |
| `pnpm test` | 155 passed / 17 files, incl. 42 spec-invariant tests |
| `pnpm build` | Done (Next standalone; all routes compiled) |

The engines warning (`wanted node>=22, current v20.19.5`) is the ratified, expected state — it warns, it does not fail. The #1 non-negotiable (`applyReview(raw,{}) === raw` and round-trip) is covered by `packages/spec/src/invariants.test.ts` (42 tests over all fixtures) and stayed green.

---

## Hands-on verification (real server, throwaway data dir, port 3111)

### 1. Clean-diff feature (§2 goal 3) — verified against the kitchen-sink fixture

Ingested `packages/spec/fixtures/kitchen-sink.md` via the paste door (stored `raw_md` sha256 == source sha256), then answered **every** item via `PUT /api/items/:id/response` covering all shapes:

- **q1 (text)** — free-text answer + status `flagged`
- **q2 (single)** — one selection + elaboration + status `answered`
- **q3 (multi)** — two selections + status `skipped`

`diff -u source export` produced **exactly** three kinds of change and nothing else:
1. frontmatter stamp (`waypoint_status: completed`, `reviewed_at: …`)
2. checkbox `[x]`/`[ ]` flips inside the two choice blocks
3. `wp:answer` interior text + `status="…"` attribute on the answer opens

Intro prose, the closing "should never be touched" line, all prompts, and every `wp:` comment tag were byte-untouched. This is the clean-diff guarantee working in practice, not just in unit tests.

### 2. Untouched-doc export is byte-identical (§17 item 4)

Fresh ingest, immediate export with no responses: `sha256(source) == sha256(export)` (`9f099596…13605` both sides). No frontmatter stamp on empty review state. Confirmed via `applyReview` returning source unchanged and the export route not forcing a stamp.

### 3. Round-trip recovery (§17.4) — `parseDocument(export)` recovers submitted state exactly

Ran `extractReviewState(parseDocument(export))` against the answered kitchen-sink export and `assert.deepStrictEqual`'d it to the submitted responses (status folded into value): **deep-equal true**. q1/q2/q3 text, selections, elaboration, and statuses (`flagged`/`answered`/`skipped`) all recovered. The frontmatter stamp fields do not leak into recovered responses.

### 4. Choice semantics (§5.3, ratified) — all four requirements met

- `select="single"` → radio group; `select="multi"` → checkboxes (SSR page: 3 radios for q2, 3 checkboxes for q3).
- Always-visible elaboration field maps to `wp:answer` (present on every choice card).
- **Text-only response accepted:** using `choice-text-only.md`, submitted `{selected:[], other:"…"}`. Export left all boxes `[ ]`, wrote the elaboration into `wp:answer status="answered"`, and it round-tripped as `{status:"answered", other:"…"}` — a text-only response **counts as answered**.

### 5. Draft pre-fill (Phase 3 handoff) — embedded answer renders with zero persisted rows

`choice-text-only.md` carries an embedded elaboration. After ingest, `getDocumentDetail` returns `response: null` for that item (**no responses row**), while the client seeds the draft from `item.response` (the parsed embedded answer). First edit issued a `PUT` that **created** the row. Confirmed the seam in `components/review/types.ts:initialDraft` (persisted → embedded → empty) and observed the row appear post-edit.

### 6. The four handoffs — all correct

| Handoff | Verified |
|---|---|
| `reviewedAt` stamped on non-empty export only | `lib/review-state.ts` passes `reviewedAt` always; `applyReview` stamps only when responses/comments present. Untouched export unstamped (see §2). |
| Cards init from embedded response | `initialDraft` seeds from embedded when no persisted row (see §5). |
| `getDocumentDetail` scoped via `inArray` + empty-items guard | `lib/documents.ts:269-273` — `itemIds.length > 0 ? inArray(...) : []`. Cross-doc isolation test in `export.test.ts` passes; no whole-table scan. |
| PATCH `archived` → 400 + schema comment fixed | `app/api/documents/[id]/route.ts:36-41` zod `.refine` rejects `archived`; live PATCH returned **400 invalid_request**; new regression test added in `documents.test.ts`. |

### 7. PATCH transition matrix (live)

`pending` initial → answering leaves it `pending` (no auto-advance, see W4) → `PATCH in_review` 200 → `PATCH archived` **400** → `PATCH completed` 200 → `PATCH bogus` **400**. Completion flow (`CompletionSummary`) PATCHes to `completed` correctly.

### 8. SSR smoke + server log

`/d/[id]` server-rendered 32 KB with 3 textareas, 3 radios, 3 checkboxes, and the export button — no crash. Server log across all probes: **zero** errors/warnings (only the benign `next start`/standalone notice). No dangling references to the deleted Phase 3 components (`document-view`, `inert-item-card`).

### 9. Autosave (code-verified; browser timing left to a human pass)

`use-debounced-callback.ts` coalesces text edits into **one PUT per 800 ms window** (latest args win) and `flush`es on blur so the last keystroke is never dropped; checkbox clicks save immediately (discrete actions). The saved-tick is honest: `onError → "error"` (never `"saved"`), and the draft is **never rolled back** — `dispatch({kind:"commit"})` keeps the draft and `onError` only sets the tick. TanStack `mutations.retry: 2` gives transient blips two retries. See W3 for the one race edge.

---

## Executor deviations — judged on the merits

1. **Extended Phase 3's segmentation seam instead of a new remark plugin.** `renderReviewDocument` reuses `renderDocument`'s byte-span slice (prose runs vs. item blocks) and swaps the item renderer for live cards. **Accept.** The plan's "custom remark plugin" was a suggested implementation; the requirement ("cards render in-place, prose stays prose") is met, and export fidelity is entirely the spec-package splice — the render path can't affect it. One theoretical display edge (see the note below).

2. **No auto `pending → in_review` transition; `in_review` reachable via PATCH only.** **Accept with a warning (W4).** The plan does not mandate the auto-transition, and not advancing on the first keystroke is defensible. But it leaves the queue's `in_review` bucket unreachable from the Phase 4 UI.

3. **Choice labels render plain-text in live cards (vs. markdown in Phase 3's inert cards).** **Accept with a warning (W2).** Judged against `choice-formatted-labels.md`: labels like `` `waypoint-md` ``, `**@usepolaris/waypoint**`, and `[see the naming issue](url)` render as literal source text — and a label that is a link is no longer clickable. A minor regression from Phase 3; export is unaffected (labels are matched by source string for byte-fidelity).

4. **Cleared-draft edge — emptying a pre-filled draft resurrects it on export.** **Accept with a warning (W1), documented below.** No explicit-empty sentinel in v1.

5. **Full-width layout relaxation.** Root `main` is now full-width; pages self-constrain (`queue`/`new` → `max-w-3xl`, review → `max-w-6xl`). **Accept.** Reasonable to fit the document + right-rail.

6. **No jsdom/RTL component tests — API-level + manual smoke instead.** **Accept for this phase's risk profile.** The load-bearing logic (status derivation, review-state assembly, export, upsert, round-trip) is pure and well unit-tested (`review-status.test.ts`, `review-state.test.ts`, `export.test.ts`, `responses.test.ts`). The untested surface is React glue (debounce wiring, optimistic tick, focus/scroll, bottom sheet) — exactly the browser-only checks I'm handing off below. A Playwright pass is already scoped for Phase 10.

---

## Findings

### WARN-1 — Cleared-draft resurrection (product golden-path edge)
Emptying a pre-filled `wp:answer` to fully blank persists `{}`/`{selected:[]}`, which `buildReviewState` treats as empty (`responseIsEmpty`) and drops from the review state. `applyReview` then leaves the answer interior untouched — so **the original embedded suggestion reappears in the export** and the frontmatter stays unstamped. Verified live with `choice-text-only.md`: after clearing, the export still contained "…staying on DynamoDB for now."

Why it matters: the product's core loop is "review agent-*generated* markdown." Rejecting a bad suggestion by deleting it is on the golden path, and that rejection is silently lost. It is defensible that "blank == untouched," and the workaround is trivial (type any character), so this is **v1-acceptable** — but it should be an explicit, documented limitation.
*Suggested fix:* persist an explicit-empty sentinel so `applyReview` can splice an empty interior, distinguishing "cleared" from "never touched." Document in `docs/SPEC.md` known-limitations either way. `apps/web/lib/review-state.ts:24-37`, `packages/spec/src/parse.ts:342` (`responseIsEmpty`).

### WARN-2 — Choice option labels render as plain text
`components/review/choice-group.tsx:71` emits `<span>{option.label}</span>` verbatim. Inline markdown in labels is shown literally and label-links are not clickable — a regression from Phase 3's inert cards.
*Suggested fix:* render labels through the existing sanitized inline-markdown pipeline (the label source is already available; the sanitizer already exists). Low effort, restores parity.

### WARN-3 — Autosave last-write race / saved-tick honesty (low risk)
A debounced text/elaboration save and an immediate checkbox save for the **same item** can be in flight together. `saveContent` merges against the store draft at call time, so the later-*issued* PUT carries the fully merged state — but if the two requests complete out of order at the server, the server can retain a stale value while the tick shows "Saved" (client draft still shows the newer value; a reload would reveal the loss). Requires request reordering on same-origin fetches; for a single-user local tool the probability is low.
*Suggested fix:* serialize per-item saves (drop/replace an in-flight save for the same item, or tag with a monotonic sequence and ignore stale responses). `components/review/responses-store.tsx:139-162`.

### WARN-4 — No auto `pending → in_review`; queue bucket unreachable from the UI
Answering never advances the document past `pending`; `in_review` is only settable via `PATCH`. The queue dashboard's `in_review` group therefore never populates through normal Phase 4 use.
*Suggested fix:* advance to `in_review` on first non-empty answer, or document that `in_review` is CLI/API-driven (Phase 5 pull sets `pulled`; decide who sets `in_review`). `components/review/review-view.tsx`, `app/api/documents/[id]/route.ts`.

### NOTE — segmentation seam display edge (non-blocking)
Because prose runs between `wp:` blocks are parsed independently, a reference-style link/footnote whose definition sits in a different prose run than its use won't resolve on screen. Rare authoring pattern; export is unaffected. Worth a line in a future rendering-limitations note, not a fix now.

### NOTE — `waypoint_status: completed` is always the stamp value (Phase 2, out of scope)
A non-empty export stamps `waypoint_status: completed` regardless of the DB document status (e.g., a doc left `pending` with flagged items still exports `completed`). This is ratified §11 spec behavior from Phase 2, surfaced here only for awareness.

---

## Exit criteria (plan.md Phase 4) — met

- File-first loop with zero CLI: import → answer text + choice (incl. text-only on a choice) → flag/skip → progress → mark completed → download annotated `.md`. ✔ (API + SSR verified; full desktop+phone click-through is the browser hand-off.)
- Untouched-doc export byte-identical. ✔ (sha256)
- Standing gates + all spec invariants pass. ✔

## Browser-only checks left outstanding (for a human/browser pass)

These are not verifiable from code/API and are **not** claimed as passing:

1. **Mobile bottom sheet** — open/close, tap-an-item scroll-and-focus, touch-target sizing on a real narrow viewport (§2 goal 4).
2. **Devtools-offline mid-edit** — confirm the optimistic draft survives, the tick shows "Not saved — retrying", and reconciliation on reconnect (retry: 2) lands the answer without a false "Saved". (Code path looks correct; the actual offline→online behavior needs a browser.)
3. **Autosave timing in-browser** — one PUT per 800 ms window in practice, plus the W3 race.
4. **Rail interactions** — click-to-scroll smooth focus, focus-ring highlight, and radio/checkbox keyboard + screen-reader semantics.
5. **Visual severity of W2** — how bad the literal-markdown labels look in situ.

---

**Verdict: PASS WITH WARNINGS.** The ratified P2b exit is met and proven hands-on — the clean-diff feature, byte-fidelity, §17.4 round-trip, choice semantics, draft pre-fill, and all four Phase 3 handoffs behave exactly as specified, on a real server, with a clean log and green gates including every spec invariant. The four warnings (cleared-draft resurrection, plain-text labels, autosave race, no auto in_review) are genuine and worth follow-ups, but each is a bounded, v1-acceptable gap that leaves the export contract and the invariants intact. No blockers.
