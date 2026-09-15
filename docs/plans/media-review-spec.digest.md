---
waypoint_digest: 1
title: "Waypoint media publish + video review — Phase B/C spec"
project: "waypoint"
source: "docs/plans/media-review-spec.md"
status: "completed"
reviewed_at: "2026-09-15T03:20:18.189Z"
answered: 9
flagged: 0
skipped: 0
untouched: 0
total: 9
comments: 0
synthetic: 0
---

# Digest — Waypoint media publish + video review — Phase B/C spec

## Questions

### q1 · choice (single) · answered
**Q:** **Q1 — How the review page becomes public.** Jay is not on the tailnet, so the review page and its comment endpoint need a public path. Options: a Cloudflare Tunnel on the Mac mini that forwards only `/r/*` and `/api/r/*` to Waypoint (one codebase, SQLite stays the source of truth, everything else stays private at the edge); a static review page on R2 with a Cloudflare Worker + D1 for comments that Waypoint pulls from (Waypoint stays fully private, two deployables, comments live outside until pulled); or exposing all of Waypoint publicly behind Cloudflare Access (reviewers need an Access login).
**Selected:** Cloudflare Tunnel, path-restricted ingress to `/r/*` and `/api/r/*` (recommended)

### q2 · text · answered
**Q:** **Q2 — Public hostname for review links.** Waypoint serves several projects (ATNY, VFX, Event Campus), so the hostname should be Tyler's, not a client's. It needs a DNS record in the tylersavery.com zone pointed at the tunnel.
**A:** review.tylersavery.com

### q3 · choice (single) · answered
**Q:** **Q3 — Upload path for media.** Renders run 50–500 MB. A presigned R2 PUT sends bytes from the CLI straight to the bucket (server never buffers, works from the Windows box over Tailscale, immune to Cloudflare's 100 MB proxy cap). Streaming through the Waypoint server keeps the CLI dumber but puts every byte through the Mac mini and breaks the moment the CLI targets a proxied hostname.
**Selected:** Presigned PUT direct to R2, then a finalize call (recommended)

### q4 · choice (single) · answered
**Q:** **Q4 — Reviewer identity on the public page.** No accounts. Options: ask for a display name once, remember it in the browser, prefill with `?as=Jay` in the link (lightest); mint one link per reviewer with the name bound to the token (names cannot be spoofed, more links to manage); fully anonymous (comments arrive unattributed).
**Selected:** Per-reviewer links with bound names

### q5 · choice (single) · answered
**Q:** **Q5 — Link revocation.** A publication uuid alone is unguessable but permanent. A per-publication `review_token` in the link (`?k=…`) lets a leaked link be killed by rotating the token while the render stays published and its comments stay.
**Selected:** uuid + rotatable review token (recommended)

### q6 · choice (single) · answered
**Q:** **Q6 — Digest grammar for media comments.** The digest (SPEC §9) is the contract agents parse. Media comments need a timecode anchor and an author. Options: keep `**Anchor:** "00:12.4"` and add a `**By:**` label (SPEC 1.2.0, additive, cleanest to parse); put the author in the entry heading (`### c1 · Jay`) and leave labels untouched; fold the author into the comment body text.
**Selected:** `**Anchor:** "00:12.4"` + new `**By:**` label, SPEC 1.2.0 (recommended)

### q7 · choice (single) · answered
**Q:** **Q7 — Knowing when Jay has commented.** v1 can rely on `waypoint status` unresolved counts and the session-start pull loop. A push (ntfy/Pushover to the phone, or email) is extra plumbing.
**Selected:** Poll only for v1; push as a follow-up (recommended)

### q8 · choice (multi) · answered
**Q:** **Q8 — Review page features required in v1.** Everything unchecked is deferred, not dropped.
**Selected:** Timecoded comments with tap-to-seek, General (untimed) notes, Resolve state (Tyler/agent side), Version switcher for a group (v1 → v2), comments per version, Region marks (draw a box on the frame)

### q9 · choice (single) · answered
**Q:** **Q9 — Order.** Phase B (media publish, private) then Phase C (public review). B alone already gives share links for stills and renders; C is what Jay uses.
**Selected:** B then C, both before the first VFX spot (recommended)
