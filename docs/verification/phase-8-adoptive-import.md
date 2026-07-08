# Phase 8 — Adoptive import (P5b) — Verification

**Verdict: PASS WITH WARNINGS.** Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write).

## Standing gates

typecheck PASS · lint PASS · test PASS (36 files, 320 tests) · build PASS (structure route present in output). `git diff packages/spec` is **empty** — the spec package is untouched this phase, so the #1 byte-fidelity invariant is unchanged and green.

## The trust boundary (model output is untrusted) — verified

Anchor validation is `rawMd.indexOf(proposal.anchor)` (verbatim substring); a miss → skipped + reported, never stored. Confirmed by route-level integration tests (real handler + real DB, mocked SDK):

- Fabricated anchor rejected with only the real item persisted.
- Near-miss (case/whitespace differs) hits the same rejection branch.
- Duplicates collapsed on (prompt + anchor); >40 proposals capped at MAX_PROPOSALS=40.
- Choice with <2 distinct options rejected.
- JSON in prose/fences extracted by `parseModelJson`; malformed JSON → 502 `ai_bad_output` with nothing stored.

## Synthetic never enters splice paths — verified (double-defensive)

`buildReviewState` skips `!wpId || synthetic` (review-state.ts:27); `renderReviewDocument` filters synthetic before the in-place walk. Synthetic items persist with `wp_id` NULL, span refs NULL, anchor JSON. No migration needed (schema carried `synthetic` + `anchor` from Phase 1).

## Export composition — verified live end-to-end

Synthetic items injected into live SQLite, answered + exported through the real PUT/GET routes:

- Unanswered synthetic → export byte-identical to source, no appended section.
- Answered → document body is a byte-faithful prefix; `## Waypoint responses` lists each item with its quoted anchor blockquote, text answer, choice `**Selected:** …` + elaboration, `_Flagged for follow-up._`, numbered and ordered by anchor offset. Matches the SPEC.md addition exactly.
- Conventioned doc (kitchen-sink) export === source, unaffected.

## Degradation / routing — live

`already_conventioned` 400 (wp: doc), `not_found` 404, `already_structured` 400 (second pass), upstream failure 502 `ai_error` with nothing stored. Affordance disappears once items exist. Synthetic cards render in a "Structured review" section with their source quotes. No-key path (400 `ai_unavailable` + affordance hidden) covered by mocked tests + `canOfferStructure` units. Auth middleware covers the new route by default.

## Executor deviations — judged acceptable

1. **Dedicated "Structured review" section vs in-place** — plan explicitly permits; in-place would split rendered prose at an arbitrary byte offset. UX cost minor: cards show their "From the document" quote and are ordered by anchor offset.
2. **Explain hidden on synthetic cards** — sound: chat context is built from `parseDocument(raw_md)`, which has no synthetic items; a focused synthetic id maps to wpId null → top-window fallback, so chat can't crash.
3. **One-pass-only** (`already_structured`) — consistent with the plan's "one pass."

## Warnings (non-blocking)

- **W1 — no cleanup for a stray anchored item:** no item DELETE route and one-pass-only blocks a redo, so an anchored-but-useless proposed item is permanent in the review UI. It never contaminates the deliverable — unanswered synthetic items are excluded from export. Suggest per-item DELETE (or allow re-structure) later; not required by Phase 8 exit criteria.
- **W2 — live AI smoke still pending:** no real ANTHROPIC_API_KEY at review time (a leftover lead-probe dummy key was present and returned 401 from Anthropic; removed post-review). Degradation and structuring behavior are authoritatively covered by mocked tests. Same accepted posture as Phase 7.
