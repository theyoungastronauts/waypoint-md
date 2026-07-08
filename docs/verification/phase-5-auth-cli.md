# Phase 5 — Auth + CLI (P3) — Verification

**Verdict:** PASS WITH WARNINGS

**Reviewer:** reviewer agent (fresh session) · **Date:** 2026-07-07 · **Scope:** the uncommitted Phase 5 working tree
**Environment:** local Node v20.19.5 shell (no `nvm`), pnpm 10.12.4 — the ratified gate machine

Phase 5 delivers the ratified P3 exit: single-token auth (open ↔ enforced) behind one central middleware, and the `waypoint` CLI (init / push / status / pull / open / config) with a pointer file and an offline outbox. I ran the standing gates, read the full auth + CLI surface, and exercised a real production server hands-on in **both** auth modes plus the complete CLI loop via the built `dist`. The security-critical auth surface is correct under live testing. One real security gap (an open-redirect the login page's `next` filter fails to close) and several v1-acceptable sharp edges are documented below. Nothing breaks a spec invariant, the export contract, or core auth enforcement.

---

## Standing gates (Node 20 shell) — all green

| Gate | Result |
|---|---|
| `pnpm typecheck` | Done (spec, cli, web) |
| `pnpm lint` | Done (no errors) |
| `pnpm test` | **197 passed / 23 files**, incl. 42 spec-invariant tests + 13 auth-middleware tests + CLI push/pull/config/init + the cross-package push→pull round-trip |
| `pnpm build` | Done (Next standalone; middleware bundles at 34.6 kB — confirms the auth module is Edge-safe) |

Engines warning (`wanted node>=22, current v20.19.5`) is the ratified, expected state — warns, does not fail. The #1 non-negotiable (`applyReview(raw,{}) === raw` + round-trip, `packages/spec/src/invariants.test.ts`, 42 tests over all fixtures) stayed green.

---

## Hands-on: auth matrix (real standalone server, scratch HOME + data dir, port 3517)

Server run the supported way for `output: standalone` — `node .next/standalone/apps/web/server.js` with `WAYPOINT_MIGRATIONS_DIR` pointed at `apps/web/drizzle` (migrations aren't traced into the standalone bundle; `lib/db/migrate.ts:11` supports exactly this env override for the Docker/standalone cwd).

### Enforced mode (`WAYPOINT_TOKEN` set) — every cell correct

| Request | Credential | Result | Expected |
|---|---|---|---|
| `GET /api/health` | none | **200** | open in both modes ✓ |
| `GET /api/documents` | valid bearer | **200** | ✓ |
| `GET /api/documents` | invalid bearer | **401** | ✓ |
| `GET /api/documents` | missing | **401** | ✓ |
| `GET /api/documents` | valid cookie | **200** | ✓ |
| `GET /api/documents` | wrong cookie | **401** | ✓ |
| `GET /d/abc123` (page) | none | **307 → `/login?next=%2Fd%2Fabc123`** | redirect w/ return path ✓ |
| `GET /` (page) | valid cookie | **200** | ✓ |
| `POST /api/auth/login` | wrong token | **401**, no `set-cookie` | ✓ |
| `POST /api/auth/login` | correct token | **200** + `Set-Cookie: wp_session=…; Path=/; Max-Age=2592000; HttpOnly; SameSite=lax` | httpOnly cookie ✓ |

### Open mode (`WAYPOINT_TOKEN` unset) — correct

- **Loud startup warning present** in the server log: the 72-char `!!!!` banner + `WAYPOINT IS RUNNING WITH NO AUTH — WAYPOINT_TOKEN is not set` (`apps/web/instrumentation.ts:24`), confirming instrumentation runs on the standalone boot.
- `GET /api/health` → 200, `GET /api/documents` → 200, `GET /` → 200, all with **no** credentials.
- `POST /api/auth/login` in open mode → **400 `auth_disabled`** with a clear "auth is open and login is unnecessary" message.

### Central-gate / matcher analysis

- **No route bypasses the central helper.** All 7 API route handlers live under `/api/*`; none reads `WAYPOINT_TOKEN` or does its own auth (only `apps/web/app/api/auth/login/route.ts` calls `credentialAuthorizes`, and it must, to mint the cookie). Enforcement is 100% in `apps/web/middleware.ts`.
- **Matcher has no gap.** `matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]` (`middleware.ts:51`). The negative lookahead is anchored at path start; none of the three exclusions is a prefix of any `/api/...` path, so no API route is accidentally exempted. A crafted `/api/documents/_next/static/x` still matches (starts with `api`) and is protected. `isOpenPath` (health + login route + login page) is the only opt-out, exactly as the plan requires ("routes must opt out").
- **Edge-safety confirmed.** `lib/auth.ts` has zero `node:` imports — `constantTimeEqual` uses `TextEncoder` (Web API). Middleware built and ran in the Edge runtime without error.
- **Token read at request time, not module load.** `getConfiguredToken()` (`lib/auth.ts:26`) reads `process.env.WAYPOINT_TOKEN` inside the function on every call; `authEnabled`/`credentialAuthorizes` both delegate to it. No module-scope capture.

---

## Hands-on: CLI loop via built `dist` (Node 20, no `nvm`)

Isolated with a scratch `HOME` so the real `~/.waypoint` was never touched (verified absent after the run).

- **`init`** → wrote a token-free `.waypoint.json` (`{url, project}`; no `token` key), appended `.waypoint/` to `.gitignore`, and printed "set your token out-of-band". ✓
- **Auth-failure discipline (the important CLI security behavior):** `push` with **no token** and with a **wrong token** against the enforced server both produced a clean `Unauthorized. Set a token with…` message, **exit 1**, **no outbox file, no pointer**. `ApiError` (401) is correctly distinguished from `NetworkError` — 401s are never queued. ✓
- **`push` (correct token)** → 201, printed the `WAYPOINT_PUBLIC_URL`-aware review URL, wrote `.waypoint/pending.json` (id, source `docs/plan.md`, pushedAt, url). Server stored it `sourceType: "cli"`, `source_path: docs/plan.md`. ✓
- **`status`** → listed the project's doc, flagged the pending pull with `*` and the follow-up hint. ✓
- **`pull`** → wrote `docs/plan.review.md` **beside the source**, marked the doc `pulled` server-side, cleared the pointer. The pulled file is **byte-identical** to the source (matching sha256 `c51fd58…`) — untouched doc ⇒ `applyReview(raw,{}) === raw`. ✓
- **`config set token`** → wrote to `~/.waypoint/config.json` (scratch HOME) only; `.waypoint.json` still has **no** token; the echo prints `(hidden)`, never the secret. ✓
- **`.gitignore` append is idempotent** — running `init --force` twice left a single `.waypoint/` line. ✓
- **No `--digest` flag** — `pull --digest` → `error: unknown option '--digest'`. Correctly deferred to Phase 9. ✓
- **Offline outbox:** with the server killed, `push` queued to `~/.waypoint/outbox/<ts>-<rand>.json` (plain JSON: markdown + source + host + project), printed a plain "queued offline and will not be lost / retry with `waypoint push --flush`", **exit 0** (never hard-fails). After restart, `push --flush` **delivered** the queued push, re-wrote the pointer, and emptied the outbox (0 files). A second flush on an empty outbox → "Outbox is empty — nothing to flush." ✓
- **Bonus:** the flushed re-push (same project+path) correctly **superseded** the earlier doc — old doc moved to `archived`, new doc `pending` (§6 supersede works through the CLI door too).

---

## Executor deviations — judged on the merits

1. **`init` appends `.gitignore` by default with `--no-gitignore` opt-out** (plan said "offers to"). **Approved.** The CLI is agent-driven (the Waypoint skill shells out to it); an interactive prompt is hostile to non-interactive use. Appending `.waypoint/` is safe, idempotent, and almost always desired; the opt-out preserves control. Honors the plan's intent better than its letter.
2. **Session cookie value IS the raw token** (httpOnly, sameSite=lax, no session store). **Approved for v1; HMAC not warranted now.** With a single shared secret and no session lifecycle/revocation, a derived value adds obfuscation, not security — rotation is "change `WAYPOINT_TOKEN`", which invalidates everything regardless. Blast radius of a stolen cookie == a stolen CLI bearer, which already sits in plaintext at `~/.waypoint/config.json`. A fine follow-up **if** sessions ever gain per-session revocation. (See WARN-2 on the `Secure` flag.)
3. **In-page fetch after cookie expiry shows an error tick, no auto-redirect.** **Acceptable.** No data loss; the middleware redirects on the next full navigation. Reasonable later polish.
4. **Outbox is per-user, `--flush` delivers to the currently-configured server.** **Acceptable.** Consistent with the spec's `~/.waypoint/outbox/` (per-user home). Minor sharp edge noted below.
5. **CLI "door" as `{markdown, source}` on `POST /api/documents` with `sourceType: "cli"`** rather than a separate endpoint. **Approved — this matches §7** ("CLI push → same API"). Presence of `source.path` promotes paste→cli and drives supersede + round-trip. Clean reuse of the ingest pipeline; verified end-to-end above.
6. **push→pull integration test lives in `apps/web` importing the CLI cross-package.** **Acceptable.** The route handlers live in web; the test dispatches the CLI client's fetches to the real handlers and asserts byte-identity + `pulled`. Legitimate integration coverage. Cross-package relative imports (`../../../../../packages/cli/src/...`) are slightly fragile but work in the vitest workspace.

---

## Findings

### WARN-1 (security, should fix) — login `next` open-redirect filter is bypassable

`apps/web/app/login/page.tsx:42` guards the post-login redirect with:

```ts
window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
```

This is the known-weak open-redirect filter. A `next` value containing a backslash slips through and `new URL()` / the browser normalize `\` → `/`, producing a **cross-origin** redirect. Verified empirically:

- `next=/\evil.com` → passes filter → resolves to `http://evil.com/`
- `next=/\/evil.com` → passes filter → resolves to `http://evil.com/`
- `next=/%5Cevil.com` (percent-encoded backslash, decoded by `URLSearchParams`) → same class of bypass

This fails the plan's explicit Phase 5 criterion ("a `next` param that cannot open-redirect") and contradicts the code's own comment ("Only honor same-origin relative paths"). Impact is contained — it fires **after** the user authenticates and the token is not exposed (it stays in the httpOnly cookie for the real origin) — so this is a WARN (CWE-601 phishing/redirect abuse), not a hard auth break. But it is a one-line fix and I recommend closing it before commit:

```ts
const raw = new URLSearchParams(window.location.search).get("next");
let dest = "/";
if (raw) {
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin === window.location.origin) dest = u.pathname + u.search + u.hash;
  } catch { /* ignore malformed next */ }
}
window.location.href = dest;
```

Add a regression test (a `/\evil.com` case) alongside the existing middleware `next`-param test.

### WARN-2 (minor, by design) — session cookie has no `Secure` attribute

`apps/web/app/api/auth/login/route.ts:42` sets the cookie httpOnly + sameSite=lax but not `secure`. Defensible for the ratified deployment model (localhost / `tailscale serve` terminates TLS and forwards HTTP internally, where a hard `Secure` would break login). Worth a one-line comment noting the choice, or a `secure` opt-in for operators fronting the app with real HTTPS. Because the cookie value equals the token (deviation 2), this is the main way the token could leak on a plaintext-sniffable path — hence noting it here rather than folding it into deviation 2.

### INFO — outbox `--flush` targets the current server

If a user queues a push against server A, reconfigures to server B, then flushes, the queued payload delivers to B. Single-server users never hit this; documenting the behavior (or stamping the target URL into the outbox entry) would remove the sharp edge. Not a v1 blocker.

### CLEANUP — stray `n.review.md` at repo root should not be committed

A 2-byte artifact (`x\n`, a leftover `waypoint pull` of a pasted test doc) sits at the repo root and is **not** gitignored — `git add -A` would commit it. It is unrelated to Phase 5's deliverables. Recommend deleting it (or excluding it) before the phase commit. (I did not create it and left the working tree untouched per the run rules — flagging for the committer.)

### INFO — standalone bundle omits Drizzle migrations

`node .next/standalone/apps/web/server.js` alone crashes in `instrumentation.register()` with `Can't find meta/_journal.json` unless `WAYPOINT_MIGRATIONS_DIR` points at the committed `drizzle/` folder (or the folder is copied into the bundle). The Dockerfile is expected to handle this (it's a Phase 1 packaging concern, not Phase 5), but worth confirming the Docker image copies `apps/web/drizzle` / sets the env — otherwise a container boot would fail migrations the same way. Flagging so Phase 10's ops pass covers it.

---

## Exit criteria (plan §Phase 5) — met

- ✅ `waypoint push` from a repo (token set) → review in web (login page + cookie exchange work) → `waypoint pull` writes `<name>.review.md` beside source, pointer cleared, doc `pulled`.
- ✅ Token unset → everything works open + loud startup warning. Token set → unauthenticated API 401s and page visits redirect to `/login`.
- ✅ Standing gates + spec invariants pass (197 tests).
- ✅ Token never in `.waypoint.json` (verified live, incl. `config set token`); `.waypoint/` gitignore append idempotent; no `--digest`.
- ✅ CLI runs via built `dist` on the Node 20 shell without `nvm`.

---

## Recommendation

**PASS WITH WARNINGS.** The security-critical auth surface (open ↔ enforced enforcement, central middleware, Edge-safe module, request-time token read, httpOnly cookie exchange) is correct under live testing in both modes, and the full CLI loop — including the offline outbox and 401 discipline — works end-to-end. **Recommend fixing WARN-1 (open-redirect) before the phase commit**, since it fails an explicit acceptance criterion and is a one-line change; the remaining items are v1-acceptable or belong to Phase 10 ops. Also delete the stray `n.review.md` before committing.
