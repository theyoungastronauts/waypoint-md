---
waypoint: 1
title: "Choice with an author rationale (SPEC 1.1.0)"
---

The doc producer pre-checked an option and explained *why* in a `wp:rationale`
block. That reasoning is author input — the reviewer's `wp:answer` starts empty,
and `applyReview` must never rewrite the rationale bytes.

<!-- wp:question id="db" type="choice" select="single" -->
**Which database do we standardize on for v1?**
- [ ] Postgres
- [x] SQLite
- [ ] DynamoDB
<!-- wp:rationale -->
SQLite keeps the single-binary deploy story intact, and the dataset is small
enough that we won't need a networked database before the next planning round.
<!-- /wp:rationale -->
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
