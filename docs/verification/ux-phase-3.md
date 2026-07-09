# UX Round 1 — Phase 3 (Attach file — path insertion) — Verification

**Verdict: PASS** (no defects). Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write).

## Gates

Reviewer ran the 5 Phase 3 suites (26 tests) + 12 own adversarial probes = 38 green; trusted the lead's 491-green full run + spec-invariant confirmation.

## Findings

- **Normalization segment-boundary (reviewer's own probes):** correct everywhere. `/Users/tyler/prj/foo`→`~/prj/foo`; `/etc/hosts` stays absolute. Traps hold — `/Users/tylerX`, `/Users/tyler2/prj`, sibling `/Users/tyler-backup/x`, and mid-path `/var/Users/tyler/x` all stay absolute (match anchors on `` `${base}/` ``, no substring bleed). Trailing-slash home + path == home → `~`; multiple trailing slashes stripped; degenerate home `/` or `""` → unchanged; unknown home → unchanged.
- **/api/env/home auth:** NOT in OPEN_PATHS; 401s without a token (token set), passes with a bearer, returns only `{ home: os.homedir() }`, no filesystem access. `dynamic = "force-dynamic"` prevents build-time baking of the wrong home dir.
- **Caret splice + selection-range replace:** `spliceAtCaret` handles collapsed caret, range replace, reversed range, out-of-bounds clamp, non-finite→append. `useCaretInsert` reads selectionStart/End off the live DOM at call time; a layout effect restores focus + caret past the insert. Mid-value insert and range replace verified.
- **Choice selection untouched:** `applyOther` patches only `{ other }`; `saveContent` merges over the current draft, so `selected` is preserved (confirmed `value.selected === []` after an elaboration insert).
- **cancel() prevents stale-save clobber:** additive — `call`/`flush` unchanged; the other consumer (publication-list) uses only `call`, unaffected. Both cards call `save.cancel()` before the immediate `saveContent`, so a queued keystroke save can't resurrect pre-insert text.
- **No upload / no fake picker:** zero `<input type="file">` / FileReader / FormData / fs in the changed code (the one `type="file"` hit is a doc comment explaining the rejection). Ships the honest inline `~/`-seeded field — the right call, since a browser picker only yields a basename.

## Judgment calls — sound

Module-level home cache + `__resetHomeCacheForTest` (process-constant value, in-flight dedup, reset clearly test-only); immediate save on insert (discrete action, matches checkbox immediacy); caret capture across the attach-click blur (verified with a realistic "caret placed before opening" probe — moving AttachFile out of the `<label>` is correct; selectionStart/End survive the blur).

## Notes for later phases (non-blocking — carried to Phase 5, which touches these cards)

1. The executor's caret test uses artificial ordering (opens form, then re-selects); the real "caret survives the open-blur" path isn't asserted (reviewer verified it manually). Fold a "caret set before open" case in when Phase 5 touches these cards.
2. Insert-with-existing-selection is preserved in code but not asserted by a test — cheap to add.
3. `getHomeDir` caches `null` permanently on a transient fetch failure → paths stay absolute (fail-safe) until page reload. Phase 5 attachment fetches hit the same auth surface; keep in mind.
