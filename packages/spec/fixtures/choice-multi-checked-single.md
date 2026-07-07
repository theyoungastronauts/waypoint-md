---
waypoint: 1
title: "Multi-checked single-select"
---

This document deliberately checks two boxes in a `select="single"` question.
The parser must warn and keep the first checked option (ratified).

<!-- wp:question id="q1" type="choice" select="single" -->
**Pick exactly one (but two are checked in the source):**
- [x] First option
- [ ] Second option
- [x] Third option
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
