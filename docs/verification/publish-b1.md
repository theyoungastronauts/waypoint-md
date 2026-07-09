# Publish B1 — pipeline port + API + CLI verb — Verification

**Verdict: PASS WITH WARNINGS.** Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write). Both warnings were addressed by the lead pre-commit.

## Standing gates

typecheck exit 0 · lint exit 0 · vitest 422/422 (incl. 12 API + 20 lib publications tests) · build OK. The 42 spec byte-fidelity invariants are untouched and green.

## Port fidelity — verified byte-for-byte

- `template.ts`: the `wrapHtml` literal (4063 chars) + share-bar div + theme script + both `.replace()` fragments are byte-identical to `smitty/share/template.js`.
- Rendered body: both resolve `marked@15.0.12`, so `marked.parse` output is byte-identical (proved on a doc with headings/code/tables/lists/links/blockquote/HTML-escaping). Per-call `{gfm,breaks,async:false}` vs smitty's global `setOptions` makes no output difference.
- `render.ts` PDF settings (A4, margins 1in/0.75in/1in/0.75in, printBackground) match. `paths.ts` object keys `smitty/shares/<uuid>/<name>.{html,pdf,md}`, ContentTypes, and `https://<publicBase>/<key>` URLs match `upload.js`.

## FTS hostile-query safety — probed against a throwaway DB

Every operator (`"` `*` `:` `(` `)` `-` `^`, NEAR/AND/OR, unicode, zero-width space, `foo"* OR 1=1`, `title:secret`) tokenizes to `"word"*` prefix terms — no injection, no error. `(kubernetes` matched the literal word.

**Load-bearing detail:** when a query has no `[\p{L}\p{N}]` tokens, `toFtsMatch` returns `""`, and `publications_fts MATCH ''` throws an fts5 syntax error — but `listPublications` guards this with `if (!match) return []` (publications.ts:121) BEFORE hitting SQL. That guard is the only thing between a punctuation-only query and a 500; it must be preserved. Ordering is newest-first (`desc(createdAt)`) in both the search and list branches.

## Migration + triggers

`0001` applies on a fresh DB via `runMigrations`. The `ai`/`ad`/`au` content-sync triggers were verified hands-on: insert indexes, update re-indexes, delete de-indexes. External-content FTS5 shadow tables created correctly.

## Auth

All five `/api/publications*` routes are protected by default: `OPEN_PATHS` = {/api/health, /api/auth/login, /login} only. `[id]/route.ts` is GET-only; Next resolves the static `backfill` segment ahead of `[id]`, so no collision.

## Degradation

`assertPublishEnabled` throws `HttpError(400,"publish_unavailable")`, mirroring `chat/route.ts`'s `ai_unavailable` exactly. Test confirms all 5 endpoints 400 and no S3 puts occur. `/api/health` carries `publishEnabled`.

## Backfill

Read-only (ListObjectsV2 + GetObject only), idempotent by folder-uuid PK, `created_at` from LastModified. Test: indexed 2 → re-run 0 indexed / 2 skipped.

## Judgment calls — all sound

id==R2 folder uuid (PK idempotency + deterministic URL reconstruction); 400 not 503 (mirrors the ratified `ai_unavailable`); localized commented `networkidle0` cast; lazy `await import("puppeteer")` in `toPdf` only (cold routes never load Chromium); `PUPPETEER_SKIP_DOWNLOAD` is **not** set anywhere — puppeteer is in root `onlyBuiltDependencies` so a real `pnpm install` downloads Chromium.

## Warnings — both fixed by the lead pre-commit

- **W1:** `.env.example` documented `ANTHROPIC_API_KEY` but not the `R2_*` vars. **Fixed** — added the five R2 vars with the "all three creds or degraded" note.
- **W2:** `migrate.test.ts` asserted only the original 7 §6 tables. **Fixed** — added `publications` to the table assertions and a second test asserting the `publications_fts` table + the three sync triggers exist.

## For Phase B2 (registry UI)

`toPublicationSummary` (no sourceMd) for the list, `toPublicationDetail` for detail; `revoked` boolean + `urls` precomputed. Hide the whole Publications section when `publishEnabled()` is false (health carries the flag). Search: `GET ?q=` (empty → all newest-first; hostile-safe), limit default 50 / max 200. Revoked rows still appear in list AND search by design ("the registry remembers") — mark them visually; their R2 URLs 404 post-revoke.

## For Phase C

Set `R2_*` in the gitignored repo-root `.env` (loaded at boot by `loadRepoEnv`); verify Chromium present (`npx puppeteer browsers install chrome` if needed); run backfill (idempotent); flip `~/.zshrc` `alias share="waypoint publish"`; live smoke = one publish → 3 R2 objects + a row + working URLs, then revoke → objects gone, row survives `revoked`.
