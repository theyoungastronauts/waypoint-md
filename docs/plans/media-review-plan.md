# Waypoint media publish + video review — Implementation Plan

**Status:** Ready for autonomous execution · **Source:** [media-review-spec.md](media-review-spec.md) + its ratified digest ([media-review-spec.digest.md](media-review-spec.digest.md))

Two phases, all decisions baked. Executed one phase at a time: execute → standing gates → commit → next phase. The reviewer (a separate session) verifies each phase against the exit criteria before anything is deployed. Standing gates after every phase, run in the worktree with the local Node 20 shell:

```bash
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm build
```

The `@waypoint/spec` byte-fidelity invariant (`applyReview(raw, {}) === raw`; round-trip recovers state) is the #1 non-negotiable and stays green. Neither phase touches `applyReview`/`parseDocument`; the SPEC bump is additive (a new digest section and two new labels).

## Ground rules for the executor

- **Work only in the worktree** `~/prj/waypoint-wt-media-review` (branch `feat/media-review`, already created and installed). The main checkout at `~/prj/waypoint` serves production from `apps/web/.next/standalone` through launchd; never run `pnpm build`, `next dev`, or migrations there, and never touch `~/.waypoint/` (production data and secrets).
- `pnpm` is not on PATH; every command is `corepack pnpm …` with `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` exported.
- A dev server for manual checks runs against a throwaway data dir: `WAYPOINT_DATA_DIR=$(mktemp -d) PORT=3130 corepack pnpm --filter @waypoint/web dev`. Port 3130 only; never 3000. R2 is not configured in that environment, so publish routes report `publish_unavailable` there; everything R2-facing is proven by mocked route tests (the house pattern in `apps/web/app/api/__tests__/publications.test.ts`).
- Follow the conventions already in `apps/web` (zod-validated route handlers under `app/api/*`, Drizzle + better-sqlite3, server components for reads, shadcn/ui, dark theme default) and in `packages/cli` (commander, zero heavy deps, `client.ts` fetch wrappers, `io` for output, `CliError` for user errors). Read `.claude/CLAUDE.md`, `docs/SPEC.md` §9, `docs/plans/publish-spec.md`, and the current `lib/publish/*`, `lib/publications.ts`, `lib/digest.ts`, `middleware.ts`, `lib/auth.ts` before writing code.
- Tests beside the code as you go (vitest), not after. Every new route, every new CLI command path, the digest renderer and the middleware change get tests. Mock S3 and the presigner; never call R2 from tests.
- Commit at the end of each phase with a conventional-commit message (`feat(publish): …`, `feat(review): …`). Do not push. Do not merge. Leave the worktree on the branch.
- No first-person voice in user-facing copy or docs.

## Ratified decisions (from the review)

| # | Decision |
|---|---|
| Q1 | Public exposure is a Cloudflare Tunnel on the Mac mini with ingress restricted to `/r/*` and `/api/r/*`. Everything else stays private at the edge. |
| Q2 | Public hostname `review.tylersavery.com` (env `WAYPOINT_REVIEW_PUBLIC_URL`). |
| Q3 | Media bytes go from the CLI straight to R2 through a presigned PUT, then a finalize call. The server never buffers media. |
| Q4 | **Per-reviewer links with bound names.** A review link carries the reviewer's name; comments are attributed from the link, never from the request body. |
| Q5 | Links are revocable: rotating or revoking a link kills it while the publication and its comments stay. |
| Q6 | Media digest keeps `**Anchor:** "00:12.4"` and adds a `**By:**` label. SPEC 1.2.0 (additive). |
| Q7 | Poll only in v1: `waypoint status` shows unresolved counts; no push. |
| Q8 | v1 review page: timecoded comments with tap-to-seek, general notes, resolve state (author side), version switcher per group with comments per version, **region marks (a box drawn on the paused frame)**. Threaded replies and a download link on the public page are deferred. |
| Q9 | Phase B (private media publish) then Phase C (public review), both before the first VFX spot. |

## Baked technical decisions (lead-resolved)

- **B-1 (schema, migration 0003).** `publications` gains `kind` (`markdown` \| `media`, NOT NULL DEFAULT `markdown`), `content_type`, `bytes`, `group_slug` (not `group`, a SQL keyword), `label`, `manifest_json`, `search_text` (NOT NULL DEFAULT `''`), `finalized_at`. `source_md` stays NOT NULL; media rows store `''`. The FTS5 table is recreated as `(title, source_md, search_text)` with its three triggers, then rebuilt (`INSERT INTO publications_fts(publications_fts) VALUES('rebuild')`), so `waypoint status -q vbtc` finds renders by group, label, composition, profile and format. Hand-written raw SQL in the drizzle migration, the house pattern for FTS. `drizzle-kit generate` produces the column adds; the FTS block is appended by hand.
- **B-2 (upload).** `POST /api/publications/media` validates `contentType` against an allowlist (`video/mp4`, `video/quicktime`, `video/webm`, `image/png`, `image/jpeg`, `application/pdf`) and `bytes` (1 B to 4 GiB), inserts the row (`finalized_at` null), uploads the manifest JSON immediately as `<name>.manifest.json` when given, and returns `{ id, key, uploadUrl, expiresAt }` from `@aws-sdk/s3-request-presigner` (`getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }), { expiresIn: 900 })`). `POST /api/publications/:id/finalize` issues `HeadObjectCommand`; a missing object is `409 upload_missing`; success records `bytes`, `finalized_at`, and returns `{ id, title, kind, urls: { file, manifest?, page } }` where `page` is the tailnet detail page. Unfinalized rows older than one hour are deleted lazily at the start of the next media create. Revoke deletes the file and manifest objects too. Listing and search exclude unfinalized rows.
- **B-3 (CLI upload).** `waypoint publish <file>` dispatches on extension: `.md` keeps the existing flow; `.mp4 .mov .webm .png .jpg .jpeg .pdf` take the media flow. The PUT uses `node:https` with an explicit `Content-Length` and the file piped as the body (Node's `fetch` with a stream body sends chunked encoding, which S3-compatible stores reject), printing progress every 10%. Flags: `--group`, `--label`, `--manifest <path>` (auto-detected as `<file>.manifest.json` when present), `--json` (machine output `{ id, title, kind, urls }` on stdout and nothing else). Title defaults to the filename without extension, or `title` inside the manifest when present.
- **B-4 (UI).** Publications list shows a kind badge and `group · label`; the detail page renders `<video controls playsInline>` for video kinds, `<img>` for images, an `<iframe>` for PDFs, links the file and manifest, and shows the manifest in a `<details>` block. Markdown publications are unchanged.
- **C-1 (review links).** Table `review_links`: `id, publication_id, reviewer_name, token (unique, 32 bytes hex), created_at, revoked_at, last_seen_at`. A link is created against one publication but is valid for **every finalized publication in the same `group_slug`** (so Jay's v1 link keeps working for v2). Validation: token → link (not revoked) → target publication is the link's publication or shares its non-null group. Invalid, revoked, or mismatched links return 404 everywhere (never reveal existence). Tokens are compared with `constantTimeEqual` from `lib/auth`.
- **C-2 (comments).** Table `media_comments`: `id, publication_id, review_link_id (nullable: author-side comments), author_name, timecode_ms (nullable = general note), region (JSON `{ x, y, w, h }` in 0–1 fractions, nullable), body (plain text), created_at, resolved_at`. Public bodies are plain text (no markdown rendering on the public page; escaped on output); 4 KB cap; in-memory rate limit of 30 comments per minute per IP and 500 per day per link. Resolve/unresolve is author-side only (token gate).
- **C-3 (public surface).** `lib/auth.isOpenPath` gains prefix matching for `/r/` and `/api/r/`; nothing else opens. Routes: `GET /r/[id]?k=` (page), `GET /api/r/[id]?k=` (publication summary + versions in the group + the reviewer's name), `GET /api/r/[id]/comments?k=`, `POST /api/r/[id]/comments` (`{ k, timecodeMs?, region?, body }`). The page is a server component that validates `k` and renders a client `MediaReview` component (player, live timecode chip, "Note at 00:12.4" and "General note" composers, region-mark mode that drags a box over the paused frame and stores fractions, comment list sorted by timecode with general notes first, tap-to-seek, resolved comments dimmed, version switcher linking `/r/<otherId>?k=<same token>`). Mobile-first: works one-handed on a phone; large tap targets; no hover-only affordances. The reviewer's name is displayed, never editable.
- **C-4 (authoring side).** The tailnet publications detail page gains a Review links panel (create for a name → shows the full URL with a copy button; revoke) and a Comments panel (all comments, resolve toggle). Token-gated routes: `POST/GET /api/publications/[id]/review-links`, `POST /api/publications/[id]/review-links/[linkId]/revoke`, `GET /api/publications/[id]/comments`, `POST /api/publications/[id]/comments/[commentId]/resolve` and `/unresolve`, `GET /api/publications/[id]/export?format=digest`.
- **C-5 (digest, SPEC 1.2.0).** `buildMediaDigest(publication, comments, reviewedAt)` in `lib/media-digest.ts`, pure and snapshot-tested. Frontmatter: `waypoint_digest: 1`, `kind: media`, `title`, `group`, `label`, `source` (the public file URL), `status: published`, `reviewed_at`, `comments` (count rendered), `unresolved`. Body: `# Digest — <title>`, then `## Comments` with one entry per comment: `### c<n>` (n from 1 in timecode order, general notes first), `**Anchor:** "mm:ss.d"` or `**Anchor:** "general"`, `**Region:** x,y,w,h` (four fractions to three decimals) when present, `**By:** <name>`, `**Comment:** <text>`. Unresolved comments only unless `?resolved=1`. `docs/SPEC.md` gains §9.4 "Media digests" describing exactly this, `SPEC_VERSION` bumps to `1.2.0`, and the CLI's `EXPECTED_SPEC_VERSION` follows (major unchanged, so the handshake stays quiet).
- **C-6 (CLI).** `waypoint pull <id> --digest` resolves a publication id when no document matches, writes `<sanitized-name>.digest.md` in the current directory, and skips the pointer/`pulled` side effects (publications have no pull lifecycle). New commands: `waypoint links <publication-id> --add "<name>"` (prints the review URL), `waypoint links <publication-id>` (list), `waypoint links <publication-id> --revoke <linkId>`; `waypoint resolve <publication-id> <comment-id>`; `waypoint status --publications` lists publications (kind, group, label, created, unresolved count). The existing document-only `status` output is unchanged by default so the skill's pull loop keeps working.
- **C-7 (ops, documented not executed).** `docs/ops/review-tunnel.md` records the exact steps for the reviewer to run on the Mac mini: `cloudflared tunnel create waypoint-review` (or reuse of the existing credential), a `~/.cloudflared/config.yml` with ingress rules that route `review.tylersavery.com` paths `^/r/` and `^/api/r/` to `http://localhost:3000` and everything else to `http_status:404`, `cloudflared tunnel route dns waypoint-review review.tylersavery.com`, a launchd plist for `cloudflared tunnel run`, and the `WAYPOINT_REVIEW_PUBLIC_URL` line for `~/.waypoint/env`. The executor writes the doc; the reviewer applies it.
- **C-8 (skill).** `skills/waypoint/SKILL.md` and `references/` gain a short "Media publications and reviews" section: publish a render with `--json`, mint a link per reviewer, pull the media digest, act, resolve. `packages/cli/scripts/bundle-skill.mjs` copies it on build; nothing else changes.

---

## Phase B — Media publications (private)

**Objective:** `waypoint publish <render.mp4>` stores the file on R2 without passing through the server, indexes it beside markdown publications with its render manifest, and the tailnet UI plays it back.

**References:** spec §Phase B; B-1 … B-4 above; `lib/publish/service.ts`, `lib/publish/r2.ts`, `lib/publish/paths.ts`, `lib/publications.ts`, `app/api/publications/*`, `packages/cli/src/commands/publish.ts`, `packages/cli/src/client.ts`.

### Tasks

- [ ] **Migration 0003** per B-1: schema.ts columns, `drizzle-kit generate`, hand-append the FTS recreate + triggers + rebuild. A migration test proves an existing markdown row survives with `kind = 'markdown'` and that FTS matches `search_text` for a media row.
- [ ] **`lib/publish/paths.ts`:** media object keys (`<folder>/<sanitized-name>.<ext>`, `<folder>/<sanitized-name>.manifest.json`) and `mediaUrls(publicBase, r2Folder, sanitizedName, ext, hasManifest)`.
- [ ] **`lib/publish/r2.ts`:** `presignPut({ key, contentType, contentLength })`, `headObject(key)`, `putJson(key, body)`, `deleteObjects(keys)`. Add `@aws-sdk/s3-request-presigner` to `apps/web` dependencies (same major as the S3 client).
- [ ] **`lib/publish/media.ts`:** `createMediaPublication(input)` (allowlist, size bounds, lazy GC of unfinalized rows older than 1 h, row insert, optional manifest upload, presign), `finalizeMediaPublication(id)` (HEAD, stamp, URLs), `searchTextFor(manifest, group, label)`.
- [ ] **Routes:** `POST /api/publications/media`, `POST /api/publications/[id]/finalize`; extend `GET /api/publications` summaries and `GET /api/publications/[id]` detail with kind, group, label, contentType, bytes, manifest, urls; `revoke` deletes media objects; listing/search exclude unfinalized rows. Route tests with the mocked S3 client and a mocked presigner covering: allowlist rejection, size rejection, presign shape, finalize on missing object (409), finalize success, revoke of a media row, GC of a stale unfinalized row.
- [ ] **CLI:** extension dispatch, `publishMedia` in `client.ts` (create → PUT via `node:https` with `Content-Length` and progress → finalize), flags `--group --label --manifest --json`, manifest auto-detection, title default. Tests: dispatch by extension, manifest auto-detection, `--json` output shape, upload sets `Content-Length` and streams (mock `https.request`), finalize called only after a 200 PUT.
- [ ] **UI (B-4):** list badge and group/label, detail page media rendering, manifest details, file/manifest links. Component tests where the house has them (`components/publications/__tests__`).
- [ ] **Docs:** `README.md` env table (no new env in B), CLI help text, `docs/plans/publish-spec.md` untouched (history).

### Exit criteria

- Standing gates green.
- Route tests prove the presigned flow end to end with mocks, including the 409 and GC paths.
- `corepack pnpm --filter waypoint-md build` produces a CLI whose `waypoint publish --help` shows the new flags; `waypoint publish some.mp4 --json` against a dev server without R2 prints the `publish_unavailable` error cleanly (no stack).
- A markdown publish still works exactly as before (existing publication tests unchanged and green).

### Verification notes (reviewer)

- Inspect migration 0003 SQL: column defaults, the FTS recreate, trigger names, the rebuild statement. Apply it to a copy of a real data file and confirm existing rows and FTS search survive.
- Read `publishMedia` for the streaming upload: `Content-Length` set, no whole-file buffering, progress output not on stdout when `--json`.
- Against a dev server started with real R2 env (reviewer only), publish a 25 MB render with a manifest and check the object keys, the manifest object, the detail page playback, and revoke.

---

## Phase C — Public video review

**Objective:** A per-reviewer link opens a phone-friendly page that plays the render, takes timecoded and region-marked notes, and the agent pulls those notes as a digest and resolves them.

**References:** spec §Phase C; C-1 … C-8 above; `middleware.ts`, `lib/auth.ts`, `lib/digest.ts`, `docs/SPEC.md` §9, `components/review/*` (patterns for mobile sheets and stores), `packages/cli/src/commands/{pull,status}.ts`, `skills/waypoint/*`.

### Tasks

- [ ] **Migration 0004:** `review_links`, `media_comments` per C-1 and C-2, with indexes on `(publication_id)`, `(token)`, `(publication_id, resolved_at)`.
- [ ] **`lib/review/links.ts`:** create (32-byte token), list, revoke, `resolveLink(token, publicationId)` with group scoping and constant-time comparison, `touchLastSeen`. Tests: group scoping across versions, revoked link, wrong publication, timing-safe compare used.
- [ ] **`lib/review/comments.ts`:** add (plain text, 4 KB cap, timecode and region validation), list (public and author views), resolve/unresolve. `lib/review/rate-limit.ts`: in-memory buckets per IP and per link with tests that use an injected clock.
- [ ] **Middleware:** prefix open paths `/r/` and `/api/r/`; tests prove `/r/x`, `/api/r/x/comments` pass without a token and `/api/publications`, `/d/x`, `/publications` still require one.
- [ ] **Public routes and page (C-3):** `app/r/[id]/page.tsx`, `app/api/r/[id]/route.ts`, `app/api/r/[id]/comments/route.ts`, `components/review-public/media-review.tsx` (+ player, timecode chip, composers, region-mark overlay, comment list, version switcher). Region marks: pause the video, drag on an overlay, store `{x,y,w,h}` fractions relative to the media box, render saved marks as outlines when the playhead is within 0.5 s of the comment's timecode or when the comment is tapped. Route tests: 404 on bad/revoked/mismatched `k`, comment creation attributes the link's name and ignores any name in the body, cap and rate limit enforced, versions list scoped to the group.
- [ ] **Authoring routes and panels (C-4).** Tests for each route's auth (covered by the middleware) and behavior.
- [ ] **Media digest (C-5):** `lib/media-digest.ts` + snapshot tests (general note, timecoded note, region note, resolved filtering, ordering); export route; SPEC.md §9.4; `SPEC_VERSION` and the CLI's expected version to 1.2.0; a digest fixture under `packages/spec` golden fixtures is not needed (the media digest lives in `apps/web`), but `packages/spec` tests must stay untouched and green.
- [ ] **CLI (C-6):** `pull` fallback to publications, `links`, `resolve`, `status --publications`, `client.ts` wrappers. Tests for each command's output and error paths.
- [ ] **Ops doc (C-7)** and **skill update (C-8).**
- [ ] **README:** `WAYPOINT_REVIEW_PUBLIC_URL` in the env table; a "Public review links" paragraph noting the tunnel restricts the public surface to `/r/*` and `/api/r/*`.

### Exit criteria

- Standing gates green; `packages/spec` byte-fidelity tests untouched and green.
- Middleware tests prove the open surface is exactly `/r/*` and `/api/r/*`.
- With the dev server (no R2), a media publication row inserted directly for the test can be reviewed: `/r/<id>?k=<token>` renders the page (the `<video>` will not load without a real file, which is acceptable in dev), a note posts and shows the bound reviewer name, a region mark round-trips, resolve works from the authoring page, and `GET /api/publications/<id>/export?format=digest` returns the SPEC §9.4 shape.
- `waypoint links`, `waypoint resolve`, `waypoint pull <publication-id> --digest`, and `waypoint status --publications` work against the dev server.
- `docs/ops/review-tunnel.md` is complete enough to execute without further research.

### Verification notes (reviewer)

- Attack the public surface: unknown id, revoked token, token from another group, oversized body, 31st comment in a minute, HTML in a body (must render escaped), a `name` field in the POST body (must be ignored).
- Phone check on the tailnet dev server: one-handed note at a timecode, tap-to-seek, region mark on a paused frame, version switch keeps the same `k`.
- Read the digest against SPEC §9.4 line by line; confirm `**By:**` and `**Region:**` are documented as new labels and that existing document digests are byte-identical to before (run the existing digest snapshot tests).
- Confirm nothing in the diff touches `applyReview` or `parseDocument`.

---

## After both phases (reviewer, not the executor)

1. Review the diff on `feat/media-review`, run the gates in the worktree, exercise the real-R2 checks.
2. Merge to `main`, `corepack pnpm build` in `~/prj/waypoint`, `launchctl kickstart -k gui/$(id -u)/com.tyler.waypoint`, confirm `/api/health` and that migrations 0003 and 0004 applied to the production database (back it up first: `~/.waypoint/data`).
3. Apply `docs/ops/review-tunnel.md`; confirm `https://review.tylersavery.com/api/health` is 404 at the edge and `https://review.tylersavery.com/r/<id>?k=…` renders from a phone off the tailnet.
4. In the video studio: `scripts/publish.mjs` wraps `waypoint publish --json` and writes the share URL into the render manifest.
