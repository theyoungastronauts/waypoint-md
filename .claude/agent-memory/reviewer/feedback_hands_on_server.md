---
name: feedback-hands-on-server
description: How to run the built Waypoint web server for hands-on verification (standalone + migrations env), and the two dead ends to skip.
metadata:
  type: feedback
---

For hands-on review of the Waypoint web app, run the **standalone** server, not `next start`.

**Why:** the app uses `output: 'standalone'`. Two dead ends I hit: (1) `next start` returns **500** on every route with a "does not work with output: standalone" warning; (2) running `node .next/standalone/apps/web/server.js` raw crashes in `instrumentation.register()` with `Can't find meta/_journal.json` — the Drizzle migrations folder isn't traced into the standalone bundle.

**How to apply:** build (`pnpm build`), then start with the migrations dir pointed at the committed folder and a scratch HOME/data dir so you never touch the real `~/.waypoint`:

```
HOME=$SCRATCH/home WAYPOINT_DATA_DIR=$SCRATCH/data \
WAYPOINT_MIGRATIONS_DIR=/Users/tyler/prj/waypoint/apps/web/drizzle \
WAYPOINT_TOKEN=... PORT=3517 HOSTNAME=127.0.0.1 \
node /Users/tyler/prj/waypoint/apps/web/.next/standalone/apps/web/server.js
```

`lib/db/migrate.ts` reads `WAYPOINT_MIGRATIONS_DIR` (falls back to `cwd/drizzle`) precisely for the standalone/Docker cwd difference. For CLI tests, set the same scratch `HOME` so `~/.waypoint` (global config + outbox) is isolated. See [[feedback-shell-json-probes]] for probe hygiene.

**AI key gotcha (Phase 8+):** you cannot exercise the *no-key* degradation path against a live server just by not exporting `ANTHROPIC_API_KEY`. `instrumentation.register()` calls `loadRepoEnv()` (`apps/web/lib/env.ts`), which walks up from cwd to the dir holding `pnpm-workspace.yaml` and `dotenv`-loads the repo-root `.env` with `override:false`. So the standalone server always picks up the repo-root `.env` key even with `env -u ANTHROPIC_API_KEY` and a clean cwd — `/api/health` shows `aiEnabled:true`. The repo-root `.env` currently holds a **dummy/invalid** key (Anthropic replies `401 authentication_error`), so a real structuring/chat call fails 502 and the *live* AI smoke stays pending a valid key. Verify the no-key path via the mocked tests instead (they delete `process.env.ANTHROPIC_API_KEY`); do NOT move/rename the user's `.env` to force it.
