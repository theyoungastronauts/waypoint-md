# Phase 6 — Selection comments & suggested edits (P4) — Verification

**Verdict: PASS WITH WARNINGS.** Reviewer (fresh session), local Node v20.19.5 / pnpm 10.12.4. Reviewed the uncommitted working tree.

## Standing gates — all green

- typecheck / lint: clean (spec, cli, web). Engines warn (node>=22 vs v20.19.5) — the ratified expected state.
- test: **252 passed / 27 files**, incl. **42 spec invariants**, 18 anchor source-map, 13 comments, 7 anchor caps, 7 review-state, 7 review-status.
- build: Next standalone OK; comment routes compiled and behind Middleware.

## The #1 non-negotiable holds (verified adversarially)

Read `apply.ts`/`parse.ts` diffs closely and ran a spec probe against the built dist. `applyReview(raw,{})===raw` is protected by two coherent guards: `reviewIsEmpty` early-return (fast path, still used — not dead) and the new `material` flag. Confirmed byte-identical for every required edge:

- **cleared on already-empty answer** → interior byte-identical, only the stamp is added.
- **cleared on no-frontmatter doc** → stamp prepended as a new frontmatter block; body untouched.
- **cleared+text simultaneously** → text content wins (draft replaced with the answer).
- **response keyed to a nonexistent `wp_id`** (plain or cleared) → source byte-identical, no splice, **no stamp** (the `material` gate). Executor's claim holds.
- **comment-only review** → diff is exactly the frontmatter stamp + the inserted `wp:comment`/`wp:suggestion` block; stripping those two yields the exact source. Re-parse recovers the comment, exact, and suggestion.
- **>200-char selection** → exact truncated to 200 + `exact-hash` of the full selection; spliced (not dropped) and round-trips to the capped anchor.

## Anchor mapping (the hard part) — sound

Pure `alignRenderedToSource` greedy two-pointer; DOM only supplies rendered text + offsets. Writer's `anchorInsertionOffset`, highlight's `locateAnchorInSource`, and the client's `buildAnchorFromRenderedSelection` all share the same match order (prefix+exact+suffix → exact) and the same shared cap helper in `@waypoint/spec`, so a highlight and its export target agree. 18 unit tests cover source-markdown exact, links/bold, caps, the duplicate-text killer test, and an integration through `applyReview` to the right block.

- **Killer case added in review (prompt-vs-prose ordering):** a doc where `"the plan"` appears first inside a `wp:question` prompt and again in following prose; selecting the prose occurrence. The prose-derived prefix/suffix disambiguate — comment lands **after the prose block**, the prompt stays byte-identical, re-parse recovers it. The executor's "Nth-rendered→Nth-source" is really segment-local (order is guaranteed within a segment); cross-segment disambiguation is prefix/suffix context, which is robust.

## W1–W4 folded-in fixes — verified live (standalone server, throwaway data dir)

- **W1:** clearing a pre-filled draft via API → export has an **empty** answer interior (no resurrection); a never-touched pre-filled draft exports **byte-identical** to source; an untouched sibling draft survives. Sentinel = a response row that exists but has no content → `cleared:true`. Fully covered by new tests (export/review-state/apply).
- **W2:** malicious choice labels are sanitized — `<script>alert(1)</script>evil` renders as `evil`; `<img src=x onerror=alert(2)>pic` renders with **onerror stripped**; `**bold**` → `<strong>`. No executable script or `onerror` survives as real markup.
- **W3:** the out-of-order race is fixed properly — a per-item promise chain issues each PUT only after the prior settles (strict serialization; the server can't end up behind), and a monotonic seq gates the saved-tick so a stale response can't flip it to "Saved". An out-of-order completion cannot win.
- **W4:** first real answer advances `pending→in_review`; an empty/cleared save does **not** advance; a completed doc does **not** regress. Fires in `upsertResponse` so API/CLI answers advance too. Regression-guarded by tests.

## Comment CRUD + auth

POST/PATCH/DELETE zod-validated: empty body+no-suggestion → 400, anchor without exact → 400, create → 201, patch → 200, delete → 200, patch-deleted → 404. **Auth-covered** (not in OPEN_PATHS): with a token set, all three comment routes return **401** unauthenticated and pass with a valid bearer; `/api/health` stays open. Anchors are re-capped server-side (defense-in-depth). **Unanchored degradation** works: a stale-anchor comment is accepted, stored, and surfaces in the SSR "Unanchored comments" section with its quote — never dropped. Comment bodies/suggestions render as React text (not `dangerouslySetInnerHTML`), so no XSS via comment content.

## Executor deviations — judged

- **Greedy-alignment vs DOM annotation:** Accept — this is the sanctioned fallback posture (rendered-text anchor with source verification, null-degradation to the unanchored list, writer re-match). Pure + well-tested.
- **Mid-question-block comment placement:** Accept as documented. `analysis.blocks` are top-level mdast children, and a `wp:question` decomposes into several, so an anchor that matches inside a prompt paragraph would splice after that paragraph, inside the question. Low-probability, cosmetic (comment still exports + re-parses); byte-fidelity of the empty-review case is unaffected.
- **W1 sentinel = response-row-with-no-content:** Defensible. The concern (a status-only PUT with empty value reading as "cleared" and erasing a pre-fill) is **not reachable from the web UI** — the client always merges the full seeded draft. Only a raw API `PUT {status:...}` with empty value trips it. Worth a one-line SPEC note.
- **Cross-wp-boundary selections rejected / plain-text comment bodies / N selectionchange listeners:** Accept. Each `CommentableProse` adds one debounced document-level `selectionchange` listener; N+1 listeners on very large docs is a minor perf note (each early-returns on a cheap containment check).

## WARN (all minor, none blocking)

1. **W1 via raw API:** status-only PUT with empty value on a pre-filled item clears the draft on export. UI-unreachable; document as a limitation.
2. **Unanchored comment stamps but doesn't splice:** a review with only an unanchored comment sets `material=true` → frontmatter stamped, but no comment block in the annotated file (comment still lives in DB/digest). Arguably correct; worth a note.
3. **>200-char disambiguation:** for over-cap selections the writer falls back to exact-only match (the stored suffix sits past the pre-truncation selection, so prefix+exact(200)+suffix isn't contiguous). Insertion + round-trip still work; ambiguity would only bite if the first 200 chars are duplicated elsewhere (implausible).

## Outstanding browser-only checks (NOT claimed — need a human/Playwright pass)

- Floating "Comment" button on mouseup + **long-press** on a phone viewport.
- Actual DOM Selection → `selStart/selEnd` extraction and `range.toString()`/`textContent` consistency.
- `<mark>` highlight wrapping across inline formatting; click-a-mark opens the popover.
- Composer/viewer popover positioning, edit/delete round-trips in-browser.
- Visual placement of the unanchored section.

Exit criteria (plan Phase 6) are met: copyedit workflow usable end-to-end (select→comment+suggestion→export with correctly-anchored `wp:comment`+`wp:suggestion` after the right block), unanchored list present, standing gates + all spec invariants green.
