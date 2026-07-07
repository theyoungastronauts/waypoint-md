---
waypoint: 1
title: "RDS Migration Plan"
project: acme-api
source: docs/plan.md
---

# RDS Migration Plan

Some intro prose describing the migration, with **bold** and a [link](https://example.com).

<!-- wp:question id="q1" type="text" -->
**Q1 — Sizing:** Do we stay on the upgraded instance class, or right-size down once the incident settles?
<!-- wp:answer status="answered" -->
Stay on the upgraded class through end of quarter, then re-evaluate.
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — Auth model for v1:**
- [ ] Single shared token
- [ ] Per-device tokens
- [x] Tailscale-only, no app auth
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q3" type="choice" select="multi" -->
**Q3 — Which environments get the change first?**
- [x] staging
- [ ] production
- [x] dev
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

Closing prose that should never be touched by the writer.
