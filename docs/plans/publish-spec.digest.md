---
waypoint_digest: 1
title: "Waypoint publish — Phase A spec"
project: "waypoint"
source: "docs/plans/publish-spec.md"
status: "completed"
reviewed_at: "2026-07-09T14:17:59.061Z"
answered: 5
flagged: 0
skipped: 0
untouched: 0
total: 5
comments: 0
synthetic: 0
---

# Digest — Waypoint publish — Phase A spec

## Questions

### q1 · choice (single) · answered
**Q:** **Q1 — R2 key prefix for new publishes.** Old objects never move either way; this only affects where new publishes land and how many prefixes backfill/list must scan forever.
**Selected:** Keep `smitty/shares/` — one namespace, one prefix to list, zero migration surface
**Note:** Keep the prefix. The name is cosmetic; a second namespace is a real cost.

### q2 · choice (single) · answered
**Q:** **Q2 — Where rendering happens.** Server-side keeps puppeteer/Chrome in exactly one place and lets any HTTP caller publish (Smitty in a container later needs only a POST).
**Selected:** Server-side only; the CLI verb is a thin client
**Note:** One path. The server is on the same machine; if it's down, `share` today would
be broken too. A fallback doubles the surface for a failure mode that hasn't
happened.

### q3 · choice (single) · answered
**Q:** **Q3 — Registry placement in the UI.**
**Selected:** Separate "Publications" section (own nav link, list + search + detail)
**Note:** Different lifecycle (permanent vs pending→pulled), different mental model —
merging would make the queue lie about what it is.

### q4 · choice (single) · answered
**Q:** **Q4 — Revocation in v1.** The brief names deleting the R2 objects as the revocation story. Building it now is one endpoint + three DeleteObject calls + a button; the registry row survives either way with `revoked_at` stamped.
**Selected:** Include revoke in v1

### q5 · text · answered
**Q:** **Q5 — Scope check.** Anything to add or cut before B1 starts? (Schema columns, API shape, the `--backfill` CLI placement, the marked-vs-unified renderer call, anything the brief missed.)
**A:** Ship it as specced.
