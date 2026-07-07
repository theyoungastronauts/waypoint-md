---
waypoint: 1
title: "Choice labels that start with inline formatting"
---

Option labels here begin with inline code, bold, a link, and strikethrough.
The checkbox marker must be located from the list item's own source, so
flipping a box never splices over the bullet (§11 byte-fidelity).

<!-- wp:question id="pkg" type="choice" select="single" -->
**Which package name do we ship under?**
- [x] `waypoint-md`
- [ ] **@usepolaris/waypoint**
- [ ] [see the naming issue](https://example.com/issue)
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="envs" type="choice" select="multi" -->
**Which environments get the change first?**
- [ ] ~~legacy~~
- [x] `staging`
- [ ] **production**
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
