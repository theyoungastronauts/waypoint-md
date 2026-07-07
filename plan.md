# Waypoint v1 — Implementation Plan

**Status:** Ready for execution · **Date:** 2026-07-07 · **Source:** [initial-plan.md](initial-plan.md) (ratified v1 architecture; all §20 decisions locked)

This plan is the contract for executor and reviewer agents running **one phase at a time, sequentially**. Each phase is self-contained: an executor with fresh context should be able to implement it from this document plus the referenced sections of `initial-plan.md`, without asking questions. Reviewers use the per-phase verification notes plus the standing gates below.

---

## How to use this plan

- **Executors:** read your phase in full, then read the `initial-plan.md` sections it references before writing code. Implement only your phase's scope. Commit in small logical steps. Do not start the next phase.
- **Reviewers:** run the standing gates, then work through the phase's verification notes. The phase is done only when its exit criteria are met.
- **Scope discipline:** if something looks missing or wrong in the architecture, flag it in your phase report — do not re-litigate ratified decisions (§20) or expand scope.

### Standing gates (every phase, from Phase 1 onward)

Run at repo root after every phase; all must pass before review sign-off:

```
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

### The #1 non-negotiable (every phase)

The spec package byte-fidelity invariant must hold at all times once Phase 2 lands:

1. `applyReview(raw, {}) === raw` — byte-identical, for every fixture.
2. `parseDocument(applyReview(raw, state))` recovers `state` exactly (round-trip).

Any phase that touches export, ingest, or the spec package must re-verify these tests pass. A reviewer who finds these red fails the phase regardless of anything else.

---

## Ratified decisions & run constraints

These are locked. Where they conflict with older text in `initial-plan.md`, **these win**:

| Topic | Decision |
|---|---|
| npm package name | `waypoint-md` (availability confirmed 2026-07-07). CLI binary is still `waypoint`. **No npm publishing in this run** — author the release workflow; publishing is a later manual step. |
| Git / CI | **Local-only, no GitHub remote.** Never push or open PRs. Author GitHub Actions CI (typecheck/lint/test/build) in-repo, but it will not run here — the reviewer runs the same commands locally instead. |
| SQLite driver | `better-sqlite3` (§20 q4). |
| URL import | Lands in P2 → Phase 3 here (§20 q2). |
| Digest export | Lands in P6 → Phase 9 here (§20 q3). |
| Choice UI | Single-select renders as a **radio group**, multi as **checkboxes**. Every choice card has an **always-visible** freeform elaboration field (maps to `wp:answer`). A text-only response with no selection is valid. Parser: multiple checked boxes in `select="single"` → warning, first checked wins. |
| Auth | `WAYPOINT_TOKEN` unset = fully open with a **loud startup warning**. Set token is **always enforced** (bearer for API, httpOnly session cookie for web). No localhost-detection cleverness (§15). |
| Sidebar model | Default `claude-sonnet-5`; switchable at runtime in `/settings` between latest Sonnet, Opus, and Fable. `WAYPOINT_MODEL` env sets the default; settings-table value wins. **Verify current model IDs against https://docs.claude.com/en/api/overview during Phase 7.** |
| ANTHROPIC_API_KEY | User will drop it in a gitignored `.env` at repo root at some point. Sidebar tests **mock the SDK regardless**. At Phase 7: key present → do a live smoke check; key absent → verify the degradation path (sidebar hidden, all else works) and flag the live smoke as **pending** in the phase report. **Never block on the key.** |
| Node | Pin `.nvmrc` and `engines` to 22; Dockerfile uses `node:22`. Local dev shell runs **v20.19.5** which is compatible — commands must not assume `nvm use` works. Do **not** set `engine-strict=true` (engines mismatch must warn, not fail). |
| Toolchain | pnpm 10 workspaces (pin via `packageManager` field), vitest at root. Root scripts `typecheck` / `lint` / `test` / `build` must exist from Phase 1 on. |

---

## Phase map

Ten phases. Ratified ordering from §18 is preserved; P2 is split into 3+4, P5 into 7+8, P6 into 9+10.

| Phase | Original | Name | Ends usable as |
|---|---|---|---|
| 1 | P0 | Scaffold & foundations | `docker compose up` serves the dark shell; gates green |
| 2 | P1 | Spec package (`@waypoint/spec`) | parser + splice writer with all invariants green |
| 3 | P2a | Ingest doors, queue, read-only doc view | import via 4 doors, browse queue, read docs |
| 4 | P2b | Interactive review + annotated export | full file-first review loop, zero CLI |
| 5 | P3 | Auth + CLI | push from a repo, review, pull back beside source |
| 6 | P4 | Selection comments & suggested edits | copyedit workflow usable |
| 7 | P5a | AI sidebar chat | chat, insert-into-answer, explain-this-question |
| 8 | P5b | Adoptive import | unstructured doc → structured review |
| 9 | P6a | Digest export + keyboard nav | agent-cheap digest; desktop power flow |
| 10 | P6b | Skills, docs, smoke, release workflow | vanilla + Polaris users onboard from README |

**Parallel-safe groups** (execution is sequential, but these have no cross-dependency — useful if plans change): Group A = {5, 6} (both depend only on Phase 4). Group B = {7→8} and {9} (Phase 9 depends on Phases 4+5, not on the sidebar). Sync point: Phase 10 depends on everything.

---

## Phase 1 — Scaffold & foundations (P0)

**Objective:** A running monorepo skeleton — tooling, dark app shell, database plumbing, health endpoint, Docker — plus the repo hygiene items (gitignore, CLAUDE.md refresh, CI authored). Everything after this phase builds inside this structure.

**References:** §3, §4 (layout + stack), §6 (data model), §16 (deployment, env vars), §18 P0 row.

### Tasks

- [ ] **Workspace root:** `package.json` (name, `private: true`, `packageManager: pnpm@10.x`, `engines.node: ">=22"`), `pnpm-workspace.yaml` covering `apps/*` and `packages/*`. Root scripts `typecheck`, `lint`, `test`, `build` that recurse over the workspace (`pnpm -r ...`; `test` runs vitest at root). Root `vitest.config.ts` / workspace config so package tests are discovered.
- [ ] **Node pinning:** `.nvmrc` = `22`. Do NOT add `engine-strict=true` anywhere — local shell is Node v20.19.5 and all commands must work there without `nvm use`.
- [ ] **`.gitignore`:** node_modules, `.next/`, `dist/`, `.env`, `.env.*`, `*.db`/data dir artifacts, `.waypoint/`, OS junk, coverage, Playwright artifacts. (`.env` at repo root will later hold `ANTHROPIC_API_KEY` — it must be ignored from day one.)
- [ ] **`apps/web`:** Next.js 15 (App Router) + TypeScript 5 + Tailwind v4 + shadcn/ui. Dark theme by default with light available (shadcn tokens); system font stack; reading-width prose column. Shell layout with empty `/` dashboard placeholder. `output: 'standalone'` in next config (Docker needs it).
- [ ] **`packages/spec`:** scaffold only — `@waypoint/spec`, `private: true`, TS build config, empty `src/index.ts` exporting placeholder types, vitest wired. (Real implementation is Phase 2.)
- [ ] **`packages/cli`:** scaffold only — package name **`waypoint-md`**, `bin: { "waypoint": ... }`, `private: true` for now (flipped at publish time, which is out of scope), commander installed. No commands yet beyond `--version`.
- [ ] **Database:** Drizzle ORM + better-sqlite3 in `apps/web`. Implement the **full §6 schema** now (projects, documents, items, responses, comments, chat_messages, settings) — it is small and ratified; landing it once avoids migration churn. WAL mode. `drizzle-kit` migrations committed; migrations run on boot. Data dir from `WAYPOINT_DATA_DIR` (default `~/.waypoint/data`), created if missing.
- [ ] **`GET /api/health`:** returns app version + declared spec version (§8) — the CLI handshake target.
- [ ] **Docker:** `docker/Dockerfile` (node:22, pnpm, Next standalone output) and `docker/compose.yml` mounting one volume at `WAYPOINT_DATA_DIR`, exposing `PORT` (default 3000). Env vars per §16 table.
- [ ] **CI (authored, not run):** `.github/workflows/ci.yml` — pnpm install, typecheck, lint, test, build on push/PR. It will not execute in this environment; keep it simple and correct.
- [ ] **Refresh `.claude/CLAUDE.md`:** the current Polaris block wrongly says `web/` + DaisyUI. Rewrite the content between the existing `<!-- polaris:start -->` / `<!-- polaris:end -->` markers (keep the marker format and section structure) to describe the real layout: pnpm monorepo with `apps/web` (Next.js 15 App Router, TypeScript, Tailwind v4 + **shadcn/ui**), `packages/spec`, `packages/cli`. Keep the Agents and Command-only skills sections as-is.
- [ ] npm name: no action — `waypoint-md` availability was confirmed 2026-07-07. Just use the name.

### Exit criteria

- `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` all succeed on the local shell (Node 20.19.5).
- `docker compose -f docker/compose.yml up` serves the dark shell and `/api/health` responds. (If Docker is unavailable on the review machine, fallback: `pnpm build && pnpm --filter web start` serves the same.)
- Fresh boot creates the SQLite file with all §6 tables migrated.

### Verification notes (reviewer)

- Run the standing gates on the local Node 20 shell — this proves the no-`nvm` constraint holds.
- `curl /api/health` and check version + spec version fields.
- Inspect the SQLite schema (`sqlite3 ... .schema`) against §6: all seven tables, correct columns.
- Confirm `.env` and `.waypoint/` are gitignored (`git check-ignore .env .waypoint`).
- Diff `.claude/CLAUDE.md` — markers intact, `apps/web` + shadcn/ui described, no DaisyUI/`web/` remnants.
- Confirm no npm publish config that could accidentally publish (`private: true` on all packages).

---

## Phase 2 — Spec package (P1)

**Objective:** The heart of the product: `@waypoint/spec` — deterministic parser, splice writer, types, and golden fixtures, with the byte-fidelity and round-trip invariants enforced by tests. Also author `docs/SPEC.md` v1, the public contract.

**References:** §5 (the whole convention — read every subsection), §11 (splice writer), §17 items 1–3 (fixtures + invariants). This phase is pure library work; no web/UI changes.

### Tasks

- [ ] **Types** (`packages/spec/src/types.ts`): `Frontmatter`, `Item` (type `text|choice`, config with `select` + options, prompt md, spans, `wp_id`), `Comment` (anchor: `exact`/`prefix`/`suffix`/`exact-hash`, body, optional suggestion), `SpanIndex` (byte offsets for every wp block and interior), `Warning`, `ReviewState` (responses keyed by `wp_id`: `{text}` or `{selected[], other}`, status `answered|flagged|skipped`; plus comments).
- [ ] **`parseDocument(raw)`** per §5.6: remark-parse + remark-gfm → walk `html` nodes → pair `wp:` open/close comments by ID via a small state machine → capture mdast `position` byte offsets. Requirements:
  - Frontmatter parsing (`waypoint: 1` opt-in, title/project/source) — §5.1.
  - Text questions (§5.2) and choice questions (§5.3): task-list options, checked state, `select="single"|"multi"`.
  - **Ratified:** multiple checked boxes in `select="single"` → emit a warning, **first checked wins**.
  - Comments with quote anchors and nested `wp:suggestion` (§5.4); attribute HTML-encoding; caps: prefix/suffix ≤ 32 chars, exact ≤ 200 with `exact-hash` fallback.
  - Answer `status` attribute (§5.5).
  - **Fence-aware:** `wp:` tags inside code fences must NOT parse (mdast handles this naturally — html nodes inside `code` nodes don't exist — but the fixture must prove it).
  - CRLF tolerated; bytes never normalized.
  - Malformed pairs, duplicate IDs, unpaired tags → warnings, never hard failures. A no-convention doc parses to zero items with no errors.
- [ ] **`applyReview(raw, review)`** per §11 — the splice writer. Never re-serialize the AST. Using the span index: replace `wp:answer` interiors, set `[x]`/`[ ]` checkbox states inside question blocks, write `status` attributes on answer opens, insert `wp:comment` blocks immediately after the block containing their anchor, stamp frontmatter (`waypoint_status`, `reviewed_at`) **only when review state is non-empty**. Apply splices in **descending byte-offset order**.
- [ ] **Golden fixtures** in `packages/spec/fixtures/` per §17.1: kitchen-sink doc; choice variants including multi-checked single-select and a text-only response on a choice question; no-convention doc; malformed pairs; CRLF doc; nested code fences containing fake `wp:` tags.
- [ ] **Invariant tests** (the #1 non-negotiable): for EVERY fixture, `applyReview(raw, {}) === raw` byte-identical; and `parseDocument(applyReview(raw, state))` recovers `state` exactly for representative non-empty states (text answers, single/multi selections, elaborations, statuses, comments with suggestions).
- [ ] **`docs/SPEC.md`:** the convention written up as the public contract, semver'd `1.0.0` (§4). Content mirrors §5 with the ratified parser semantics spelled out (first-checked-wins, hand-answerable rules, status vocabulary).

### Exit criteria

- All §17 items 1–3 green: fixtures exist, byte-fidelity and round-trip invariants pass for every fixture.
- `docs/SPEC.md` exists and matches the implementation.
- Standing gates pass.

### Verification notes (reviewer)

- This is the highest-leverage review of the project. Read the splice writer closely: check splice ordering (descending offsets), check that comment insertion cannot shift earlier spans, check checkbox rewriting doesn't touch surrounding bytes.
- Confirm invariant tests iterate over **all** fixtures programmatically (not hand-picked ones), so future fixtures are automatically covered.
- Adversarial checks: run parse on a doc where a fence contains `<!-- wp:question ... -->` — must yield zero items. Feed a CRLF fixture through `applyReview(raw, {})` — must be byte-identical (no newline normalization).
- Check warnings behavior: duplicate IDs and unpaired tags produce warnings and a still-usable parse.
- Read `docs/SPEC.md` against §5 for drift.

---

## Phase 3 — Ingest doors, queue, read-only doc view (P2a)

**Objective:** All four file-first ingest doors (upload / paste / path / URL) converging on one `ingestDocument()` service, a queue dashboard, and a read-only rendered document view. After this phase Waypoint is usable as an import-and-read tool.

**References:** §7 (the five doors — CLI door is Phase 5), §8 (API surface), §6 invariants (raw_md immutable; supersede semantics), §9 routes, §15 (path allowlist + URL SSRF hygiene + rehype-sanitize).

### Tasks

- [ ] **`ingestDocument()` service** (`apps/web/lib/` or `apps/web/server/`): bytes in → preserve exactly (no normalization) → `parseDocument` → persist document + items (with span refs, order_index) → return `{id, url, warnings}`. New docs get status `pending`. Re-ingest with same `project + source_path` → new document with `supersedes_id` set; old doc auto-archives (§6). Parse warnings are stored/surfaced, never fatal.
- [ ] **`POST /api/documents`:** accepts multipart file (.md/.markdown/.txt), `{markdown}`, `{path}`, or `{url}` — zod-validated (§8).
- [ ] **Path door (§15):** only reads under `WAYPOINT_ALLOWED_ROOTS` (colon-separated); unset = door disabled (API returns a clear error; UI tab hidden or disabled with explanation). Resolve symlinks/`..` and prefix-check against allowed roots — this endpoint must not become arbitrary-file-read.
- [ ] **URL door (§15, ratified in for v1):** 1 MB cap, text content-types only, no redirects to private IP ranges (resolve and check; block RFC1918/loopback/link-local).
- [ ] **Read APIs:** `GET /api/documents?status=&project=`, `GET /api/documents/:id` (doc + items + responses + comments), `PATCH /api/documents/:id` (status transitions, project reassignment), `GET/POST /api/projects` (§8).
- [ ] **`/new` page:** four tabs — upload (drag-and-drop + picker), paste (textarea; the phone path), path, URL. Success → redirect to the doc with warnings shown if any.
- [ ] **`/` queue dashboard:** pending / in_review / completed lists, filterable by project and status (§2 goal 5). Status dots, doc titles, project badges, relative times.
- [ ] **`/d/[id]` read-only render:** raw md → `@waypoint/spec` parse → remark/rehype pipeline with **`rehype-sanitize`** (tight allowlist, §15) → prose. `wp:` blocks render as inert prompt content (visible question text, no interaction yet) — Phase 4 makes them live. Establish the render pipeline module so Phase 4 extends rather than rewrites it.
- [ ] **API tests** (vitest against route handlers): each ingest door happy path, path-door denial (unset roots, traversal attempt), URL-door caps/content-type rejection, queue filtering, supersede behavior.

### Exit criteria

- From a browser: import a doc via each of the four doors; each lands `pending` in the queue; opening it renders readable prose including question prompts; warnings from a malformed doc are visible, not fatal.
- Path door provably disabled when `WAYPOINT_ALLOWED_ROOTS` is unset.
- Standing gates pass; Phase 2 invariants still green.

### Verification notes (reviewer)

- Security focus: attempt `{path: "/etc/passwd"}` and a `../` traversal with roots set — both must be rejected. Attempt a URL ingest of a >1 MB body and a `text/html`-to-private-IP redirect — rejected.
- Ingest a fixture from `packages/spec/fixtures/` via paste; confirm `raw_md` stored byte-identical to input (compare hashes).
- Confirm re-pushing the same project+source_path supersedes rather than mutates (old doc archived, `supersedes_id` set, `raw_md` untouched).
- Check `rehype-sanitize` is actually in the pipeline: ingest a doc containing `<script>` and an `onerror` img — neither survives to the DOM.

---

## Phase 4 — Interactive review + annotated export (P2b)

**Objective:** Complete the ratified P2 exit: review a real doc end-to-end with zero CLI. Interactive question cards in-place, autosave, right-rail progress, statuses, completion flow, and annotated markdown export.

**References:** §9 (frontend architecture — read all of it), §11 (export outputs; digest is Phase 9), §8 (`PUT /api/items/:id/response`, export endpoint), §5.3 semantics, §17 item 4.

### Tasks

- [ ] **Render pipeline upgrade:** custom remark plugin lifts `wp:` blocks into custom mdast nodes → React components render in-place, exactly where they sit in the document (§9). Prose stays prose.
- [ ] **`QuestionCard` (text):** prompt md + answer textarea; pre-filled `wp:answer` content shows as a pre-populated draft (§5.2).
- [ ] **`ChoiceGroup` (ratified semantics):** `select="single"` → radio group; `select="multi"` → checkboxes; **always-visible** optional elaboration field mapping to the `wp:answer` block. A text-only response with no selection is valid and counts as answerable. Parser warnings (multi-checked single) surface on the card.
- [ ] **`PUT /api/items/:id/response`:** upsert value + status (§8). Autosave: 800 ms debounce per item, optimistic updates via TanStack Query v5, subtle saved-tick per card. No save buttons (§9).
- [ ] **Item statuses:** untouched / answered / flagged / skipped, settable per card (flag = "revisit later").
- [ ] **Focused-item model:** one shared "focused item" state (context or store). It underpins the right-rail nav now, keyboard nav in Phase 9, and agent context in Phase 7 — build it as a first-class primitive.
- [ ] **Right rail:** progress ring ("7/12"), item nav list with status dots; clicking scrolls to + focuses the card. Placeholder agent tab (Phase 7 fills it).
- [ ] **Mobile:** rail collapses into a bottom sheet; tapping an item scrolls/focuses. Touch targets sized for couch use (§2 goal 4, §9).
- [ ] **Completion flow:** answering/last-item interaction prompts a one-screen review summary → "mark completed" (PATCH status → `completed`).
- [ ] **Annotated export:** `GET /api/documents/:id/export?format=annotated` — pure function of `(raw_md, review state)` via `applyReview` (§6 invariant, §11). Web download button on the review view.
- [ ] **Round-trip API test (§17 item 4):** ingest fixture → submit responses via the API → export annotated → `parseDocument` on the output recovers the responses exactly. Plus: export of an untouched doc is byte-identical to what was ingested (no frontmatter stamp on empty state).

### Exit criteria

- The ratified P2 exit: import a real doc via any file-first door, answer text + choice questions (including a text-only response on a choice card), flag/skip items, watch progress, mark completed, download the annotated `.md` — with zero CLI involvement, from desktop and from a phone-sized viewport.
- Untouched-doc export is byte-identical to the source.
- Standing gates + all spec invariants pass.

### Verification notes (reviewer)

- Do the full loop manually with `packages/spec/fixtures/` kitchen-sink: answer everything, export, and **diff the export against the source** — changes must appear only inside `wp:answer` interiors, checkbox states, and the frontmatter stamp. This is the clean-diff feature (§2 goal 3).
- Verify choice semantics: radio for single, checkboxes for multi, elaboration always visible, text-only response accepted and reflected in export.
- Kill the network mid-edit (devtools offline) and confirm optimistic UI + eventual reconciliation don't lose the answer or lie about saving.
- Check autosave doesn't spam: one PUT per item per debounce window.
- Narrow viewport: bottom sheet works, cards usable with touch targets.

---

## Phase 5 — Auth + CLI (P3)

**Objective:** The single-token auth model and the `waypoint` CLI (published name `waypoint-md`; **no publish this run**): push/status/pull/open/init/config, pointer file, offline outbox.

**References:** §12 (CLI — read all), §15 (auth model), §8 (login + health), §13 (init's skill-install duty — deferred content, see below).

### Tasks

- [ ] **Auth (ratified):** `WAYPOINT_TOKEN` unset → fully open, print a **loud startup warning** (server log, clearly visible). Set → **always enforced**: bearer header for `/api/*`, and a minimal login page that exchanges the token for an httpOnly session cookie via `POST /api/auth/login` (§8, §15). Enforce through one central helper/middleware so every current and future route is covered by default — routes must opt out (only `/api/health` and the login route are open). Tokens/keys never in DB or client bundles.
- [ ] **CLI commands** (`packages/cli`, commander + native fetch only — zero heavy deps):
  - `waypoint init` — writes `.waypoint.json` (server URL, project, defaults); offers to append `.waypoint/` to `.gitignore`. Skill installation is **deferred to Phase 10** (the skill doesn't exist yet) — leave a clearly-marked seam in the code, and `init` should not claim to install a skill yet.
  - `waypoint push <file> [--project p] [--title t]` — POSTs with `source` = relative path + host metadata; prints review URL (`WAYPOINT_PUBLIC_URL` aware); writes pointer `.waypoint/pending.json` (doc id, source path, pushed_at).
  - `waypoint status` — lists this project's docs + review states.
  - `waypoint pull [id|--latest]` — fetches annotated md → `<name>.review.md` beside the source; clears the pointer; marks doc `pulled`. (`--digest` flag lands in Phase 9 — omit it entirely for now.)
  - `waypoint open [id]` — opens the review URL in a browser.
  - `waypoint config` — get/set server URL and token.
- [ ] **Config resolution:** flags → env (`WAYPOINT_URL`, `WAYPOINT_TOKEN`) → `.waypoint.json` → `~/.waypoint/config.json`. Token never stored in the project-local file (§12).
- [ ] **Offline outbox:** server unreachable → `push` queues payload in `~/.waypoint/outbox/` and says so plainly; `waypoint push --flush` retries (§12). Push never hard-fails because the app is down.
- [ ] **Health handshake:** CLI checks `GET /api/health` and warns on spec-version mismatch.
- [ ] **Tests:** auth middleware (open vs enforced, bad token, cookie flow); CLI commands with mocked fetch (push/pull/pointer/outbox/config resolution); an integration test of push→pull against the route handlers if cheap.
- [ ] Package metadata final: name `waypoint-md`, bin `waypoint`, files list, `publishConfig` — but **do not publish** and keep it un-publishable in this run (`private: true` until the manual release later, with a comment noting the flip is deliberate).

### Exit criteria

- The ratified P3 exit: `waypoint push` a doc from a repo directory (token set), review it in the web UI (login page works), `waypoint pull` writes `<name>.review.md` beside the source, pointer cleared, doc marked `pulled`.
- With token unset: everything works open + the startup warning appears. With token set: unauthenticated API calls and web visits are rejected/redirected.
- Standing gates + spec invariants pass.

### Verification notes (reviewer)

- Auth matrix: {token unset, token set} × {API bearer valid/invalid/missing, web cookie valid/missing}. Confirm the loud warning on open mode and that /api/health remains open in both modes.
- Grep for any route handler that bypasses the central auth helper.
- Simulate offline push (server down) → outbox file exists, message is plain; `--flush` delivers it.
- Confirm token never lands in `.waypoint.json` and `.waypoint/` is gitignore-offered.
- Run the CLI via `node`/`pnpm` on the local Node 20 shell — must work without `nvm use`.

---

## Phase 6 — Selection comments & suggested edits (P4)

**Objective:** Comment on any selected text in the rendered prose — with optional suggested replacements — anchored by quotes against the **source markdown**, exported as `wp:comment`/`wp:suggestion` blocks, degrading gracefully when anchors no longer match.

**References:** §10 (read all — the DOM→source mapping is the hard part), §5.4 (comment block format + caps), §11 (comment splicing), §8 (comment routes).

### Tasks

- [ ] **Selection affordance:** browser Selection API over rendered prose; on mouseup/long-press with a selection, floating "Comment" button → popover with comment body + optional suggested replacement (§10).
- [ ] **Anchor construction:** `exact` = selected text, `prefix`/`suffix` = 32 chars of surrounding context **from the source markdown**, mapped via the span index — not the DOM (§10). Enforce §5.4 caps: prefix/suffix ≤ 32, exact ≤ 200 with `exact-hash` + truncation fallback. This mapping is the phase's core difficulty — isolate it in a well-tested module.
- [ ] **API:** `POST /api/documents/:id/comments`, `PATCH/DELETE /api/comments/:id` (§8), zod-validated, auth-covered.
- [ ] **Highlights:** matched anchors render as `<mark>`-wrapped ranges in the prose; clicking a highlight opens the comment.
- [ ] **Unanchored degradation:** anchors that no longer match (e.g., superseded doc) appear in an "unanchored comments" list at the bottom of the review view — comments never silently disappear (§10).
- [ ] **Export integration:** the Phase 2 writer already splices `wp:comment` blocks after the block containing the anchor; verify end-to-end from UI-created comments, including nested `wp:suggestion` (§5.4). Suggested edits export verbatim as the replacement text.
- [ ] **Tests:** anchor construction unit tests (selection at block boundaries, inside emphasis/links, multi-paragraph selections rejected or handled per your design — document the choice), comment CRUD API tests, export-with-comments round-trip on fixtures.

### Exit criteria

- The ratified P4 exit — copyedit workflow usable: select rendered text, comment with a suggested replacement, see the highlight, export, and the annotated file contains a correctly anchored `wp:comment` + `wp:suggestion` placed after the right source block.
- A comment whose anchor no longer matches shows in the unanchored list.
- Standing gates + spec invariants pass.

### Verification notes (reviewer)

- The killer test: select text that appears **twice** in the document — the prefix/suffix context must disambiguate; verify the exported anchor re-matches the right occurrence on re-parse.
- Select text inside formatting (`**bold**`, links): the stored `exact` must be source-markdown text, not rendered text — check the exported block by eye.
- Verify caps: a >200-char selection produces `exact-hash` + truncated `exact` and still round-trips.
- Byte-fidelity spot check: export with only comments (no answers) and confirm the diff is exactly the inserted comment blocks (+ frontmatter stamp) and nothing else.
- Mobile: long-press selection path works in a phone viewport.

---

## Phase 7 — AI sidebar chat (P5a)

**Objective:** The document-scoped AI sidebar: streaming chat in the right rail, insert-into-answer, explain-this-question, model selection in `/settings`, and clean degradation when no API key is present.

**References:** §14 (read all), §8 (chat route), §16 (env vars), §6 (chat_messages, settings tables).

### Tasks

- [ ] **Server proxy only:** `POST /api/documents/:id/chat` assembles context and streams from the Anthropic API via `@anthropic-ai/sdk`, SSE to the client. The API key never reaches the browser (§14, §15). Key comes from `ANTHROPIC_API_KEY` (the user will drop a gitignored `.env` at repo root — load it in dev; confirm `.gitignore` covers it, done in Phase 1).
- [ ] **Context assembly (lean, §14):** frontmatter + compact index of all items with current answers + full text of the focused item's surrounding section + last N chat turns. Full document only when small; otherwise windowed around focus. Persist turns in `chat_messages`; one thread per document.
- [ ] **UI:** agent tab in the right rail (placeholder from Phase 4 becomes real); streaming rendering; per-message **"insert into answer"** targeting the focused item (appends/replaces into the answer field and triggers autosave); **"explain this question"** quick action on every card that pre-seeds the chat with that item's context and focuses the agent tab (§14).
- [ ] **Model selection (ratified):** default `claude-sonnet-5`; `/settings` page lets the user switch at runtime between the **latest Sonnet, Opus, and Fable** models. `WAYPOINT_MODEL` env sets the default; a settings-table value wins over env. **Verify the current model IDs against https://docs.claude.com/en/api/overview now, during this phase** — do not trust the doc's examples.
- [ ] **Degradation (ratified):** no `ANTHROPIC_API_KEY` → sidebar tab, quick actions, and (Phase 8's) adoptive import simply don't render; everything else fully works. The check is server-driven (e.g., a capability flag in a bootstrap/health payload), not a client env leak.
- [ ] **Tests:** mock `@anthropic-ai/sdk` **regardless of key presence** — context assembly (windowing thresholds, focused-section extraction), SSE streaming route behavior, insert-into-answer state flow, model resolution precedence (settings > env > default), degradation rendering.
- [ ] **Live smoke (conditional, never blocking):** if `ANTHROPIC_API_KEY` is present in `.env` at review time, run one real streamed chat round-trip as a manual smoke. If absent, verify the degradation path end-to-end and **flag the live smoke as pending** in the phase report. Do not block the phase on the key either way.

### Exit criteria

- With a key: open a doc, chat about it, insert a reply into the focused item's answer, use explain-this-question from a card, switch models in `/settings` and see the change take effect.
- Without a key: sidebar and quick actions absent, all Phase 1–6 functionality intact.
- Mocked test suite green regardless of key; standing gates + spec invariants pass.

### Verification notes (reviewer)

- Confirm the API key cannot reach the client: grep client bundles/props for the key and for direct `anthropic` imports in client components.
- Review context assembly against §14's cost posture: a large doc must NOT ship wholesale — verify the windowing branch with a test or log.
- Check model precedence: set `WAYPOINT_MODEL`, then override in `/settings`, restart — settings value must still win.
- Check model IDs used are verified-current (the executor should cite the docs page in the phase report).
- Key present → confirm live smoke was done; absent → confirm degradation was exercised and the pending flag is in the report.
- SSE robustness: cancel mid-stream; no unhandled rejection, partial message persisted or discarded deliberately (not corrupted).

---

## Phase 8 — Adoptive import (P5b)

**Objective:** Structure arbitrary markdown: one model pass proposes questions/decision points anchored by quotes, validated server-side, stored as `synthetic` items that review like normal items and export into an appended `## Waypoint responses` section.

**References:** §5.7 (both affordances), §14 (same proxy, JSON-out prompt), §11 (synthetic export), §6 (items.synthetic + anchor).

### Tasks

- [ ] **`POST /api/documents/:id/structure`:** uses the same server-side Anthropic proxy with a JSON-out prompt proposing structured items (questions/decision points), each anchored by a quote from the source. **Validate every anchor against the source before acceptance** (§5.7, §14); reject/skip items whose quotes don't match, and report what was skipped.
- [ ] **Persistence:** accepted items stored with `synthetic = true` + `anchor` json (§6); they live in the DB only — `raw_md` stays immutable, no spliced blocks in the source.
- [ ] **UI:** on docs with no `wp:` items (and API key present), offer "Structure this document"; show proposed items for review before/after acceptance per your design (keep it simple — one pass, accept-all with per-item dismiss is fine). Synthetic items render as normal Question/Choice cards positioned near their anchor quotes (or in a dedicated section if in-place placement is disproportionate — document the choice), and respond/autosave exactly like Phase 4 items.
- [ ] **Export:** annotated export appends a `## Waypoint responses` section — each synthetic item with its quoted anchor and the response (§5.7, §11). The appended section exists **only when synthetic responses exist**; a doc with no synthetic activity still satisfies `applyReview(raw, {}) === raw` untouched.
- [ ] **Degradation:** no API key → the affordance doesn't render (consistent with Phase 7).
- [ ] **Tests (mocked SDK):** valid proposal accepted; invalid/unmatchable anchors rejected server-side; synthetic items excluded from splice paths; export appends correctly and only when warranted; no-key hides the affordance.

### Exit criteria

- The ratified P5 exit: an unstructured (no-convention) doc → "Structure this document" → structured review with answerable synthetic cards → annotated export containing the appended `## Waypoint responses` section with quoted anchors.
- Byte-fidelity: the original document body above the appended section is byte-identical to the source.
- Standing gates + spec invariants pass.

### Verification notes (reviewer)

- Feed the mocked route a proposal with a fabricated quote — it must be rejected server-side, not stored. This is the trust boundary: model output is untrusted input.
- Export an adopted doc and diff: everything above `## Waypoint responses` byte-identical to source; section formatted per spec with anchors quoted.
- Confirm synthetic items never enter the splice writer's block paths (no `wp:` blocks invented in the source).
- Confirm a normal (conventioned) doc's flow is completely unaffected by this phase.

---

## Phase 9 — Digest export + keyboard nav (P6a)

**Objective:** The two product-feature items from P6: the compact digest export for cheap agent consumption (ratified into v1), and desktop keyboard navigation over the Phase 4 focused-item model.

**References:** §11 output 2 (digest), §12 (`pull --digest`), §9 interaction model (keyboard), §8 (export formats).

### Tasks

- [ ] **Digest format:** frontmatter summary + `Q → A` pairs (including choice selections + elaborations, statuses) + comments with their quoted anchors + synthetic responses. Compact enough that an agent can act on it without re-reading the whole doc (§11). Define it precisely in `docs/SPEC.md` (or a companion section) since agents will parse it.
- [ ] **`GET /api/documents/:id/export?format=digest`** (§8) + a digest download option in the review view alongside annotated.
- [ ] **CLI:** add `waypoint pull --digest` (fetches digest alongside the annotated file, §12) — the flag deliberately omitted in Phase 5 lands now.
- [ ] **Keyboard nav (desktop, §9):** `j`/`k` next/prev item · `f` flag · `x` skip · `⌘⏎` mark answered · `a` focus agent — all driving the Phase 4 focused-item model. Must not hijack keys while typing in inputs/textareas. Add a small "?"-style hint or footer legend so the bindings are discoverable.
- [ ] **Tests:** digest snapshot tests over fixtures with known review states; keyboard handler unit tests (focus movement, input-guard).

### Exit criteria

- Digest downloadable from the web and via `waypoint pull --digest`; content covers answers, choices, comments, synthetic responses.
- Full keyboard pass over a doc: navigate, flag, skip, answer, jump to agent — without touching the mouse, and without interference while typing an answer.
- Standing gates + spec invariants pass.

### Verification notes (reviewer)

- Review the digest of the kitchen-sink fixture by eye: could an agent act on this without the source doc? (That's the acceptance bar from §11.)
- Verify `j/k` etc. are inert while a textarea is focused, and `⌘⏎` marks answered from within one.
- Confirm `pull --digest` writes both files and still clears the pointer / marks `pulled` (no Phase 5 regression).

---

## Phase 10 — Skills, docs, smoke, release workflow (P6b)

**Objective:** Ship-readiness: the Claude Code skill (authoring + loop behavior), `init` skill installation, Playwright smoke, onboarding docs for both vanilla and Polaris users, ops polish, and the release workflow (authored — publishing remains a manual later step).

**References:** §13 (skill — read all, including the docs-verification note), §17 item 5 (Playwright), §16 (ops/backup), §18 P6 row, §4 (versioning contract).

### Tasks

- [ ] **Skill** `skills/waypoint/`: `SKILL.md` + `references/authoring.md` (how to write SPEC v1 docs: text vs choice, ID discipline, self-contained prompts, pre-filling draft answers) + `references/examples.md` (§13). Loop behavior: after producing a plan/summary for human review, shell out to `waypoint push`; at session start, if `.waypoint/pending.json` exists, check status and `waypoint pull` completed reviews, then act on annotations/digest. **Verify current skill-install conventions against https://docs.claude.com/en/docs/claude-code/overview before writing** (§13) — do not assume the format from memory.
- [ ] **`waypoint init` skill install:** fill the Phase 5 seam — install the skill into `.claude/skills/waypoint/` (project-local) or `~/.claude/skills/` with `--global` (§12, §13).
- [ ] **Playwright smoke (minimal, §17):** import → answer → export happy path against a real running server. Wire `pnpm test:e2e` (separate from unit `pnpm test` so the standing gate stays fast).
- [ ] **Docs:** root `README.md` — what Waypoint is, quickstart (docker compose and bare `pnpm`), env var table (§16), CLI usage, phone-over-Tailscale setup note, both onboarding paths: vanilla (`waypoint init`) and Polaris (pulls `skills/waypoint` pinned to a release tag — document the tag contract from §4/§13; the hook itself lives in Polaris, Waypoint's obligation is a stable tagged path).
- [ ] **Ops polish:** `sqlite3 .backup` script + backup docs (§16); final pass on Docker instructions.
- [ ] **Release workflow (authored, NOT run):** `.github/workflows/release.yml` — on tag: run gates, tag carries spec version, build + `npm publish` of `waypoint-md` gated on `NPM_TOKEN`. No remote and no publishing happen in this run; the workflow is the recipe for the later manual step. Document the manual release steps (flip `private`, set token, tag) in the README or `docs/RELEASING.md`.
- [ ] **Final sweep:** `docs/SPEC.md` version stamped; `.claude/CLAUDE.md` still accurate; no stray TODOs; gates green.

### Exit criteria

- The ratified P6 exit: a Polaris user and a vanilla user can both onboard from the README alone — vanilla path exercised for real (`waypoint init` in a scratch repo installs the skill + config), Polaris path documented against the stable tagged `skills/waypoint` artifact.
- Playwright smoke green locally.
- Release workflow and RELEASING doc exist; nothing was published.
- Standing gates + spec invariants pass — final full-suite run.

### Verification notes (reviewer)

- Follow the README yourself in a scratch directory as a vanilla user: init, push, answer, pull. Every command in the README must work as written.
- Read `SKILL.md` against the current Claude Code skill conventions (the executor should cite the docs page checked).
- Run the Playwright smoke; confirm it is excluded from `pnpm test` (standing gate speed) but wired to its own script.
- Inspect `release.yml` for accidental publish triggers (must require a tag + token; nothing on push to main). Confirm `waypoint-md` remains `private: true` in this run.
- Confirm the backup script produces a restorable copy (run it, open the copy with sqlite3).

---

## Risks & watch items (execution-level)

Architecture risks live in §19; these are risks specific to this run:

1. **DOM→source anchor mapping (Phase 6)** is the highest-uncertainty implementation task in the plan. If it balloons, the fallback posture is: anchor from rendered-text with source verification, degrade harder to the unanchored list — flag for discussion rather than gold-plating.
2. **Node 20 local vs Node 22 pinned:** better-sqlite3 ships prebuilds for both, but any native-module or `engines` friction must be resolved in favor of "works on the local v20 shell without nvm" (ratified). Docker/CI stay on 22.
3. **CI never runs here:** the reviewer's local gate run is the CI. Treat a green local gate as mandatory, not advisory.
4. **Model ID drift (Phase 7):** `claude-sonnet-5` and friends must be verified against live docs at implementation time; hardcode via one constants/config module so a later correction is a one-line change.
5. **Anthropic key timing:** may appear in `.env` at any point. No phase blocks on it; Phase 7's live smoke is the only thing it gates, and that degrades to "pending" cleanly.

## Deferred (do not build)

Per §2 non-goals and §19: multi-user/permissions, generative UI, SaaS/billing, native apps, realtime collab, non-markdown inputs, copy-forward of answers on re-push (v1.1), Postgres. Executors seeing an "easy win" in these areas: note it, skip it.
