# Phase 9 — Digest export + keyboard nav (P6a) — Verification

**Verdict: PASS WITH WARNINGS.** Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write).

## Standing gates

typecheck PASS · lint PASS · test PASS (38 files, 353 tests) · build PASS. Spec invariants intact (byte-fidelity + round-trip fixtures all green).

## Hands-on (real standalone server, open mode, aiEnabled=false; CLI via built dist)

1. **Kitchen-sink digest, known review state — meets the §11 bar.** An agent could act on it without the source: fixed-order frontmatter counts, Q→A pairs with per-item type+status, choice **Selected:**/**Note:**, flagged item carried. Matches SPEC §9.1/§9.2/§9.3 line-by-line.

2. **Digest consistency guarantee** (derived from applyReview→parseDocument) — verified in code AND probed live:
   - Cleared draft (Phase 6 W1 sentinel): digest shows `### q1 · text · untouched` + `**A:** _(no answer)_` — NOT the resurrected draft. Annotated agrees. The two cannot disagree.
   - Comments-only doc: clean Comments section, no spurious Questions.
   - Untouched doc: pre-filled draft + checked boxes read as answered (answered:3, untouched:0). Intended — the embedded state IS the answer until a reviewer overrides. Concur.

3. **CLI `pull --digest`** (real server, real push): writes BOTH `plan.review.md` and `plan.digest.md` beside source, clears the pointer, marks doc `pulled`. Plain pull issues no digest fetch. Fetch-before-writes ordering verified in code: both exports awaited before the first writeFileSync; markPulled/clearPointer only after writes — a digest fetch failure aborts cleanly with zero partial state.

4. **Keyboard** (unit + code): resolveKeyAction / nextFocusId / isEditableTarget well-covered (clamping, null/unknown recovery, input guard, modifier guard). ⌘⏎ scoping judged CORRECT: marks answered from answer fields and non-editable focus, deliberately inert in the agent chat textarea (which sends on Enter — an unscoped ⌘⏎ would double-fire). j/k/f/x/a/? inert while typing in ANY input; never fire with Cmd/Ctrl/Alt held. `?` legend desktop-only. No bare-printable IME hazard (composition only occurs inside editable surfaces, which the guard suppresses).

## Warning (low severity, non-blocking)

**W1 — Digest `**Q:**` prompt pollution for a comment anchored INSIDE a wp:question block.** A comment whose `exact` matches text within a question prompt splices after the prompt paragraph (inside the question span); the digest's re-parse folds the raw `<!-- wp:comment -->` HTML into promptMd. Not reachable via the UI (question prompts have no selection affordance) — requires a hand-crafted authenticated API request. Information is preserved (the comment also appears correctly in `## Comments`). Suggested defensive fix (Phase 10 candidate): strip `<!-- wp:... -->` comments from promptMd/answer text in the digest renderer, or keep comment splices out of question blocks.

## Minor observations

- Synthetic `## Structured responses` digest section is unit-tested only (no key → adoptive import off live). Live synthetic-digest pending for a keyed env — consistent with the run's degradation posture.
- SPEC §9.3 is silent on multi-line `**Comment:**`/`**Suggestion:**` values; a one-line clarification that any `**Label:**` at line-start is a field boundary would remove parser ambiguity.

## Remaining browser-only (for the Phase 10 Playwright smoke)

Actual document-level keydown dispatch end-to-end, scroll-into-view on focus change, ⌘⏎ preventing a newline in a live answer textarea, the `?` legend toggle at the lg breakpoint, and `a` revealing the agent (mobile sheet).
