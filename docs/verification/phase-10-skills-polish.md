# Phase 10 — Skills, docs, smoke, release workflow (P6b)

**Verdict:** PASS
**Reviewer:** reviewer (fresh session) · **Date:** 2026-07-08
**Scope:** plan.md Phase 10 + initial-plan §13, §17.5, §16, §4. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead.

## Standing gates + invariants (Node 20.19.5)
- `pnpm typecheck` / `pnpm lint` / `pnpm build`: green. `pnpm test`: **359 passed, 38 files**, incl. spec byte-fidelity + round-trip invariants (`packages/spec/src/apply.test.ts` 22, `parse.test.ts` 16) and the digest suite (12).
- `pnpm test:e2e`: **2 passed** (desktop `smoke.spec.ts`, mobile `mobile.spec.ts`) in ~13s against a real `next dev`. Excluded from `pnpm test` via `vitest.config.ts` `exclude: [..., "**/e2e/**"]` — the fast gate stays fast. Confirmed.

## Ratified P6 exit — vanilla README walkthrough (done for real)
Started the standalone server with the README's exact bare-`pnpm` command (`WAYPOINT_MIGRATIONS_DIR=$PWD/apps/web/drizzle … node apps/web/.next/standalone/apps/web/server.js`) — booted first try; `/api/health` → `{version:0.1.0, specVersion:1.0.0, aiEnabled:false}`. Verified the README's own caveat: `drizzle/` is genuinely NOT beside `server.js`, so `WAYPOINT_MIGRATIONS_DIR` is required — the doc is accurate.
Ran the CLI from its built `dist/` (as an `npx` user resolves the bundled skill):
- `waypoint init` → wrote `.waypoint.json` (URL+project, **no token**), added `.waypoint/` to `.gitignore`, installed the skill tree into `.claude/skills/waypoint/` (SKILL.md + references/authoring.md + references/examples.md). Message names `/waypoint`.
- `waypoint push docs/plan.md` → printed review URL, wrote `.waypoint/pending.json`. `waypoint status` → listed the doc as `pending *`.
- Answered q1 (text) + q2 (choice) via `PUT /api/items/:id/response`, `PATCH` doc → completed.
- `waypoint pull --digest` → wrote `docs/plan.review.md` **and** `docs/plan.digest.md` beside the source, marked `pulled`, cleared the pointer.
- **Clean diff confirmed:** `diff plan.md plan.review.md` shows only the frontmatter stamp, `wp:answer` interiors, `status="answered"` attrs, and the `[x]` checkbox — byte-fidelity everywhere else (§11). Digest matches SPEC §9 grammar and the worked `examples.md`.

## Skill vs current conventions + SPEC
Verified `skills/waypoint/SKILL.md` against https://code.claude.com/docs/en/skills (WebFetch): `name`/`description`/`allowed-tools` valid (comma-separated `Bash(waypoint *)` patterns accepted), `SKILL.md`+`references/` structure matches, and the `` !`…pending.json` `` line is the documented dynamic-context-injection feature — all current. Loop behavior (status → pull → act; `--digest` writes `<name>.digest.md`) matches the CLI semantics exercised. Authoring guidance teaches the real convention: `waypoint: 1` opt-in, text vs choice, unique stable IDs, pre-filled draft answers, text-only-response-valid — consistent with `docs/SPEC.md`.

## Release safety
`.github/workflows/release.yml`: triggers **only** on `push: tags: [v*]` — nothing on push to main / PR. Publish job needs `secrets.NPM_TOKEN != ''` and enforces tag == `packages/cli` version. `waypoint-md` is `private: true` (independent second guard; npm refuses). `files: ["dist","skills"]`. `RELEASING.md` steps are correct and complete (flip private → token → tag), and state the tag↔CLI-version↔SPEC_VERSION contract from §4. All four packages `private: true`.

## Backup (run against a live WAL data dir)
`scripts/backup.sh` against the live server's data dir: main `waypoint.db` was 4 KB (WAL uncheckpointed) while `waypoint.db-wal` held 136 KB — exactly the case a raw `cp` would corrupt. The `.backup` snapshot (68 KB) passed `PRAGMA integrity_check` and contained all seven §6 tables plus the live document + responses. Restorable.

## Carried-item spot checks
- **Digest `wp:` stripping (Phase 9 W1), live repro:** ingested a doc with a `wp:comment` anchored inside a question prompt; `GET …/export?format=digest` → `**Q:**` line clean (no `<!--`, no comment body), comment intact in `## Comments` with `**Anchor:** "database"`. Backed by `digest.test.ts` W1 test + `stripWpMarkup`.
- **SPEC §9.3 field-boundary:** present and coherent — any `**Label:**`-leading line is a field boundary; multi-line values end at the next boundary/heading.
- **WAYPOINT_COOKIE_SECURE:** opt-in in `login/route.ts` (`secure: cookieSecure()`), off by default; 2 new passing tests (omit-by-default, set-when-enabled). README + `.env.example` document it.
- **`.claude/CLAUDE.md`:** polaris markers intact; Key-patterns line rewritten to describe the real stack instead of the nonexistent `nextjs-patterns` install path.
- **`docs/SPEC.md`:** stamped `1.0.0`; digest is §9 (matches skill citation). Zero stray TODO/FIXME/XXX/HACK in shipping source.

## Deviations — judged acceptable
- **Synthetic item DELETE skipped:** honestly documented in `docs/verification/phase-8-adoptive-import.md` (W1) — no per-item DELETE, but unanswered synthetic items are excluded from export so the deliverable is never contaminated. (Selection-comment DELETE does exist at `comments/[id]/route.ts`.)
- **Pixel-5 Chromium mobile profile:** confirmed in config; one browser engine to install. Reasonable.
- **e2e on `next dev` with AI/auth off:** `playwright.config.ts` webServer env sets `ANTHROPIC_API_KEY:""`, `WAYPOINT_TOKEN:""` — deterministic, exercises §14 degradation.
- **Gitignored `packages/cli/skills/` build copy:** `bundle-skill.mjs` produces it; wired to `build` + `prepack`; `diff -r skills/ packages/cli/skills/` is identical; shipped via `files`; regenerated by release.yml; `git check-ignore` confirms it's ignored.

## Docker (sanity read; not built — expensive)
`docker/compose.yml`: one `web` service, one `waypoint-data` volume at `/data`, all §16 env vars with defaults, `${PORT:-3000}:3000`. `docker/Dockerfile` sets `ENV WAYPOINT_MIGRATIONS_DIR=/app/drizzle` and copies `drizzle` beside the standalone `server.js`, so the compose quickstart boots cleanly without the migrations 500 that the bare-standalone path warns about. README quickstart matches.

## Warnings (non-blocking; W1 and W2 fixed by the lead pre-commit)
- **W1 (cosmetic, fixed):** `apps/web/e2e/mobile.spec.ts` docstring said "iPhone 13 viewport" while the config uses Pixel 5.
- **W2 (minor, fixed):** `docker/compose.yml` did not pass `WAYPOINT_COOKIE_SECURE` through for HTTPS deployments.
- **W3 (observation, accepted):** the e2e "selection comment" uses a programmatic Range + `selectionchange` dispatch rather than a real pointer drag — deliberate; pixel-drag is too fragile for a smoke. Real drag-select remains a manual check.
