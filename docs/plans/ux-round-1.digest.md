---
waypoint_digest: 1
title: "Waypoint UX round 1 — six review-view improvements"
project: "waypoint"
source: "docs/plans/ux-round-1.md"
status: "completed"
reviewed_at: "2026-07-09T14:38:48.865Z"
answered: 6
flagged: 0
skipped: 0
untouched: 0
total: 6
comments: 0
synthetic: 0
---

# Digest — Waypoint UX round 1 — six review-view improvements

## Questions

### q1 · choice (single) · answered
**Q:** **Q1 — What should the one-click action do, and what does it grab?**
**Selected:** Agent wraps its proposed answer in a fenced block; a **"Use this answer"** button on that block replaces the focused answer with just those contents (not the whole chat message)
**Note:** Leaning to the first: the value is getting the suggestion into the answer with
one click, and a fence lets the agent mark exactly which span is "the answer"
vs. its surrounding explanation. Requires a light convention in the agent's
system prompt ("put the suggested answer in a ```suggestion fence"). If you just
want clipboard, that's simpler but you still hand-paste.

### q2 · choice (single) · answered
**Q:** **Q2 — How should "none of these" work for single-select?**
**Selected:** Add an explicit **"Clear selection"** link under the group when something is picked
**Note:** Click-to-deselect is the least intrusive and matches the muscle memory you
already reached for. The always-visible elaboration field is where the "here's
what I'd do instead" text goes, so no options need to change. (One caveat:
click-to-deselect on radios is slightly non-standard, so I'd add a tiny hint.)

### q3 · choice (single) · answered
**Q:** **Q3 — How does a path get inserted?**
**Selected:** A small **"Attach path"** affordance on each answer box opens a native file picker; the chosen path is inserted at the cursor, normalized to `~/…`
**Note:** yeah but we can still call this "attach file"

### q4 · choice (single) · answered
**Q:** **Q4 — Where should an agent's rationale for a choice live, and what's the box's default?**
**Selected:** Split them: agent rationale renders as a read-only **"Why I suggested this"** note under the pre-checked option; the elaboration box defaults **empty**. Needs a small SPEC addition (a rationale block distinct from `wp:answer`).
**Note:** I recommend the split. It fixes the category error at the convention level: an
agent's "why this pick" is prompt-side context, not the reviewer's answer, and
keeping them separate means the digest/export stops conflating them (your q1/q2/q3
"Note:" fields in the publish spec were really *my rationale*, not your
elaboration). The clickable-suggestion option is a fine lighter-weight middle
ground if you'd rather not touch the SPEC yet. This one's your call — it's the
only item here that changes the convention.

### q5 · choice (single) · answered
**Q:** **Q5 — Scope image paste for this round?**
**Selected:** Include a minimal version now (paste → send as context on the *next* chat message only, no persistence, current model must be vision-capable)
**Note:** To be clear: this isn't meant for chat with agent; this would be in my elaboration response. basically if that field is focused, it detects an image paste and then it can show up as link a thumbnail or something under the text box as like an attachment. we don't need to include it inline in the text input and it should be removable.

### q6 · text · answered
**Q:** **Q7 — Any resequencing or anything I missed?** My default order: ship 1 (scroll) + 3 (deselect) first as quick wins, then 2 (suggestion), then 4 (path attach), then 5 (elaboration) as it may touch the SPEC, with 6 (images) as its own round.
**A:** well i want to ultimately create a plan we can autonmously execute with all decisions baked in.
