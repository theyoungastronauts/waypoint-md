---
waypoint: 1
title: "Waypoint media publish + video review — Phase B/C spec"
project: waypoint
---

# Waypoint media publish + video review — Phase B/C spec

Waypoint's `publish` verb learns media, and Waypoint grows a public review surface for it. The driver is the VFX video studio (`VerifiedX-BrandToolkit/video`): every render carries a `<file>.manifest.json`, renders leave the machine only through publish, and Jay needs to leave timecoded comments from his phone without being on the tailnet. Ruled 2026-09-14 (vfx-platform-context review, Q4 and Q6): renders go to R2 through an extended `waypoint publish`, and the video review ships before the first spot does.

Two phases. **B** is the storage and registry half, entirely behind the existing token gate. **C** is the public review page and the comment loop, which is the first time anything in Waypoint is reachable off the tailnet.

## Facts the design rests on

- `waypoint.home.tylersavery.com` resolves to the Mac mini's Tailscale address; nothing in Waypoint is public today. The R2 public domain `dropzone.tylersavery.com` is Cloudflare-fronted, `cloudflared` 2026.7.1 is installed, and a tunnel credential from July sits in `~/.cloudflared` (not running).
- Publications today: markdown only, rendered server-side, three objects at `smitty/shares/<uuid>/<name>.{md,html,pdf}`, one SQLite row with FTS, list/detail/revoke/backfill. The CLI is a thin client that POSTs JSON.
- Cloudflare's proxy caps request bodies at 100 MB on the plans in use; a 60 s ProRes overlay is ~250 MB. Bytes must not travel through a Cloudflare-proxied hostname to reach the server.
- The middleware gates every route by default; `OPEN_PATHS` is an explicit allowlist (`/api/health`, `/api/auth/login`, `/login`).
- The digest (SPEC §9) is the parsing contract agents act on. Comments carry a quoted text anchor; media comments need a timecode instead.

## Phase B — media publications (behind the token gate)

**Schema (migration 0003).** `publications` gains `kind` (`markdown` | `media`, default `markdown`), `content_type`, `bytes`, `group` (a material slug, e.g. `vbtc-unwrapped`), `label` (`v1`, `draft`, …), `manifest_json` (the render manifest, verbatim), `review_token` (Phase C). `source_md` becomes nullable; the FTS index for media rows indexes `title + group + label + manifest summary` (composition, profile, format) so `waypoint status -q vbtc` finds renders.

**Upload path.** The server never buffers media. `POST /api/publications/media` `{filename, contentType, bytes, title?, group?, label?, manifest?}` creates the row and returns `{id, key, uploadUrl}` where `uploadUrl` is a presigned R2 PUT (15 min). The CLI PUTs the file straight to R2, then `POST /api/publications/:id/finalize` HEADs the object, records size and etag, and returns `{id, urls: {file, review}}`. An unfinalized row older than an hour is garbage-collected. Revoke deletes the object and stamps the row, as today.

**Object layout.** `smitty/shares/<uuid>/<sanitized-name>.<ext>` beside the markdown publications; the manifest is also uploaded as `<sanitized-name>.manifest.json` so the share folder is self-describing.

**CLI.** `waypoint publish <file>` dispatches on extension: `.md` keeps the current flow; `.mp4 .mov .webm .png .jpg .pdf` take the media flow. New flags: `--group`, `--label`, `--manifest <path>` (auto-detected as `<file>.manifest.json` when present, which is what the video studio produces), `--json` (machine output so the studio can write the share URL back into the manifest). `waypoint status` lists media publications with their group, label, and (Phase C) unresolved comment count.

**UI.** The publications list shows a kind badge and group/label; the detail page plays video, shows images, embeds PDFs, and links the manifest.

**Video studio side** (in the toolkit, not here): `scripts/publish.mjs <render>` calls `waypoint publish --json` and fills the manifest's `share` slot.

## Phase C — public video review

**Exposure.** A Cloudflare Tunnel on the Mac mini forwards one public hostname to `localhost:3000`, with ingress rules that forward only `/r/*` and `/api/r/*`; every other path returns 404 at the edge, so the login page, the API, and the authoring UI never become public. The middleware adds `/r/:id` and `/api/r/:id/*` to the open paths. Authoring stays on the tailnet hostname.

**Capability.** A review link is `https://<host>/r/<uuid>?k=<review_token>`. The uuid is unguessable and the token makes the link revocable without deleting the publication (rotate the token, old links die). Comments require both.

**Review page `/r/:id`.** Mobile-first. Player (HTML5 video; image and PDF viewers for those kinds), a live timecode chip, "Comment at 00:12.4" composer, comment list sorted by timecode, tap-to-seek, resolve state, download link, and a version switcher when the publication belongs to a group (v1 → v2 stack, comments per version). Reviewer name asked once and remembered in the browser; `?as=Jay` prefills it. Region marks (draw on the frame), threaded replies, and mentions are explicitly later.

**Data.** New table `media_comments`: `id, publication_id, timecode_ms (nullable for general notes), author_name, body_md, created_at, resolved_at`. Separate from `comments`, whose anchor is a text quote. Public `POST /api/r/:id/comments` is rate-limited per IP, body-capped, and refuses without a valid `k`.

**Agent loop.** `waypoint pull <id> --digest` works for media publications. The digest gains `kind: media` in frontmatter and comment entries of the form:

```
### c1
**Anchor:** "00:12.4"
**By:** Jay
**Comment:** the wordmark lands too late here
```

`**By:**` is a new label (SPEC 1.2.0, additive: unknown labels were already field boundaries). Timecodes render as `mm:ss.d`; general notes use `**Anchor:** "general"`. Resolving happens in the authoring UI or with `waypoint resolve <id> c1`, which the agent runs after acting on a note.

**Notifications.** v1 polls: `waypoint status` shows unresolved counts, and the session start pull loop picks them up. A push channel is a follow-up (Q7).

## Sequencing

B first (two to three days: migration, presigned upload, CLI dispatch, UI kind badge, studio publish script, tests). C second (three to five days: tunnel + ingress, open-path class, review page, comments API with rate limiting, digest extension, SPEC bump, e2e from a phone). Both before the first VFX spot, per the ruling.

## Decisions to ratify

<!-- wp:question id="q1" type="choice" select="single" -->
**Q1 — How the review page becomes public.** Jay is not on the tailnet, so the review page and its comment endpoint need a public path. Options: a Cloudflare Tunnel on the Mac mini that forwards only `/r/*` and `/api/r/*` to Waypoint (one codebase, SQLite stays the source of truth, everything else stays private at the edge); a static review page on R2 with a Cloudflare Worker + D1 for comments that Waypoint pulls from (Waypoint stays fully private, two deployables, comments live outside until pulled); or exposing all of Waypoint publicly behind Cloudflare Access (reviewers need an Access login).
- [x] Cloudflare Tunnel, path-restricted ingress to `/r/*` and `/api/r/*` (recommended)
- [ ] Static page on R2 + Worker/D1 comments, pulled into Waypoint
- [ ] Whole app public behind Cloudflare Access
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q2" type="text" -->
**Q2 — Public hostname for review links.** Waypoint serves several projects (ATNY, VFX, Event Campus), so the hostname should be Tyler's, not a client's. It needs a DNS record in the tylersavery.com zone pointed at the tunnel.
<!-- wp:answer -->
review.tylersavery.com
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q3" type="choice" select="single" -->
**Q3 — Upload path for media.** Renders run 50–500 MB. A presigned R2 PUT sends bytes from the CLI straight to the bucket (server never buffers, works from the Windows box over Tailscale, immune to Cloudflare's 100 MB proxy cap). Streaming through the Waypoint server keeps the CLI dumber but puts every byte through the Mac mini and breaks the moment the CLI targets a proxied hostname.
- [x] Presigned PUT direct to R2, then a finalize call (recommended)
- [ ] Stream through the Waypoint server
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q4" type="choice" select="single" -->
**Q4 — Reviewer identity on the public page.** No accounts. Options: ask for a display name once, remember it in the browser, prefill with `?as=Jay` in the link (lightest); mint one link per reviewer with the name bound to the token (names cannot be spoofed, more links to manage); fully anonymous (comments arrive unattributed).
- [x] Display name, remembered in the browser, `?as=` prefill (recommended)
- [ ] Per-reviewer links with bound names
- [ ] Anonymous
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q5" type="choice" select="single" -->
**Q5 — Link revocation.** A publication uuid alone is unguessable but permanent. A per-publication `review_token` in the link (`?k=…`) lets a leaked link be killed by rotating the token while the render stays published and its comments stay.
- [x] uuid + rotatable review token (recommended)
- [ ] uuid only; revoke means deleting the publication
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q6" type="choice" select="single" -->
**Q6 — Digest grammar for media comments.** The digest (SPEC §9) is the contract agents parse. Media comments need a timecode anchor and an author. Options: keep `**Anchor:** "00:12.4"` and add a `**By:**` label (SPEC 1.2.0, additive, cleanest to parse); put the author in the entry heading (`### c1 · Jay`) and leave labels untouched; fold the author into the comment body text.
- [x] `**Anchor:** "00:12.4"` + new `**By:**` label, SPEC 1.2.0 (recommended)
- [ ] Author in the `###` heading, no new label
- [ ] Author inside the comment body
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q7" type="choice" select="single" -->
**Q7 — Knowing when Jay has commented.** v1 can rely on `waypoint status` unresolved counts and the session-start pull loop. A push (ntfy/Pushover to the phone, or email) is extra plumbing.
- [x] Poll only for v1; push as a follow-up (recommended)
- [ ] Push notification in v1 (say which channel in the note)
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q8" type="choice" select="multi" -->
**Q8 — Review page features required in v1.** Everything unchecked is deferred, not dropped.
- [x] Timecoded comments with tap-to-seek
- [x] General (untimed) notes
- [x] Resolve state (Tyler/agent side)
- [x] Version switcher for a group (v1 → v2), comments per version
- [ ] Region marks (draw a box on the frame)
- [ ] Threaded replies
- [ ] Download link on the public page
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q9" type="choice" select="single" -->
**Q9 — Order.** Phase B (media publish, private) then Phase C (public review). B alone already gives share links for stills and renders; C is what Jay uses.
- [x] B then C, both before the first VFX spot (recommended)
- [ ] C first, publish videos by hand until B lands
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
