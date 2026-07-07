# Phase 2 — Spec package (`@waypoint/spec`) (P1) — Verification

**Verdict:** PASS WITH WARNINGS (revised) — was FAIL in the first pass; blocker F-1 is now fixed and re-verified.
**Reviewer:** reviewer agent (fresh session, Node v20.19.5)
**Date:** 2026-07-07 (first pass) · 2026-07-07 (re-verification)
**Scope reviewed:** uncommitted working tree (`packages/spec/*`, `docs/SPEC.md`, `apps/web/next.config.ts`) against `plan.md` Phase 2 (tasks, exit criteria, verification notes), the "#1 non-negotiable", "Ratified decisions", and design refs `initial-plan.md` §5 (all subsections), §11, §17 items 1–3.

Nothing was committed or staged (per run rules).

> **Current status:** The single blocker (F-1) has been fixed and independently re-verified — see **"Re-verification"** immediately below. The two remaining WARNINGS are forward-looking handoff notes (Phase 4 `reviewedAt`, Phase 6 comment placement), not defects in the Phase 2 code. The FAIL narrative that follows is retained as a record of the original finding.

---

## Re-verification (2026-07-07) — F-1 fixed, verdict revised to PASS WITH WARNINGS

**The fix (`packages/spec/src/mdast.ts:82–108`):** the `listItem` handler now locates the checkbox by scanning the list item's **own source span** (`raw.slice(start, end)`) for the first `/\[[ xX]\]/`, independent of any child node offset. If no marker is found the option is skipped (never a corrupt span). The label is taken from just after the marker's `]`, bounded to the checkbox's own line so a multi-line item can't fold a following block into the label. This directly removes the root cause: the marker span can no longer become `"- ["` and the label can no longer swallow the `[ ] ` prefix.

**Gates (Node 20 shell):** all four green — `pnpm typecheck` / `lint` / `build` clean; `pnpm test` = **88 tests** (up from 76), `invariants.test.ts` = **42** (up from 33).

**New test coverage reviewed and confirmed genuine:**
- `fixtures/choice-formatted-labels.md` — single + multi choices with inline-code / bold / link / strikethrough leading labels.
- `parse.test.ts` — asserts the exact source-markdown labels and that every marker span slices to `^\[[ xX]\]$` (never `"- ["`).
- `apply.test.ts` — two flip tests proving the marker (not the bullet) is spliced; explicitly asserts the old `[ ]x]` mangle does not appear.
- `invariants.test.ts` "checkbox flips never corrupt the document (F-1 regression)" — programmatic over **all** fixtures: for each choice item it applies a **changed** selection (single → a different option; multi → inverted), then asserts label byte-stability, valid marker spans in the output, and round-trip. I verified this is **non-vacuous**: all 5 choice fixtures (`choice-formatted-labels`, `choice-multi-checked-single`, `choice-text-only`, `crlf`, `kitchen-sink`) produce a real checkbox-byte change under the forced flip — the exact gap that let F-1 slip through is now closed.

**Independent adversarial probes (all pass; then removed):**
- Exotic leading constructs beyond the fixtures — inline code, bold, italic, link, image, autolink, `***triple***`, raw HTML span, `~~strike~~`, `*`/`+`/indented bullets, capital `[X]` marker: every marker slices to a real checkbox, labels are byte-stable across a flip, no mangling, selection round-trips.
- The sharpest disambiguation case — a label that **is itself** a `[x](url)` link (so the line contains two `[x]` tokens): the parser correctly takes the **first** marker (the checkbox, only bullet+space precedes it), flips cleanly, and round-trips. Confirmed both flipping away from and onto such an option.
- Original F-1 repro (`- [x] \`waypoint-md\` is the pick` → switch selection): now yields `- [ ] \`waypoint-md\` is the pick` with the bullet intact and no `[ ]x]` residue.
- `initial-plan.md §20 q1` now parses to clean labels (`\`waypoint-md\` (matches …)`, no `[x]` prefix) and stays byte-identical under an empty review.
- Nested task list under a choice option: empty-review byte-fidelity holds and all markers remain valid after a flip.
- No regressions: empty-review byte-fidelity holds on all fixtures + hostile docs (CRLF, formatted labels, no-trailing-newline); fence-awareness and duplicate-id/malformed degradation intact.

**Remaining WARNINGS (forward handoff notes, not Phase 2 defects):**
1. **Phase 4:** the export path must pass `reviewedAt` (e.g. `new Date().toISOString()`) or exports carry no timestamp — `applyReview` is intentionally pure and will not invent one.
2. **Phase 6:** comment insertion granularity is the top-level block; a comment anchored inside a question **prompt** lands mid-question-block (still round-trips). Confirm placement is acceptable when real selection comments land.

**Revised verdict: PASS WITH WARNINGS.** The blocker is fully resolved, the fix is correct and complete across every leading-construct class I could construct, and the regression test genuinely protects the invariant going forward.

---

## First-pass finding (retained for the record — F-1 now fixed)

The original FAIL was driven by **one correctness defect** (F-1) in the choice-option parser that silently corrupted exported markdown on a common, realistic input class — including the project's own `initial-plan.md §20` example. The standing gates and the existing invariant suite were all green; the defect sat in a blind spot the fixtures and the round-trip test did not cover. Everything else in the phase was high quality and matched the plan.

---

## Standing gates (Node 20 shell, no `nvm use`)

All four pass; the only noise is the expected non-fatal engines warning (confirms `engine-strict=false`, so the no-`nvm` constraint holds).

| Gate | Result | Notes |
|---|---|---|
| `pnpm typecheck` | PASS | all 3 workspace projects "Done" |
| `pnpm lint` | PASS | all 3 projects clean |
| `pnpm test` | PASS | 7 files, **76 tests** (incl. `invariants.test.ts` **33 tests**) |
| `pnpm build` | PASS | `packages/spec` tsc + `apps/web` `next build` succeed (proves the `next.config.ts` extensionAlias makes TS-source consumption of the multi-file ESM package work) |

The green gates are real but **not sufficient**: see F-1 for why the invariants pass despite a byte-corrupting bug.

---

## BLOCKER

### F-1 — Choice-option label & checkbox-marker extraction is wrong whenever the option label begins with an inline markdown construct

**Where:** `packages/spec/src/mdast.ts:82–100` (the `visit(tree, "listItem", …)` block), specifically `labelStart` derived from `firstChild.position.start.offset` (line 87) and the marker fallback (lines 89–91).

**Root cause:** the code assumes the listItem's first child (a paragraph) starts *after* the `[ ] ` checkbox marker. That holds only when the option text begins with **plain text**. When the first inline node is a non-text construct — inline code, `**bold**`, `*italic*`, a link, `~~strike~~` — remark-gfm reports the paragraph's `position.start.offset` at the checkbox `[` itself. Confirmed at the `analyzeDocument` level:

```
plain-leading  -> label="plain words here"                 markerSlice="[ ]"   (correct)
code-leading   -> label="[ ] `code` then words"            markerSlice="- ["   (WRONG)
```

Because `labelStart` lands on `[`, `markerRegion = raw.slice(start, labelStart)` is just the bullet `"- "`, the `/\[[ xX]\]/` regex finds nothing, and `markerStart` falls back to the listItem start → the marker span becomes `"- ["` (bullet + space + opening bracket). The label likewise swallows the `[ ] ` prefix.

**Two distinct harms:**

1. **Parse-time (wrong data).** `item.options[].label` contains the `[ ] ` prefix and `response.selected` carries that garbage value. This propagates to the read-only doc view (Phase 3), the choice cards / radio-checkbox value matching (Phase 4), and the digest (Phase 9). Demonstrated on the repo's own doc: parsing `initial-plan.md §20 q1` yields `selected: ["[x] \`waypoint-md\` (matches the review.md energy, unambiguous)"]`.

2. **Write-time (byte corruption).** With the marker span pointing at `"- ["`, flipping the box splices `[x]`/`[ ]` over the bullet. Real reviewer flow — a `select="single"` question with a formatted option checked, reviewer switches to another option:

   ```
   source:   - [x] `waypoint-md` is the pick
   exported: [ ]x] `waypoint-md` is the pick      ← bullet destroyed, dangling `x]`
   ```

   This is invalid markdown and a direct violation of §11 ("modify only block interiors", clean diffs) and the §17.3 round-trip invariant.

**Blast radius:** every choice option whose label starts with inline code / bold / italic / link / strikethrough (probed: all fail; only plain-text-leading options are correct). Choice options that lead with `` `code` `` or `**bold**` are extremely common — the plan itself writes options that way.

**Why the green suite misses it (important for the fix):**
- The #1 non-negotiable `applyReview(raw, {}) === raw` is unaffected — the empty-review fast path returns `raw` untouched, so no fixture trips it.
- The round-trip invariant test (`invariants.test.ts:32–46`) re-applies the document's **own** extracted state. For a `select="single"` question the checked option is already in its desired state, so **no checkbox transition ever happens** and the broken marker span is never exercised; the garbage label is only ever compared against itself, so it round-trips "successfully." Verified: an already-`[x]` formatted option round-trips GREEN, yet changing the selection corrupts bytes.
- Every fixture uses **plain-text-leading** labels, so the case is never represented.

**Suggested fix direction (needs human judgment — not applied):**
- In the `listItem` handler, stop trusting the child paragraph's start offset. Instead locate the checkbox by scanning the listItem's own source (`raw.slice(start, end)`) for the first `/\[[ xX]\]/` after the bullet; set `markerStart` from that match and `labelStart` to the first non-space byte after the marker's `]`. That is robust to any leading inline construct.
- Add fixtures with formatted-leading choice labels (one inline-code-leading, one bold-leading), **and** extend the round-trip invariant to apply a selection that *differs* from the source (forcing a real checkbox flip). A fixture alone will not catch this — the test must exercise a state change.

---

## Executor deviations — judged on the merits

| # | Deviation | Judgment |
|---|---|---|
| 1 | `next.config.ts` webpack `extensionAlias` (`.js`→`.ts`) for TS-source consumption of the multi-file ESM package | **Accept.** Standard approach for consuming a `moduleResolution: Bundler` package from source in a monorepo; `pnpm build` proves it works. Alternative (consume from `dist/`) adds build-order coupling. Fine for v1. |
| 2 | Non-empty review on a **no-frontmatter** source **creates** a frontmatter block | **Accept.** It's the only way to record `waypoint_status`/`reviewed_at` when the source lacks frontmatter; empty review still returns byte-identical (verified). Honestly documented in `SPEC.md` §7. |
| 3 | Parser does **not** gate on `waypoint: 1`; `wp:` markers parse anywhere | **Accept — correct.** Required so `initial-plan.md §20` (wp markers, no doc frontmatter) parses — verified: all 5 questions parse, zero warnings, byte-fidelity holds. `SPEC.md` §1 documents the leniency honestly ("the parser does not require it"). |
| 4 | `ReviewState.reviewedAt` is caller-supplied (purity); absent → only `waypoint_status` stamped | **Accept — correct design.** Keeps `applyReview` a pure, deterministic function (the invariant tests depend on this). **HANDOFF NOTE for Phase 4:** the export endpoint must pass `reviewedAt` (e.g. `new Date().toISOString()`), or exports carry no timestamp. |
| 5 | Comment insertion granularity = top-level block | **Accept for Phase 2; Phase 6 watch item.** mdast splits a `wp:question` into several top-level blocks, so a comment anchored inside a question **prompt** lands *mid-question-block* (after the prompt paragraph, before the answer). It still round-trips cleanly (verified). Phase 6 (real selection comments) should confirm this placement is acceptable or insert after the whole question block. |
| 6 | FNV-1a 32-bit for `exact-hash` fallback | **Accept.** Only needs determinism + reasonable disambiguation, not security; the code says as much. |
| 7 | remark/unified deps flow into the web **server** bundle | **Accept.** Parsing is server-side only; the spec package is not imported by any client component in this phase. Watch item: if the parser is ever pulled into a client component, these deps would bloat the client bundle. |

---

## Adversarial probes run (beyond the existing suite)

All passed except the F-1 class. Highlights:

- **Byte-fidelity `applyReview(raw,{}) === raw`** on 12 hostile non-fixture docs: empty string, whitespace-only, no-trailing-newline, BOM prefix, all-CRLF, mixed LF/CRLF, tabs/trailing-spaces, wp-in-inline-code, wp-in-fence, unicode/emoji, comment lookalikes, pre-existing `waypoint_status` in frontmatter — **all byte-identical**.
- **Semantically-empty review states** (`{responses:{}}`, phantom empty response, whitespace-only text, empty `selected` array, empty comments array) — **all no-ops**.
- **Fence-awareness** variants (tilde fences, indented code, language-tagged fences) — fake `wp:` tags never parse; a real question after a fence parses.
- **Malformed** (duplicate ids, orphan closes, unclosed question/answer, suggestion-outside-comment) — warnings + still-usable parse, never throws.
- **Full non-empty round-trip** (text + single/multi selection + elaboration + statuses + comment-with-suggestion) — recovers state exactly (semantic compare; the parser emits `status` before `text`, which the suite's `.toEqual` correctly tolerates).
- **`initial-plan.md §20`** parses cleanly and is byte-identical under empty review.
- **Determinism / response-path idempotency** hold. (Note: re-applying a `comments` state to an *already-annotated* output double-inserts — expected and out-of-contract, since `applyReview` is defined against the immutable `raw_md`, never its own output.)
- **Minor observation (non-blocking):** a review whose `responses` reference only `wp_id`s absent from the doc still stamps the frontmatter (because `reviewIsEmpty` sees a non-empty response). Benign — cannot occur on the canonical path, where responses are keyed by items parsed from the same document.

---

## `docs/SPEC.md` review (§5 drift + implementation accuracy)

No drift from `initial-plan.md` §5, and it documents **actual** behavior honestly: first-checked-wins (§3), no-frontmatter leniency (§1), frontmatter creation on export (§7), the two invariants and the empty-review guarantee (§7), the full warning-code vocabulary (matches `types.ts` `WarningCode`), and the §5.4 caps (32/200 + `exact-hash`). Semver'd `1.0.0` per §4. **One gap tied to F-1:** §3 says "each option's **label** (its source-markdown text) is its stable value" — true only for plain-text-leading labels today; once F-1 is fixed the doc is accurate as written.

---

## Other checks

- **Invariant tests iterate ALL fixtures programmatically:** yes — `loadFixtures()` globs `fixtures/*.md`, and `invariants.test.ts:13–17` has a real count guard (`expect(fixtures.length).toBeGreaterThanOrEqual(8)`) that fails loudly if the glob ever matches nothing, so a future empty glob cannot make the per-fixture suites vacuously pass.
- **Splice ordering:** `applySplices` (`apply.ts:190–197`) sorts descending by `start` (then `end`), so an earlier edit never invalidates a later span. Splice regions are disjoint by construction (answer interior / checkbox markers / status attr / block-boundary comment inserts / frontmatter). Verified with a many-edit document: untouched prose stays byte-for-byte and the result re-parses with zero warnings.
- **Comment insertion cannot shift earlier spans:** confirmed — inserts are zero-width at `block.end`, applied in descending order; multiple comments on one block group into a single splice and stack in document order.
- **Checkbox rewriting touches no surrounding bytes:** now true for **all** options (F-1 fix). The marker is located from the list item's own source, so it always slices to exactly the 3-char `[ ]`/`[x]` marker and unchanged boxes are skipped. Verified across plain-text and inline-code / bold / italic / link / image / strike leading labels.
- **CRLF:** `crlf.md` and an all-CRLF hostile doc are byte-identical under empty review; when the writer does touch bytes it uses the document's own EOL and introduces no bare LF.
- **Fixtures:** 9 present — the §17.1 list plus `choice-formatted-labels.md`, which closes the formatted-leading-label gap that F-1 exploited.

---

## What to log for the run summary

- **Phase 2 verdict: PASS WITH WARNINGS (revised from FAIL).** The single blocker (F-1) is fixed and re-verified.
- **F-1 fixed** (`mdast.ts:82–108`): the checkbox is now located by scanning the list item's own source span, independent of child offsets; a missing marker skips the option rather than producing a corrupt span. Parse-time labels and write-time checkbox flips are correct for every leading-construct class I could construct (inline code, bold, italic, link, image, autolink, strike, raw HTML, `[x]`-in-label links, indented/`*`/`+` bullets, capital `[X]`). The original `initial-plan.md §20 q1` corruption is gone.
- **Regression protection is real and non-vacuous:** the new `invariants.test.ts` F-1 suite forces a *changed* selection on every choice fixture (single → different option; multi → inverted) and asserts label byte-stability + valid markers + round-trip; all 5 choice fixtures produce an actual checkbox-byte flip. Gates: 4 green, **88 tests / 42 invariant** on the Node 20 shell.
- **Remaining WARNINGS are forward handoff notes, not Phase 2 defects:** (1) **Phase 4** export must pass `reviewedAt` or no timestamp is stamped (`applyReview` is intentionally pure); (2) **Phase 6** comment insertion granularity is the top-level block — a comment anchored inside a question prompt lands mid-question-block (still round-trips).
- Everything else (parser leniency, splice ordering, byte-fidelity fast path, warnings vocabulary, `SPEC.md` accuracy, the `next.config.ts` deviation) remains sound.
