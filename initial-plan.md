# Waypoint — v1 Technical Architecture

**Status:** Draft for review · **Date:** 2026-07-07 · **Owner:** Tyler
**Note:** §20 ("Decisions to ratify") is written in the Waypoint review convention itself — it doubles as a live example of the format, and you can answer it by hand right in your editor. Which is the point.

---

## 1. Overview

Waypoint is a self-hostable web app for reviewing agent-generated markdown. An agent (Claude Code, via the Waypoint skill, or anything else that writes markdown) produces a plan, summary, or set of questions; Waypoint renders it as an interactive review surface — answer boxes, choice groups, selection comments, progress tracking, an optional AI sidebar — and emits an annotated markdown file the agent can act on.

The core loop:

```
agent writes review doc ──▶ ingest (CLI push / upload / paste / path / URL)
                                      │
                              Waypoint web UI
                     (answer, choose, comment, flag, chat)
                                      │
                    annotated .md ◀── export / CLI pull
                                      │
                          agent acts on annotations
```

Waypoint is a standalone product. Polaris integrates with it by pulling Waypoint's published skills (pinned to a release tag), but neither tool depends on the other.

## 2. Goals & non-goals

**v1 goals**

1. **File-first portability.** Every core flow — import, review, export — works with zero CLI involvement: drag-and-drop upload, paste raw markdown, point the server at a path, or fetch a URL. The CLI is an accelerator, never a dependency.
2. **A tiny, stable convention** (SPEC v1) that reads as plain markdown in any editor, parses deterministically, and can even be answered by hand without the app.
3. **Round-trip fidelity.** Exported markdown is byte-identical to the source everywhere the reviewer didn't touch. Clean diffs are a feature.
4. **Reviewable anywhere.** Responsive UI that works from a phone or tablet over Tailscale; dark mode default.
5. **Queue, not inbox-zero anxiety.** A dashboard of pending/in-review/completed docs, filterable by project.
6. **AI sidebar** scoped to the document + your answers, with an "insert into answer" affordance, plus an "adoptive import" pass that structures arbitrary markdown.

**Non-goals for v1** (explicitly deferred): multi-user accounts and permissions, generative UI, hosted SaaS/billing, native mobile/desktop apps (Flutter), realtime collaboration, and non-markdown input formats. The architecture shouldn't preclude these, but no code is written for them.

## 3. System at a glance

```
┌──────────── sources ────────────┐
│ CLI push · upload · paste       │
│ server path · URL fetch         │
└───────────────┬─────────────────┘
                ▼
        POST /api/documents        ┌────────────────────┐
                │                  │  Anthropic API      │
                ▼                  │  (sidebar + adopt)  │
┌───────────────────────────────┐  └─────────▲──────────┘
│  Next.js app (single process) │            │ server-side only
│  · route handlers (REST/SSE)  │────────────┘
│  · React review UI            │
│  · @waypoint/spec (parser)    │
└───────┬───────────────────────┘
        ▼
  SQLite (Drizzle, WAL)  +  data dir (raw uploads)
        │
        ▼
  export: annotated .md · digest .md · CLI pull
```

One process, one SQLite file, one data directory. Backup = copy two things.

## 4. Repository layout

pnpm workspace monorepo. No Turborepo — three packages don't need it.

```
waypoint/
├── apps/
│   └── web/                  # Next.js 15 (App Router) — UI + API routes
├── packages/
│   ├── spec/                 # @waypoint/spec — parser, splice writer, types, fixtures
│   └── cli/                  # waypoint CLI (commander, zero heavy deps)
├── skills/
│   └── waypoint/             # Claude Code skill: SKILL.md + references/
│       ├── SKILL.md
│       └── references/
│           ├── authoring.md  # how to write review docs (convention crash course)
│           └── examples.md
├── docs/
│   └── SPEC.md               # the convention, semver'd — the public contract
├── docker/
│   ├── Dockerfile
│   └── compose.yml
└── package.json              # pnpm workspaces, vitest at root
```

**Versioning:** `docs/SPEC.md` carries its own semver and is the only public contract. Polaris (and anyone else) pins skill pulls to release tags. App and CLI can iterate freely as long as they honor the spec version they declare.

**Stack:** Node 22 LTS · TypeScript 5 · Next.js 15 / React 19 · Tailwind v4 + shadcn/ui · TanStack Query v5 · Drizzle ORM + better-sqlite3 · zod (API validation) · unified/remark/rehype · @anthropic-ai/sdk · commander (CLI) · vitest.

## 5. The review convention (SPEC v1)

The heart of the product. Design principles:

- **Reads as plain markdown.** All machinery lives in HTML comments (`<!-- wp:… -->`), which are invisible in any renderer. The visible content is ordinary markdown — bold questions, task-list options.
- **Hand-answerable.** A human with just a text editor can fill in answer blocks and check boxes. The app is the nice way, not the only way.
- **Deterministic.** Open/close comment pairs with explicit IDs; no heuristics required when the convention is present.
- **Splice-friendly.** Every block's byte offsets are recorded at parse time so the writer can modify only block interiors (see §11).

### 5.1 Document frontmatter

```markdown
---
waypoint: 1                  # spec version (required to opt in)
title: "RDS Migration Plan"
project: acme-api            # optional; CLI sets it
source: docs/plan.md         # optional; CLI sets it for round-trip
---
```

### 5.2 Free-text question

```markdown
<!-- wp:question id="q1" type="text" -->
**Q1 — Sizing:** Do we stay on the upgraded instance class, or right-size
down once the incident settles? What's the decision window?
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
```

The reviewer's answer is written *inside* the `wp:answer` block on export. An agent (or human) pre-filling a suggested answer just puts text there; the app shows it as a pre-populated draft.

### 5.3 Choice question

```markdown
<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — Auth model for v1:**
- [ ] Single shared token
- [ ] Per-device tokens
- [x] Tailscale-only, no app auth
<!-- wp:answer -->
Optional elaboration / "other" text lands here.
<!-- /wp:answer -->
<!-- /wp:question -->
```

`select="single" | "multi"`. Checked boxes are the selection; the answer block carries elaboration. The app renders single-select as a radio group and multi as checkboxes; by hand, the task-list boxes just work (multiple checks in a `single` parse with a warning; first checked wins). A free-text answer is always allowed — alongside a selection or instead of one; a text-only response is valid.

### 5.4 Comment (emitted on export; agents may also author them)

```markdown
<!-- wp:comment id="c1" exact="the camcorder photo beat" prefix="pays off " suffix=" in act three" -->
This contradicts the phase 2 decision — it's the barcode scanner now.
<!-- wp:suggestion -->
pays off the barcode scanner beat in act three
<!-- /wp:suggestion -->
<!-- /wp:comment -->
```

Anchoring is quote-based (`exact` + short `prefix`/`suffix` context, W3C-annotation style), not offset-based, so anchors survive minor edits. Attribute values are HTML-attribute-encoded; `prefix`/`suffix` capped at 32 chars, `exact` at 200 (longer selections fall back to `exact-hash` + truncated `exact`). The optional nested `wp:suggestion` block carries proposed replacement text. Comments are placed in the source immediately after the block containing the anchor.

### 5.5 Answer status (written on export)

```markdown
<!-- wp:answer status="flagged" -->
Need to check with Jona before answering.
<!-- /wp:answer -->
```

`status ∈ answered | flagged | skipped` (absent = untouched).

### 5.6 Parsing

`@waypoint/spec` exposes:

```ts
parseDocument(raw: string): {
  frontmatter: Frontmatter
  items: Item[]          // questions with type, config, prompt md, spans
  comments: Comment[]
  spans: SpanIndex       // byte offsets for every wp block + interiors
  warnings: Warning[]    // unpaired tags, duplicate ids, etc.
}

applyReview(raw: string, review: ReviewState): string   // splice writer, §11
```

Implementation: remark-parse (+ GFM) → walk `html` nodes → pair `wp:` open/close comments by ID with a small state machine → capture `position` offsets from mdast. Malformed pairs degrade to warnings, never hard failures — the doc still renders and is still commentable.

### 5.7 Documents without the convention

Any markdown file imports fine. Two escalating affordances:

1. **Always available:** selection comments (§10) require no structure at all.
2. **Adoptive import (opt-in, needs API key):** one model pass proposes structured items (questions/decision points) anchored by quotes; anchors are validated against the source before acceptance. These items are marked `synthetic` — they live in the DB and export into an appended `## Waypoint responses` section rather than spliced blocks, since the source has no answer anchors.

## 6. Data model

SQLite via Drizzle, WAL mode, single process. Every table ports to Postgres by swapping the Drizzle dialect if a cloud version ever happens.

```
projects      id · name · created_at

documents     id · project_id? · title · raw_md · frontmatter(json)
              source_type (cli|upload|paste|path|url)
              source_path? · source_url? · pushed_from_host?
              spec_version? · status (pending|in_review|completed|pulled)
              supersedes_id? · created_at · updated_at

items         id · document_id · wp_id ("q1") · type (text|choice)
              config(json: select, options[]) · prompt_md
              synthetic (bool) · anchor(json, for synthetic)
              order_index · span refs into raw_md

responses     item_id (pk) · value(json: {text} | {selected[], other})
              status (answered|flagged|skipped) · updated_at

comments      id · document_id · anchor(json: exact,prefix,suffix,hash)
              body_md · suggestion_md? · created_at

chat_messages id · document_id · role · content · created_at

settings      key · value        # model choice, theme, misc — not secrets
```

**Invariants:** `raw_md` is immutable after import — all review state lives in `responses`/`comments`, and export is a pure function of `(raw_md, review state)`. Re-pushing the same `project + source_path` creates a *new* document with `supersedes_id` set; the old one auto-archives. (Copying forward answers for matching `wp_id`s is a v1.1 nicety, noted in §19.)

## 7. Ingest paths — the five doors

All doors converge on one internal `ingestDocument()` service; the only difference is how bytes and source metadata arrive.

| Door | How | Notes |
|---|---|---|
| **Upload** | drag-and-drop / file picker on `/new` | multipart; .md/.markdown/.txt |
| **Paste** | textarea on `/new` | fastest phone path |
| **Server path** | text field / `{path}` in API | server reads the file; **only** under `WAYPOINT_ALLOWED_ROOTS` (§15) |
| **URL** | `{url}` in API / `/new` | raw gists, GitHub raw, etc.; 1 MB cap, text content-type check |
| **CLI push** | `waypoint push` → same API | adds `project`, `source`, host metadata for round-trip |

Ingest steps: read bytes → normalize nothing (preserve bytes exactly; the parser tolerates CRLF) → `parseDocument` → persist document + items → return `{id, url, warnings}`. Docs land with status `pending` in the queue.

## 8. API surface

REST route handlers under `apps/web/app/api/`. JSON in/out, zod-validated, bearer token or session cookie (§15).

| Method & path | Purpose |
|---|---|
| `POST /api/auth/login` | token → httpOnly session cookie (web) |
| `GET  /api/health` | version, spec version — CLI handshake |
| `GET/POST /api/projects` | list / create |
| `POST /api/documents` | ingest (multipart file \| `{markdown}` \| `{path}` \| `{url}`) |
| `GET  /api/documents?status=&project=` | queue |
| `GET  /api/documents/:id` | doc + items + responses + comments |
| `PATCH /api/documents/:id` | status transitions, project reassignment |
| `PUT  /api/items/:id/response` | upsert answer / status (autosave target) |
| `POST /api/documents/:id/comments` · `PATCH/DELETE /api/comments/:id` | selection comments |
| `GET  /api/documents/:id/export?format=annotated\|digest` | download / CLI pull |
| `POST /api/documents/:id/chat` | sidebar agent, SSE stream |
| `POST /api/documents/:id/structure` | adoptive import |

## 9. Frontend architecture

**Routes:** `/` queue dashboard · `/new` import (four tabs: upload / paste / path / URL) · `/d/[id]` review view · `/settings`.

**Render pipeline:** raw md → `@waypoint/spec` parse → custom remark plugin lifts `wp:` blocks into custom mdast nodes → rehype + `rehype-sanitize` (allowlist extended for our artifacts) → React components. Prose renders as prose; `wp:question` nodes render as interactive cards (`QuestionCard`, `ChoiceGroup`) in-place, exactly where they sit in the document.

**Review view layout:** document pane + right rail (progress ring "7/12", item nav list with status dots, agent tab). On mobile the rail collapses into a bottom sheet; tapping an item in the sheet scrolls to and focuses its card. Touch targets sized for couch use.

**Interaction model:**

- Choice cards: single-select renders as a radio group, multi as checkboxes; every choice card includes an always-visible optional elaboration field (maps to the `wp:answer` block), so the reviewer can answer freeform instead of — or on top of — a selection.
- Autosave: 800 ms debounce per item, optimistic via TanStack Query, subtle saved-tick per card. No save buttons.
- Item statuses: untouched / answered / **flagged** (revisit later — directly attacks the skimming problem) / skipped.
- Keyboard (desktop): `j/k` next/prev item · `f` flag · `x` skip · `⌘⏎` mark answered · `a` focus agent. A focused-item model underpins both keyboard nav and agent context.
- Completing the last item prompts a one-screen review summary → "mark completed."

**Theme:** dark by default (shadcn/ui tokens), light available. System font stack; reading-width prose column.

## 10. Selection comments & suggested edits

Browser Selection API over the rendered prose. On mouseup/long-press with a selection: floating "Comment" affordance → popover with comment body + optional suggested replacement.

Anchor construction: `exact` = selected text, `prefix`/`suffix` = 32 chars of surrounding context from the *source markdown* (mapped via the span index, not the DOM), so anchors are stable against rendering. Highlights render by wrapping matched ranges in `<mark>`; if an anchor no longer matches (doc superseded), the comment degrades gracefully to an "unanchored comments" list at the bottom of the review view rather than disappearing.

Suggested edits export as `wp:suggestion` blocks (§5.4) — a diff the agent can apply verbatim.

## 11. Export & round-trip

**The splice writer.** `applyReview(raw, state)` never re-serializes the AST (that normalizes formatting and produces noisy diffs). Instead it uses the span index: replace only the interiors of `wp:answer` blocks, set checkbox `[x]` states within question blocks, insert `wp:comment` blocks after their anchored source blocks, and stamp frontmatter (`waypoint_status: completed`, `reviewed_at`) — the stamp only happens when review state is non-empty. Splices apply in descending byte-offset order so insertions never invalidate later spans. **Guarantee, enforced by test: `applyReview(raw, {}) === raw`, byte-identical.**

**Outputs:**

1. **Annotated markdown** (canonical): the source with answers, checks, comments spliced in. Filename: `<name>.review.md` on CLI pull; web download button otherwise.
2. **Digest** (compact, for cheap agent consumption): frontmatter summary + `Q → A` pairs + comments with their quoted anchors. An agent can act on the digest without re-reading the whole doc.

Synthetic items (adoptive import) export into an appended `## Waypoint responses` section in the annotated file, each with its quoted anchor.

## 12. CLI

TypeScript, published to npm (final name pending §20 q1 — `waypoint` bare is likely contested; assume a scoped or suffixed name). Runs via `npx`, zero heavy deps (commander + native fetch).

| Command | Behavior |
|---|---|
| `waypoint init` | writes `.waypoint.json` (server URL, project, defaults); installs the skill into `.claude/skills/waypoint/` (project-local; `--global` → `~/.claude/skills/`); offers to append `.waypoint/` to `.gitignore` |
| `waypoint push <file> [--project p] [--title t]` | POSTs the doc with `source` = relative path + host; prints review URL; writes pointer `.waypoint/pending.json` (doc id, source path, pushed_at) |
| `waypoint status` | lists this project's docs and their review states |
| `waypoint pull [id\|--latest] [--digest]` | fetches annotated md → `<name>.review.md` beside source (and digest if asked); clears the pointer; marks doc `pulled` |
| `waypoint open [id]` | opens the review URL in a browser |
| `waypoint config` | get/set server URL and token |

**Config resolution:** flags → env (`WAYPOINT_URL`, `WAYPOINT_TOKEN`) → `.waypoint.json` → `~/.waypoint/config.json`. Token never stored in the project-local file.

**Offline fallback:** if the server is unreachable, `push` queues the payload in `~/.waypoint/outbox/` and says so plainly; `waypoint push --flush` retries. The agent's flow never hard-fails because the app is down.

## 13. Claude Code skills

One skill, `skills/waypoint/`, shipped in this repo and versioned with it:

- **Authoring:** teaches the agent to emit SPEC v1 docs — when to use text vs. choice questions, ID discipline, keeping prompts self-contained, pre-filling draft answers where it has a recommendation.
- **Loop behavior:** after producing a plan/summary intended for human review, shell out to `waypoint push`; at session start, if `.waypoint/pending.json` exists, check status and `waypoint pull` completed reviews, then act on the annotations/digest.

Install paths: `waypoint init` for anyone (vanilla Claude Code, no Polaris); Polaris's `enable waypoint` pulls this same folder pinned to a release tag. Two front doors, one artifact. (Exact skill-install conventions to be verified against current Claude Code docs at implementation time: https://docs.claude.com/en/docs/claude-code/overview.)

## 14. AI sidebar agent

- **Server-side proxy only.** `POST /api/documents/:id/chat` assembles context and streams from the Anthropic API via `@anthropic-ai/sdk` (SSE to the client). The API key never reaches the browser.
- **Context assembly (lean by design):** frontmatter + a compact index of all items with their current answers + the full text of the focused item's surrounding section + the last N chat turns. Full-document context only when the doc is small; otherwise windowed around focus. Keeps cost per question low.
- **Affordances:** streaming chat in the right rail; per-message "insert into answer" targets the focused item; "explain this question" quick action on every card (pre-seeds the chat with that item's context — the exact "I don't understand the question" moment from Claude Code, without breaking flow).
- **Adoptive import** (§5.7) uses the same proxy with a JSON-out prompt; anchors validated server-side before item creation.
- **Model:** default `claude-sonnet-5` (latest Sonnet); switchable at runtime in `/settings` between the latest Sonnet, Opus, and Fable. `WAYPOINT_MODEL` env sets the default; a settings-table value wins over it. Verify current model IDs at https://docs.claude.com/en/api/overview during implementation. One chat thread per document in v1.
- **Degradation:** no `ANTHROPIC_API_KEY` set → sidebar and adoptive import simply don't render. Everything else works.

## 15. AuthN & security

- **Single-token model (v1).** `WAYPOINT_TOKEN` env var. CLI sends it as a bearer header; the web UI has a minimal login page that exchanges it for an httpOnly cookie. If no token is set, auth is fully waived with a loud startup warning (zero-config use; localhost-origin detection is unreliable behind Docker and `tailscale serve` proxies, so we don't pretend to do it). A set token is always enforced. Tailscale remains the recommended network boundary; the token is defense-in-depth for LAN exposure.
- **Path ingest is off by default.** The `{path}` door only reads files under `WAYPOINT_ALLOWED_ROOTS` (colon-separated allowlist); unset = disabled. Prevents the API from becoming an arbitrary-file-read.
- **URL ingest:** 1 MB cap, text content-types only, no redirects to private ranges (basic SSRF hygiene).
- **Rendering:** `rehype-sanitize` with a tight allowlist — agent-authored markdown is still untrusted HTML as far as the browser is concerned.
- **Secrets:** `ANTHROPIC_API_KEY` and `WAYPOINT_TOKEN` live in env only — never in the DB, never in client bundles.

## 16. Deployment & ops

Single container, single process. `docker/compose.yml` mounts one volume for `WAYPOINT_DATA_DIR` (SQLite file + raw upload store). Next.js standalone output; `node server.js` under the hood.

| Env var | Purpose | Default |
|---|---|---|
| `PORT` | listen port | 3000 |
| `WAYPOINT_DATA_DIR` | sqlite + uploads | `~/.waypoint/data` |
| `WAYPOINT_TOKEN` | auth token | unset (localhost open) |
| `WAYPOINT_ALLOWED_ROOTS` | path-ingest allowlist | unset (door disabled) |
| `WAYPOINT_PUBLIC_URL` | absolute URLs in CLI output | inferred |
| `ANTHROPIC_API_KEY` | sidebar + adoptive import | unset (features hidden) |
| `WAYPOINT_MODEL` | sidebar model default (changeable in `/settings`) | `claude-sonnet-5` |

Recommended personal setup: run on the desktop or a home box, `tailscale serve` in front, review from any device. Backups: copy the data dir (SQLite in WAL mode; `sqlite3 .backup` script included). Migrations: `drizzle-kit` on boot.

## 17. Testing strategy

The spec package carries the critical invariants; everything else is standard.

1. **Golden fixtures** in `packages/spec/fixtures/`: kitchen-sink doc, choice variants (incl. multi-checked single-select, text-only response on a choice question), no-convention doc, malformed pairs, CRLF, nested code fences containing fake `wp:` tags (must not parse inside fences).
2. **Byte-fidelity invariant:** `applyReview(raw, {}) === raw` for every fixture.
3. **Round-trip invariant:** `parse(applyReview(raw, state))` recovers `state` exactly.
4. **API tests** (vitest + supertest-style against route handlers): ingest doors, auth, export.
5. **Playwright smoke** (P6, minimal): import → answer → export happy path.

CI: GitHub Actions — typecheck, lint, unit, build, on every PR; release workflow tags spec version + publishes CLI.

## 18. Build phases

Each phase ends usable; P2 lands before the CLI on purpose — the file-first flows are the product's floor, per the portability requirement.

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Scaffold** | monorepo, tooling, dark shell, Drizzle migrations, `/api/health`, Docker, npm name availability check, refresh `.claude/CLAUDE.md` to match this layout | `docker compose up` serves the shell |
| **P1 — Spec package** | parser, splice writer, fixtures | all §17 invariants green |
| **P2 — File-first review loop** | `/new` (upload/paste/path/URL), queue, review view with text+choice answers, autosave, annotated export download | review a real doc end-to-end with zero CLI |
| **P3 — CLI + auth** | token auth, push/pull/init/status, pointer file, offline outbox | push from a repo, answer on the phone, pull back beside the source |
| **P4 — Comments** | selection comments, suggested edits, unanchored degradation | copyedit workflow usable |
| **P5 — Sidebar** | agent chat, insert-into-answer, explain-this-question, adoptive import | unstructured doc → structured review |
| **P6 — Skills & polish** | skill authoring + loop, digest export, keyboard nav, Playwright smoke, docs, Polaris `enable` hook | a Polaris user and a vanilla user both onboard from README alone |

## 19. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Anchor drift on edited/superseded docs | quote+context anchors; graceful "unanchored comments" list; raw_md immutability |
| Markdown edge cases (fences, CRLF, HTML) | fence-aware parser, byte preservation, fixture-driven TDD on the spec package |
| Noisy export diffs | splice writer + byte-fidelity invariant (the #1 non-negotiable) |
| Sidebar cost creep | windowed context assembly; item index instead of full doc; single thread per doc |
| Re-push loses answers | v1: supersede + archive; v1.1: copy-forward responses on matching `wp_id`s |
| npm/name collisions (HashiCorp HCP Waypoint lives; `usewaypoint` org exists on GitHub) | ship under a distinct package name + domain; product name stays Waypoint |
| SQLite under concurrent writes | WAL, single process, serialized writes — fine at this scale by design |

## 20. Decisions to ratify

<!-- wp:question id="q1" type="choice" select="single" -->
**Q1 — npm package / binary name.** `waypoint` bare is almost certainly contested. My pick is pre-checked; availability check happens in P0.
- [x] `waypoint-md` (matches the review.md energy, unambiguous)
- [ ] Scoped: `@usepolaris/waypoint` (ties it to the ecosystem — but undercuts standalone identity)
- [ ] Other (name it in the answer)
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — URL import in v1?** Cheap to build, big flexibility win (raw gists, GitHub raws), small SSRF surface to manage.
- [x] Yes, in P2
- [ ] Defer to v1.1
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q3" type="choice" select="single" -->
**Q3 — Digest export in v1?** Compact Q→A output for cheap agent consumption alongside the annotated file.
- [x] Yes, in P6
- [ ] Defer
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q4" type="choice" select="single" -->
**Q4 — SQLite driver.** better-sqlite3 is boring and fast; libsql adds a future Turso/remote path at the cost of a younger driver.
- [x] better-sqlite3
- [ ] libsql
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q5" type="text" -->
**Q5 — Scope check.** Anything you'd add to or cut from P2 (the file-first floor) before I treat this plan as locked?
<!-- wp:answer -->
We're good.
<!-- /wp:answer -->
<!-- /wp:question -->