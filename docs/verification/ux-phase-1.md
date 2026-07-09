# UX Round 1 — Phase 1 (chat autoscroll + clear-selection) — Verification

**Verdict: PASS.** Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write).

## Gates

typecheck clean · lint clean · 11/11 tests green across scroll.test.ts, choice-group-clear.test.tsx, and agent-degradation.test.tsx (the regression suite that mounts AgentPanel). `git diff packages/` is empty — no `@waypoint/spec` or CLI changes, so byte-fidelity/round-trip invariants cannot regress from this phase.

## Autoscroll (#1)

- Pin math (scroll.ts): `scrollHeight - scrollTop - clientHeight < 50`, strict `<`. Boundary tested both directions — a gap of exactly 50 → NOT pinned; a fractional 0.5px gap at true bottom → pinned.
- The effect returns early unless `pinnedRef.current`, so no yank when scrolled up. `onScroll` recomputes pinned from live element metrics on every scroll, so scrolling up frees you and returning to the bottom re-arms follow. `pinnedRef` inits true → a fresh/resumed conversation follows from turn one. jsdom-safe `scrollTo?.` guard preserved. Using a ref (not state) is correct — no stale closure, no needless re-renders.
- No regression: jsdom's all-zero metrics read as pinned (0 < 50), so panel-mounting tests stay pinned (confirmed live via agent-degradation).

## Clear selection (#3)

- Button + caption render only when `selected.length > 0`, disappear on clear; applies to both single AND multi (keys off `selected.length`, calls `commitSelection([])` with no mode branch).
- Elaboration NOT wiped: `commitSelection([])` patches `{selected:[]}` only and does not bump `externalRev`, so the textarea's local state is never re-seeded.
- Status derivation via review-status.ts is correct: selection-only cleared → untouched (null); item with elaboration → stays answered. Flag/skip stickiness unaffected. The wire body sends `selected: []` explicitly for the splice writer. All three assertions in the test confirm this.

## Judgment: setFocused-on-clear — acceptable, leave as is

Picking sets focus (a directed action); clearing is a reset and shouldn't steal focus. The caption points the user to the elaboration box, whose `onFocus` sets focus on click. Forcing focus on a reset would be a surprising jump with no payoff.

## Browser-only / manual smoke

The real scroll gesture (scroll up mid-stream → no yank; return to bottom → follow resumes) is not exercisable in jsdom — only the pure predicate is unit-tested; the onScroll/effect wiring is browser behavior. A smoke item, not a gap.

## For later phases

- Phase 2's no-focus insert case can reuse the existing "Focus a question to insert" empty-state already in agent-panel.tsx (matches decision B-1).
- Phase 4 (spec → 1.1.0) enters with a clean baseline — nothing here touched packages/.
