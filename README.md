# Waypoint

Waypoint is a self-hostable web app for reviewing agent-generated markdown. An
agent (Claude Code via the Waypoint skill, or anything that writes markdown)
produces a plan, summary, or set of questions; Waypoint renders it as an
interactive review surface — answer boxes, choice groups, selection comments,
progress tracking, an optional AI sidebar — and emits an annotated markdown file
the agent can act on.

The loop:

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

Everything works with **zero CLI**: drag-and-drop upload, paste raw markdown,
point the server at a path, or fetch a URL. The `waypoint` CLI is an accelerator,
not a dependency.

- **The convention** (SPEC v1): a tiny set of HTML-comment markers that read as
  plain markdown in any editor and parse deterministically. See
  [`docs/SPEC.md`](docs/SPEC.md).
- **Clean diffs are a feature**: exported markdown is byte-identical to the
  source everywhere the reviewer didn't touch.

## Quickstart

### Option A — Docker (recommended)

Single container, single process, one mounted volume for data.

```bash
# from the repo root
docker compose -f docker/compose.yml up --build
# open http://localhost:3000
```

Configuration is via environment variables (see the table below). To set them,
export before `up` or put them in a `.env` at the repo root (compose reads it):

```bash
WAYPOINT_TOKEN=$(openssl rand -hex 32) docker compose -f docker/compose.yml up --build
```

Data (the SQLite file + uploads) lives in the `waypoint-data` volume. See
[Backups](#backups).

### Option B — Bare pnpm (no Docker)

Requires pnpm 10 and Node 22 (a Node 20.x dev shell also works — the `engines`
mismatch warns, it does not fail; do not rely on `nvm use`).

```bash
pnpm install
pnpm build
```

Then start the standalone server. Next.js `output: 'standalone'` means `next
start` is **not** the right command; run the built server directly. Two things
the standalone output does not include on its own:

- **static assets** — `next build` leaves CSS/JS in `apps/web/.next/static`,
  but the standalone server only serves what sits beside `server.js`. Skip the
  copy and every page renders unstyled.
- **migrations** — the standalone server runs from a different cwd, so
  `./drizzle` is not beside it; without `WAYPOINT_MIGRATIONS_DIR` the boot
  migration fails with `Can't find meta/_journal.json`.

```bash
# from the repo root — copy assets once per build, then start
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public

WAYPOINT_MIGRATIONS_DIR="$PWD/apps/web/drizzle" \
WAYPOINT_DATA_DIR="$PWD/.waypoint-data" \
  node apps/web/.next/standalone/apps/web/server.js
# open http://localhost:3000
```

For local development with hot reload, use `pnpm dev` instead (runs
`next dev`, which serves assets itself and finds `./drizzle` from `apps/web`).

## Environment variables (§16)

| Env var | Purpose | Default |
|---|---|---|
| `PORT` | Listen port | `3000` |
| `WAYPOINT_DATA_DIR` | SQLite file + raw upload store | `~/.waypoint/data` |
| `WAYPOINT_TOKEN` | Auth token. Unset = fully open (loud startup warning); set = always enforced | unset |
| `WAYPOINT_ALLOWED_ROOTS` | Colon-separated allowlist for the path-ingest door; unset = door disabled | unset |
| `WAYPOINT_PUBLIC_URL` | Absolute base URL used in CLI output | inferred |
| `WAYPOINT_COOKIE_SECURE` | Set the `Secure` flag on the web session cookie; enable only when reachable exclusively over HTTPS | unset |
| `ANTHROPIC_API_KEY` | Enables the AI sidebar + adoptive import; unset = those features are hidden | unset |
| `WAYPOINT_MODEL` | Default sidebar model (changeable at runtime in `/settings`) | `claude-sonnet-5` |
| `WAYPOINT_MIGRATIONS_DIR` | Absolute path to the drizzle migrations folder (needed for the non-Docker standalone start) | `./drizzle` |

Secrets (`WAYPOINT_TOKEN`, `ANTHROPIC_API_KEY`) live in env only — never in the DB
or client bundles. Copy [`.env.example`](.env.example) to `.env` to fill them in;
`.env` is gitignored.

## Reviewing from your phone (Tailscale)

Waypoint's UI is responsive and touch-sized for couch/phone review. The
recommended setup: run Waypoint on your desktop or a home box, put
[`tailscale serve`](https://tailscale.com/kb/1242/tailscale-serve) in front of it,
and review from any device on your tailnet.

```bash
# on the machine running Waypoint
tailscale serve 3000
```

Tailscale is the recommended network boundary. `WAYPOINT_TOKEN` is
defense-in-depth for LAN exposure; leave it unset for a Tailscale-only box if you
prefer zero-config. Because `tailscale serve` terminates TLS, the app itself sees
plain HTTP — so the session cookie is not `Secure` by default. Only set
`WAYPOINT_COOKIE_SECURE=1` if every path to the app is HTTPS.

## CLI usage

The CLI is published to npm as **`waypoint-md`**; the binary is `waypoint`. Run it
with `npx waypoint-md <command>` or install it globally.

```bash
# one-time, in a repo: write .waypoint.json, ignore the pointer dir, install the skill
waypoint init [--url http://box:3000] [--project acme-api]

# set your token out-of-band (never written to the project-local config)
waypoint config set token <token>          # or: export WAYPOINT_TOKEN=<token>

# push a doc for review; prints a review URL, drops .waypoint/pending.json
waypoint push docs/plan.md --project acme-api

# check review states / open in a browser
waypoint status
waypoint open

# pull the annotated review beside the source, mark it pulled, clear the pointer
waypoint pull [--latest] [--digest]
```

Config resolves flags → env (`WAYPOINT_URL`, `WAYPOINT_TOKEN`) → `.waypoint.json`
→ `~/.waypoint/config.json`. If the server is unreachable, `push` queues the
payload in `~/.waypoint/outbox/` and never hard-fails; `waypoint push --flush`
retries.

## Onboarding an agent (the Waypoint skill)

Waypoint ships a Claude Code skill at [`skills/waypoint/`](skills/waypoint/) that
teaches an agent to author review docs and run the push/pull loop. There are two
front doors to the **same** artifact:

**Vanilla (any Claude Code user, no Polaris).** `waypoint init` installs the skill
into the repo at `.claude/skills/waypoint/` (or `~/.claude/skills/waypoint/` with
`--global`). That's it — `/waypoint` is available, and Claude loads it
automatically when you produce something worth reviewing.

**Polaris.** Polaris's `enable waypoint` pulls this same `skills/waypoint/` folder
**pinned to a Waypoint release tag**. Waypoint's obligation is only to keep a
stable, tagged path: `skills/waypoint/` at a git tag like `v1.0.0`. The pull hook
lives in Polaris; Waypoint just guarantees the artifact's location and that the
skill it contains matches the SPEC version shipped at that tag (see
[Versioning](#versioning)). Neither tool depends on the other.

## Versioning & the tag contract

- [`docs/SPEC.md`](docs/SPEC.md) carries its own semver (`SPEC_VERSION`) and is the
  only public contract. Anything consuming Waypoint output should pin to a spec
  version; documents opt in with `waypoint: 1` (the major version of the line).
- The app and CLI iterate freely as long as they honor the spec version they
  declare (`GET /api/health` reports both the app and spec versions; the CLI warns
  on a mismatch).
- Skill consumers (Polaris, or anyone) pin `skills/waypoint/` to a **release tag**.
  A tag is the stable coordinate: `skills/waypoint/` at `vX.Y.Z` ships the skill
  and references consistent with the SPEC version of that release.

## Releasing

Publishing `waypoint-md` to npm is a deliberate manual step, not part of normal
CI. The steps and the authored release workflow are in
[`docs/RELEASING.md`](docs/RELEASING.md). In this repository `waypoint-md` is kept
`private: true` so it can never be published accidentally.

## Development

```bash
pnpm install
pnpm dev            # next dev on http://localhost:3000
pnpm typecheck      # tsc across the workspace
pnpm lint           # eslint across the workspace
pnpm test           # vitest (unit + route-handler tests) — the fast standing gate
pnpm build          # standalone build across the workspace
pnpm test:e2e       # Playwright smoke against a real server (separate from `test`)
```

`pnpm test:e2e` boots a real `next dev` server (with a throwaway data dir) and
drives it in a browser. One-time setup: `pnpm --filter @waypoint/web exec
playwright install chromium`. It is kept out of `pnpm test` so the standing gate
stays fast.

- `apps/web` — Next.js 15 (App Router), React 19, Tailwind v4 + shadcn/ui,
  Drizzle ORM + better-sqlite3 (WAL).
- `packages/spec` — `@waypoint/spec`: the parser, splice writer, types, and golden
  fixtures. The byte-fidelity and round-trip invariants live here.
- `packages/cli` — the `waypoint` CLI (published as `waypoint-md`).

## Backups

Data is two things: the SQLite file and the upload store, both under
`WAYPOINT_DATA_DIR`. The SQLite database runs in WAL mode, so copy it with the
online-backup script rather than `cp` (a raw copy can miss un-checkpointed WAL
pages):

```bash
# writes a consistent snapshot; pass the data dir and an output path
./scripts/backup.sh [DATA_DIR] [OUT_DIR]
# e.g.
./scripts/backup.sh ~/.waypoint/data ~/waypoint-backups
```

Restore by stopping the server and putting the backed-up `waypoint.db` back at
`$WAYPOINT_DATA_DIR/waypoint.db`. See [`scripts/backup.sh`](scripts/backup.sh) for
details.
