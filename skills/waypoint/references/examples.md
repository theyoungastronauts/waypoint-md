# Worked example: a full Waypoint review loop

This shows one document through the whole loop — the doc you author, the annotated
file you get back, and the compact digest you act on.

## 1. The doc you author and push

`docs/rds-migration.md`:

```markdown
---
waypoint: 1
title: "RDS Migration Plan"
project: acme-api
---

# RDS migration

We upgraded the instance class during the incident. Two decisions before we
finalize the plan.

<!-- wp:question id="q1" type="text" -->
**Q1 — Sizing:** Do we stay on the upgraded instance class, or right-size down
once the incident settles? What's the decision window?
<!-- wp:answer -->
Recommend staying on the upgraded class through end of quarter, then re-evaluating.
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — Auth model for v1:**
- [ ] Single shared token
- [ ] Per-device tokens
- [x] Tailscale-only, no app auth
<!-- wp:rationale -->
Tailscale gives us device identity for free and there's no second system to run.
<!-- /wp:rationale -->
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
```

`wp:rationale` is the author's "why this pick" for the pre-checked option — it
renders read-only and leaves the reviewer's `wp:answer` box empty.

Push it:

```
waypoint push docs/rds-migration.md --project acme-api
```

This prints a review URL and writes `.waypoint/pending.json`.

## 2. The annotated file you pull back

After the human reviews, `waypoint pull` writes `docs/rds-migration.review.md`.
It is the source, spliced — a clean diff, byte-identical everywhere untouched:

```markdown
---
waypoint: 1
title: "RDS Migration Plan"
project: acme-api
waypoint_status: completed
reviewed_at: 2026-07-08T16:20:00.000Z
---

# RDS migration

We upgraded the instance class during the incident. Two decisions before we
finalize the plan.

<!-- wp:question id="q1" type="text" -->
**Q1 — Sizing:** Do we stay on the upgraded instance class, or right-size down
once the incident settles? What's the decision window?
<!-- wp:answer status="answered" -->
Stay on the upgraded class through end of quarter, then re-evaluate at the Q4 review.
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — Auth model for v1:**
- [x] Single shared token
- [ ] Per-device tokens
- [ ] Tailscale-only, no app auth
<!-- wp:rationale -->
Tailscale gives us device identity for free and there's no second system to run.
<!-- /wp:rationale -->
<!-- wp:answer status="answered" -->
Shared token is fine for now; Tailscale stays as the network boundary.
<!-- /wp:answer -->
<!-- /wp:question -->

<!-- wp:comment id="c1" exact="right-size down" prefix="class, or " suffix=" once the" -->
Only after we confirm the read replica lag is back to baseline.
<!-- /wp:comment -->
```

What changed, and how to read it:
- **q1**: reviewer edited the draft; `status="answered"`.
- **q2**: reviewer switched the selection from "Tailscale-only" to "Single shared
  token" (`[x]` moved) and added elaboration. The `wp:rationale` block is
  **untouched** — it's the author's input, preserved byte-for-byte even when the
  reviewer overrides the pick.
- **c1**: a selection comment anchored to the quoted text "right-size down".
  A `wp:suggestion` block, if present, carries verbatim replacement text to apply.

Act on it: apply q1/q2 as the settled decisions, and address the comment's
condition before proceeding.

## 3. The digest — the cheapest thing to act on

`waypoint pull --digest` also writes `docs/rds-migration.digest.md`. It is a
compact, deterministic projection you can act on **without re-reading the source**.
Its grammar is the parsing contract in `docs/SPEC.md` §9:

```markdown
---
waypoint_digest: 1
title: "RDS Migration Plan"
project: "acme-api"
source: "docs/rds-migration.md"
status: "completed"
reviewed_at: "2026-07-08T16:20:00.000Z"
answered: 2
flagged: 0
skipped: 0
untouched: 0
total: 2
comments: 1
synthetic: 0
---

# Digest — RDS Migration Plan

## Questions

### q1 · text · answered
**Q:** **Q1 — Sizing:** Do we stay on the upgraded instance class, or right-size down once the incident settles?
**A:** Stay on the upgraded class through end of quarter, then re-evaluate at the Q4 review.

### q2 · choice (single) · answered
**Q:** **Q2 — Auth model for v1:**
**Selected:** Single shared token
**Why:** Tailscale gives us device identity for free and there's no second system to run.
**Note:** Shared token is fine for now; Tailscale stays as the network boundary.

## Comments

### c1
**Anchor:** "right-size down"
**Comment:** Only after we confirm the read replica lag is back to baseline.
```

How to read the digest:
- Frontmatter counts tell you at a glance how much was answered vs. `flagged`
  (needs discussion) vs. `skipped` (deferred).
- Each `### <id> · <type> · <status>` entry is one question. `**A:**` for text;
  `**Selected:**` for choice, with an optional author `**Why:**` (the
  `wp:rationale`) and reviewer `**Note:**` (the elaboration) as distinct fields.
- `## Comments` lists reviewer comments with their quoted `**Anchor:**`; a
  `**Suggestion:**` line, when present, is replacement text to apply verbatim.
- `## Structured responses` (not shown here) appears for adoptive-import answers on
  docs that had no `wp:` questions — same answer lines, each with a source anchor.

## 4. A media digest — the same loop, for a render

A published render takes review notes instead of answers, and `waypoint pull
<publication-id> --digest` writes them as a **media digest**. Its grammar is
`docs/SPEC.md` §9.4 — the same field-label contract as §9, with `kind: media` in
the frontmatter and two labels the document digest does not use.

```markdown
---
waypoint_digest: 1
kind: media
title: "vBTC Unwrapped"
group: "vbtc-unwrapped"
label: "v2"
source: "https://dropzone.example.com/smitty/shares/8f3c…/vbtc-unwrapped-v2.mp4"
status: "published"
reviewed_at: "2026-09-15T12:00:00.000Z"
comments: 3
unresolved: 3
---

# Digest — vBTC Unwrapped

## Comments

### c1
**Anchor:** "general"
**By:** Jay
**Comment:** overall pace is right, it's the last third that drags

### c2
**Anchor:** "00:12.4"
**By:** Jay
**Comment:** the wordmark lands too late here — bring it in on the beat

### c3
**Anchor:** "00:31.0"
**Region:** 0.120,0.340,0.250,0.180
**By:** Aaron
**Comment:** this corner is muddy at 1080p
```

How to read it:
- `kind: media` is the field to branch on. There are no question counters,
  because a render has no questions — only `comments` (entries rendered) and
  `unresolved` (notes still open on the publication).
- `**Anchor:**` is `"mm:ss.d"` into the cut, or the literal `"general"` for a
  note about the whole thing. Minutes are not wrapped into hours: 70 minutes in
  reads `"70:04.2"`.
- `**Region:**` appears only when the note marks a box on the frame: `x,y,w,h` as
  fractions of the media box from its top-left, to three decimals. `c3` above
  marks the left-of-centre area, a quarter of the width and under a fifth of the
  height.
- `**By:**` is the reviewer, taken from the link the note arrived on.
- Resolved notes are omitted, so a digest of open notes can skip numbers
  (`c2` with no `c1`). Numbers are positional, not identifiers.

Act on it: make each change, then `waypoint resolve <publication-id> c2` for the
notes you actually addressed. Leave open anything you did not do, and say why.
