# UX Round 1 — Phase 4 (elaboration split — wp:rationale, SPEC 1.1.0) — Verification

**Verdict: PASS.** Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write). The reviewer's non-blocking note #1 (misplaced-rationale boundary) was hardened by the lead pre-commit.

## Gates (independently re-run)

`pnpm test`: 514 passed (58 files), incl. 52 invariants. typecheck/lint clean. CLI suite 42 passed.

## Adversarial byte-fidelity probes (reviewer's own, 13/13, against the built spec)

- **Empty-review identity** `applyReview(raw,{}) === raw`: every bundled fixture (loader-driven — kitchen-sink + all no-rationale) plus three hand-built docs (rationale-only, rationale+answer, rationale-with-fake-option). All byte-identical.
- **Rationale survives a real review**: flipped the selection (checkbox sits immediately before the block), wrote elaboration, set status, stamped reviewed_at — the `wp:rationale…/wp:rationale` slice is byte-identical afterward and re-parses to the same `item.rationale`. Confirmed on both rationale docs.
- **Options-boundary tightening**: a rationale whose prose contains `- [ ]`/`- [x]` lines → parser returns only the two real options; the fake checkboxes are inert; a flip touches only the real markers and leaves rationale prose byte-identical.
- **Malformed rationale**: rationale-outside-question, duplicate-rationale, orphan-close, unclosed → warn (never throw), doc stays byte-identical under an empty review; all four warning codes wired and emitted.
- **Round-trip**: `extractReviewState(parseDocument(applyReview(raw, state)))` recovers state exactly; re-applying is a no-op; `item.rationale` is stable across the cycle.

## Other checks

- **Text vs choice defaulting (§5.2 intact):** `initialDraft` gates the empty seed on `item.type === "choice"` only — text questions still prefill their `wp:answer` draft; the persisted-response branch still restores `other` for any type. Covered by initial-draft.test.ts.
- **Phase 2/3 regression:** suggestion-insert and attach-file operate on the live draft (getDraft/saveContent), not the initial seed, so the empty-seed change doesn't touch them — suggestion-card/attach-file/insert/caret-insert suites green.
- **Digest:** author `**Why:**` (from `item.rationale`) distinct from reviewer `**Note:**` (from `response.other`); SPEC §9.3 grammar updated, both multi-line/boundary-terminated. `item.rationale` is independent of any response, so overriding the pick can't alter Why (examples.md shows an overridden Selected with the author's Why intact).
- **handshake.ts:** 1.0.0→1.1.0 bump is behavior-neutral (major-only compare); a consistency fix keeping the version string accurate. CLI tests pass.
- **SPEC.md:** 1.1.0, changelog, `wp:rationale` documented optional/additive/back-compatible ("parses byte-for-byte as under 1.0.0"). authoring.md + examples.md teach it.

## Judgment calls — sound

Options-scan stopping at the rationale offset (strictly tightens the boundary); handshake bump (harmless); digest Why multi-line (§9.3 updated).

## Non-blocking notes

1. **Misplaced rationale (after wp:answer)** — HARDENED by the lead pre-commit. The reviewer noted `optionsBoundary = rationaleOpen.start` could loosen past the answer for that malformed layout. Applied the reviewer's suggested `Math.min(rationaleOpen?.start ?? Infinity, boundary)` so a well-placed rationale still tightens the scan while a misplaced one can never loosen it; added a regression probe (`a misplaced rationale … never loosens the options scan past the answer`). Byte-fidelity held either way.
2. **Migration caveat (release note):** a pre-1.1.0 choice doc that carried reviewer elaboration in `wp:answer` (not yet persisted in the DB) will now show an empty box on load — the intended split (B-2); the persisted store covers the in-system case.
3. **Doc-numbering drift (pre-existing):** spec-code comments cite §5.3 while SPEC.md numbers the block §3 — the code follows its own long-standing internal scheme; not introduced here.

## Notes for Phase 5

- Same byte-fidelity invariant applies (attachments additive; body export unchanged; `applyReview` untouched) — reuse this probe shape.
- The rationale block sits inside the `wp:question` spans; Phase 5's `wp:answer`-interior reference-line append (B-4) must target `answerInterior` and must NOT disturb `rationaleInterior` — add an explicit probe that a doc with BOTH a rationale and an exported attachment reference keeps rationale bytes intact.
- `initialDraft`'s choice empty-seed is now load-bearing for the paste UI — Phase 5's thumbnail chips attach to the live response/draft; confirm they don't reintroduce seeding from `embedded.other` on choice items.
