# UX Round 1 — Phase 5 (image attachments on responses) — Verification

**Verdict: PASS WITH WARNINGS.** Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write). Warning 2 (empty-file test) was closed by the lead pre-commit; Warning 1 is documented below as a known limitation.

## Gates (independently re-run)

`pnpm test`: 548 passed (63 files). typecheck/lint clean. build Done — both new routes registered. CLI `pull.test.ts`: 9 passed.

## Byte-fidelity — reviewer's own probes (15/15), not just the suite

Standalone probe against the built spec + an app-layer test against the real `enrichReviewWithAttachments`, with a hand-authored choice doc carrying a `wp:rationale` (with a fenced/indented code block) + a `wp:answer`:

- `applyReview(raw, {}) === raw` holds with rationale + answer + attachments present (#1 non-negotiable). ✓
- **Rationale + attachment (the Phase-4 handoff):** the reference line splices ONLY into the `wp:answer` interior; the `wp:rationale` interior is byte-identical; the whole options+rationale span before the answer is byte-identical; an untouched sibling item stays byte-identical. Reproduced independently of the executor's fixture. ✓
- Round-trip: `extractReviewState(parseDocument(exported))` recovers the enriched answer; re-apply is idempotent. ✓
- **Draft-clobber:** an untouched choice item with a pre-filled `wp:answer` draft + attachment → the embedded draft is recovered and the reference appended AFTER it (no author content lost); an explicitly-cleared draft (empty response row → `cleared` sentinel) is NOT resurrected. Both confirmed. ✓

## API security / limits

MIME allowlist → 400 `unsupported_media_type`; >10 MB → 413 `attachment_too_large`; missing item → 404; non-multipart → 400; empty file → 400 `empty_file` (test added by the lead). GET streams the stored content-type; DELETE removes the row AND the on-disk bytes and 404s a re-delete. All three routes are outside `OPEN_PATHS`; the middleware matcher covers everything non-static, so a tokenless request is a structural 401.

## Storage / migration

Bytes at `WAYPOINT_DATA_DIR/attachments/<id>`; the DB stores only `bytes_len` (no bytes column). Migration `0002_glorious_plazm` creates the table, is in `_journal.json`, runs on boot via `runMigrations`; `migrate.test` `EXPECTED_TABLES` includes `attachments`.

## Paste UI / export / digest / CLI / degradation

- `extractImageFiles` ignores non-image clipboard items (text falls through). The attachment hook is separate from the response/draft store, so it does not reintroduce seeding from `embedded.other` — the Phase-4 empty-default for choice elaboration survives (`initialDraft` still gates on `type === "choice"`).
- Reference format `_Attachment: ![alt](<name>.attachments/<exportName>)_` inside the answer interior; digest gains a distinct `**Attachments:**` field (not folded into `**Note:**`). CLI `pull` writes `<name>.attachments/<exportName>` using the server-supplied `exportName`; the folder base agrees with the server's `exportBaseName`, so links resolve. No pull regression.
- Degradation: neither route imports the AI capability gate — attachments work with no API key.

## Judgment calls — sound

`exportName = <first8ofId>-<sanitized>` (collision-free enough within a doc; cross-doc is separate folders); draft-recovery-on-enrichment (verified by probe).

## Warnings

1. **Synthetic-item attachments are orphaned on export (documented limitation, not fixed this round).** A reviewer can paste an image on a synthetic (adoptive-import) card — it uploads and renders. On pull the bytes ARE materialized to `<name>.attachments/`, but no reference line is written: the annotated enrichment and digest both filter `!synthetic`, and `synthetic-export.ts` has no attachment handling. Result: present-but-unreferenced (safe — no byte loss), but a dangling file. The plan's "harmless-vs-silent-loss" call chose the safe direction. A future round can reference synthetic attachments in the appended `## Waypoint responses` section. Requires the AI key + adoptive import to reach at all.
2. **Empty-file 400 path — FIXED by the lead.** Added a test asserting a zero-byte upload → 400 `empty_file`.

## Round-level note

This closes UX Round 1's biggest lift. Byte-fidelity held across every probe including the rationale-adjacent splice — the whole risk of doing Phase 4 before Phase 5.
