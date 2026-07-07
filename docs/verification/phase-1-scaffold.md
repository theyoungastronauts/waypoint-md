# Phase 1 — Scaffold & foundations (P0) — Verification

**Verdict:** PASS WITH WARNINGS
**Reviewer:** reviewer agent (fresh session, Node v20.19.5, Docker v28.1.1)
**Date:** 2026-07-07
**Scope reviewed:** uncommitted working tree at repo root against `plan.md` Phase 1 (tasks, exit criteria, reviewer verification notes), Ratified decisions table, and standing gates; design refs `initial-plan.md` §3, §4, §6, §16.

Nothing was committed or staged (per run rules). One WARN is raised for human judgment; it does **not** block the phase because the primary exit path (Docker) is fully met.

---

## Standing gates (Node 20 shell, no `nvm use`)

All four pass on the local v20.19.5 shell; the only noise is the expected non-fatal engines warning, which confirms `engine-strict=false` is working (the no-`nvm` constraint holds).

| Gate | Result | Notes |
|---|---|---|
| `pnpm typecheck` | PASS | all 3 workspace projects "Done" |
| `pnpm lint` | PASS | all 3 projects clean |
| `pnpm test` | PASS | 3 files, 5 tests (incl. migration test asserting all 7 tables) |
| `pnpm build` | PASS (exit 0) | Next standalone output; `/api/health` correctly `ƒ (Dynamic)`, `/` static |

Engines warning observed: `WARN Unsupported engine: wanted {"node":">=22"} (current v20.19.5)` — warning only, never a failure. Correct per the ratified Node constraint.

---

## Reviewer verification-note checklist

| Check | Result | Evidence |
|---|---|---|
| Standing gates on Node 20 | PASS | above |
| `GET /api/health` fields | PASS | `{"status":"ok","version":"0.1.0","specVersion":"1.0.0"}` — app version (`APP_VERSION` from web pkg) + spec version (`SPEC_VERSION` from `@waypoint/spec`), `content-type: application/json` |
| SQLite schema vs §6 (all 7 tables) | PASS | fresh boot (local `next start` **and** fresh Docker volume) migrated `projects, documents, items, responses, comments, chat_messages, settings` (+ `__drizzle_migrations`). Columns match §6; `journal_mode = wal` confirmed |
| `git check-ignore .env .waypoint` | PASS | both ignored (also verified `.env.local`, `foo.db`, `next-env.d.ts`); `!.env.example` un-ignored |
| `.claude/CLAUDE.md` markers/content | PASS | `<!-- polaris:start/end -->` intact; describes pnpm monorepo, `apps/web` (Next 15 App Router, TS, Tailwind v4 + **shadcn/ui**), `packages/spec`, `packages/cli`; Agents + Command-only sections preserved; **no DaisyUI/`web/` remnants** |
| `private: true` on all packages | PASS | root, `@waypoint/web`, `@waypoint/spec`, `waypoint-md` all private; **no** `publishConfig`/`access`/`prepublish` anywhere |

---

## Exit criteria

| Criterion | Result | Evidence |
|---|---|---|
| `pnpm install && typecheck && lint && test && build` on Node 20 | PASS | gates above |
| `docker compose up` serves dark shell + `/api/health` | PASS | `docker compose -f docker/compose.yml build` exit 0; `up` → health 200 with correct fields; `/` renders dark shell (`class="dark"`, `bg-background`, "Waypoint", "No documents yet") |
| Fresh boot migrates the full §6 schema | PASS | fresh Docker volume produced `waypoint.db` (+WAL) with all 7 tables; container boots with no instrumentation error |

---

## Judgment on the executor's flagged deviations

All are sound; none block the phase.

1. **shadcn/pnpm over the stale `nextjs-patterns` skill** — Correct and plan-mandated. §4 and the Phase 1 task name shadcn/ui explicitly; the CLAUDE.md task exists precisely because the old DaisyUI/`web/` guidance was wrong. Deferring to the ratified plan over a stale skill is the right call.
2. **`app/` not `src/app/`** — Fine. Both are valid in Next 15; `@/*` → `./*` alias resolves (`/api/health` imports `@/lib/version`; build + typecheck pass).
3. **`eslint.ignoreDuringBuilds: true`** — Fine. Lint is a separate standing gate (`pnpm lint`) that passes independently; not re-running it inside `next build` is reasonable and does not weaken coverage.
4. **Spec consumed from `src` via `transpilePackages`** — Fine. Web/CLI import `@waypoint/spec` from TS source; the package also builds to `dist` (satisfies the `build` gate and future publish). Both paths green.
5. **`next-env.d.ts` gitignored** — Acceptable. It is auto-generated and regenerated on build (differs from Next's default of committing it; noted, not a problem).
6. **`.waypoint` ignore pattern without trailing slash** — Fine. Matches both a file and dir named `.waypoint`; `git check-ignore` confirms the CLI's `.waypoint/` dir is ignored.
7. **pnpm `onlyBuiltDependencies` allowlist** — Correct and necessary. pnpm 10 blocks build scripts by default; allowlisting `better-sqlite3`, `esbuild`, `@tailwindcss/oxide`, `sharp` is required for the native build (verified: Docker + local builds succeed).
8. **`WAYPOINT_MIGRATIONS_DIR` for the Docker standalone cwd** — Correct. The standalone server runs from a cwd where `./drizzle` is absent; the Dockerfile copies `drizzle` to `/app/drizzle` and sets the env var. Verified working in-container. (See WARN-1 for the non-Docker corollary.)
9. **`items` span refs as nullable `span_start`/`span_end`** — Fine. Faithful literal of §6's abstract "span refs into raw_md"; nullable because the Phase 2 parser populates them.

---

## Findings

### WARN-1 — Non-Docker local run path is inconsistent with `output: 'standalone'` (does not block Phase 1)

The plan's exit-criteria fallback ("If Docker is unavailable … `pnpm build && pnpm --filter web start`") runs `next start`, which under `output: 'standalone'` prints:

> `⚠ "next start" does not work with "output: standalone" configuration. Use "node .next/standalone/server.js" instead.`

In this review it **did** serve correctly (health 200, dark shell, migrations ran), so the fallback is functional today — but Next explicitly advises against it and a future Next version could make it a hard failure. Meanwhile, the command Next *suggests* (`node .next/standalone/…/server.js`) crashes on boot for this app: the instrumentation hook fails with `Can't find meta/_journal.json file` unless `WAYPOINT_MIGRATIONS_DIR` is set **and** the `drizzle/` folder is copied beside the standalone server — an arrangement only the Dockerfile makes.

Net: the **Docker path is solid** (primary exit criterion, verified end-to-end) and the literal fallback still serves, so the phase passes. But the non-Docker local DX has a latent cliff. Recommend reconciling in a later phase / README: either document the exact non-Docker command (with `WAYPOINT_MIGRATIONS_DIR` and a drizzle-copy step, or a small `pnpm start` wrapper that runs the standalone server with the right env), or drop the `next start` fallback wording.

### NOTE-1 — CLAUDE.md still points at the stale `nextjs-patterns` skill (out of scope)

The refreshed Polaris block's "Key patterns" line still references `nextjs-patterns` as auto-loading from `.claude/skills/nextjs-patterns/SKILL.md`; that skill file predates this stack (DaisyUI-era, per the executor). The Phase 1 task only required rewriting the layout description between the markers (done correctly) and preserving the Agents/Command-only sections, so this is **not** a Phase 1 defect — just flagging that the pointer to a stale skill survives and may warrant a cleanup pass later.

---

## Recommendation

**PASS WITH WARNINGS.** Phase 1 meets every task, exit criterion, and reviewer verification note; all standing gates are green on the Node 20 shell; Docker build/up and fresh-volume migration are verified. The single WARN concerns non-Docker local-run DX (documentation/latent-cliff), not Phase 1 functionality. Safe for the lead to commit; suggest logging WARN-1 for a later docs/ops pass.
