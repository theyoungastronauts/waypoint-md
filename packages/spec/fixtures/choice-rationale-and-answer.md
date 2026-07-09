---
waypoint: 1
title: "Rationale plus a reviewer answer (SPEC 1.1.0)"
---

The doc producer pre-checked an option with a `wp:rationale`, and the reviewer
also wrote an elaboration in `wp:answer`. The two are distinct slots and must
round-trip independently — the author's "why" is never folded into the answer.

<!-- wp:question id="deploy" type="choice" select="single" -->
**Where do we deploy the review server?**
- [x] Fly.io
- [ ] Render
- [ ] A self-hosted box
<!-- wp:rationale -->
Fly's per-region volumes match the WAL-mode SQLite file we already ship, so
there's no storage rework to standing this up.
<!-- /wp:rationale -->
<!-- wp:answer -->
Going with Fly, but pin a specific region so the volume never migrates.
<!-- /wp:answer -->
<!-- /wp:question -->
