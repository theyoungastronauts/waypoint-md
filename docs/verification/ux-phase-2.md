# UX Round 1 — Phase 2 ("Use this answer" suggestion fence, B-1) — Verification

**Verdict: PASS WITH WARNINGS.** Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write). Warning 1 (CRLF) was fixed by the lead pre-commit.

## Gates

26 tests pass (10 splitter, 4 card, 12 reviewer probes since removed). typecheck/lint/build clean; the spec byte-fidelity invariants are green (`git diff packages/` empty — no spec/CLI changes).

## Findings

**Splitter (suggestions.ts) — correct.** 12 adversarial probes beyond the suite confirmed: no fence → one prose segment; one/multiple fences with prose either side split in order; interior is verbatim (no trim); `wpsuggested` look-alike does NOT match; a plain ` ```ts ` block stays prose; a longer opening fence (````) lets ``` appear in the body; a genuinely unterminated fence stays prose and does not swallow the rest; the fence is removed from the prose stream (never double-rendered as card AND code block).

**Raw-insert vs sanitized-preview — correct, the load-bearing part.** `SuggestionCard` inserts the RAW fence contents via `insertIntoAnswer(focusedId, contents, "replace")`; the preview is a separate `renderMarkdownToSafeHtml(contents)`. The card test proves the PUT body's `value.text` is the raw interior, not HTML and not the whole message.

**XSS safety — sound.** The preview uses the same rehype-raw → rehype-sanitize pipeline as document prose; `<script>`/`onerror` in a fence is carried by the splitter as inert text and stripped at render. The insert path stores a raw string via `fetch` PUT — never touches the DOM — and is re-sanitized on render like any answer.

**No-focus hint — correct.** Button hidden when unfocused; the explicit "Focus a question to insert this into its answer." hint shows instead (plus a defensive `if (!focusedId) return`). Whole-message Append/Replace fallback still renders.

**System prompt — landed and live.** The `wpsuggest` bullet is in `SYSTEM_PROMPT` (lib/ai/context.ts) and is genuinely interpolated into requests at the chat route.

## Judgment calls — sound

Sanitized-preview-but-raw-insert (safe on both paths); hide-vs-disable button on no focus (hide + hint beats a disabled button); no-trim on contents (verbatim fidelity, defensible); nested-in-a-real-code-block left unhandled (needs a full markdown AST; the model is told to emit wpsuggest top-level — acceptable scope call).

## Warnings

1. **CRLF silently lost the card — FIXED by the lead.** The fence anchors end at `$`, so a `\r\n` message left a trailing `\r` on the info-string line and degraded to a raw code block (safe, but no card). `splitSuggestions` now normalizes `\r\n`→`\n` at the top; a CRLF regression test was added.
2. **Trailing-newline passthrough** (non-blocking): a model padding a blank line before the close yields a trailing `\n` in the insert. Harmless/cosmetic; left verbatim.
3. **Greedy swallow** (non-blocking): an unterminated open followed later by a complete fence consumes through the later close — rare, same class as the nested-fence case.
4. **Cosmetic** (intended): after a wpsuggest block, both the clean card and the whole-message fallback show; the fallback inserts the entire message including the markers.

## Notes for later phases

- **Phase 3 (Attach file):** the plan wants insertion "at the textarea caret," but `insertIntoAnswer`/`applyInsert` is field-level replace/append only — no caret-offset path exists. Phase 3 needs a new caret-aware insert; don't assume `insertIntoAnswer` covers it.
- **Phase 4 (Elaboration split):** `applyInsert` routes choice-item inserts into the `other` (elaboration) field. Phase 4 changes elaboration defaulting but keeps `other` as the target, so the suggestion-insert path should stay compatible — regression-check when it lands.
