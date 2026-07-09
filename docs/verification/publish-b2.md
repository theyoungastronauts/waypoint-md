# Publish B2 — Publications registry UI + FTS search — Verification

**Verdict: PASS WITH WARNINGS.** Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write). The one actionable warning (#5) was fixed by the lead pre-commit.

## Standing gates

typecheck exit 0 · lint exit 0 · vitest 433/433 (48 files) · prod build exit 0. 10 new B2 tests (degradation 1, detail 4, list 5). The 42 spec byte-fidelity invariants untouched and green.

## Checklist findings

**Degradation — server-side, no flash.** The nav gate in `app/layout.tsx` is a server component reading `publishEnabled()`; with no creds the Publications `<Link>` is absent from server-rendered HTML — no client check. `/publications` and `/publications/[id]` gate server-side and render `PublishDisabled` (naming the three R2 vars) instead of crashing; the `[id]` page and its `generateMetadata` both check before any DB access. Both routes build as dynamic (`ƒ`), so the gate runs per request.

**No db-layer / secret leak — verified statically AND against built chunks.** Every client-component import of the server layer is `import type` (erased). Only the two server pages value-import the lib/render/config layer. Grepping `.next/static/chunks` after a real build: 0 hits for better-sqlite3, getDb, the R2 secret vars, sourceMd, puppeteer, or @aws-sdk. `sourceMd` is rendered to HTML server-side via `renderMarkdownToSafeHtml` (the shared rehype-sanitize pipeline); only the sanitized string crosses to `dangerouslySetInnerHTML`.

**Revoke — two-click, no native dialogs.** Grep for window.confirm/alert across the publications tree finds only a code comment — none used. First click sets `confirming`, fires no request; confirm POSTs to `/api/publications/:id/revoke`; success reflects revoked in place (button → note, artifact links go dead), no reload. Already-revoked rows: no control, dead links. Cancel dismisses cleanly.

**Search — q passthrough.** 250ms debounce → `GET /api/publications?q=`. Empty query uses the server-seeded newest-first list via `initialData` (no round-trip). B2 does not re-implement hostile-query safety — passes q straight to B1's verified `toFtsMatch`. Distinct empty states (first-run vs no-match). Revoked rows appear in list AND search, marked muted + a "revoked" badge — the registry remembers.

## Warning #5 — stale cached list after revoke — FIXED by the lead

`query-provider.tsx` sets `staleTime: 30_000`; the `["publications",""]` cache entry survives navigation and stays fresh, so React Query ignored the freshly server-rendered `initialData` on back-navigation and served the stale pre-revoke row — a revoked publication rendering at full opacity with live-looking links for up to 30s. Not a data/security issue (DB + R2 are correct), but it undercuts the exact feedback revoke exists to give.

**Fix applied:** `publication-detail-view.tsx` now calls `queryClient.invalidateQueries({ queryKey: ["publications"] })` in the revoke success path (invalidation overrides staleTime, so the list refetches on next mount). The detail test file gained a `QueryClientProvider` wrapper (the view now uses `useQueryClient`). Gates green after the change.

## Other judgment calls — sound

Server-side markdown render (keeps sourceMd + the pipeline out of the client bundle — a security win); local `labels.ts` for publication-origin labels (distinct from `format.ts`'s document-source map, not a DRY violation); `keepPreviousData` avoids empty-flash on search.

## For Phase C

- No blockers. Degradation is currently the live path (R2 unset) and is correct. Once creds land in the repo-root `.env`, re-verify the nav link + populated list/detail render.
- Live smoke: a publish appears newest-first and is FTS-searchable; revoking via the detail page deletes the three R2 objects and flips row + detail to the revoked presentation while the entry survives. With the #5 fix, the list reflects the revoke on back-navigation without a hard refresh.
