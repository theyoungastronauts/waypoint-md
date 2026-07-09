# Authoring Waypoint review docs (SPEC v1)

The full contract is `docs/SPEC.md` in the Waypoint repo. This is the working
subset you need to author good review docs. All machinery lives in
`<!-- wp:… -->` HTML comments, which are invisible in any markdown renderer — the
visible content is ordinary markdown, and a human with only a text editor can
answer it by hand.

## Opt in with frontmatter

```markdown
---
waypoint: 1
title: "RDS Migration Plan"
project: acme-api
---
```

`waypoint: 1` is required to opt a document into the convention (it is the major
version of the SPEC). `title` and `project` are optional; the CLI fills `project`
and a `source` path on push.

## Text question — open-ended input

```markdown
<!-- wp:question id="q1" type="text" -->
**Q1 — Sizing:** Do we stay on the upgraded instance class, or right-size down
once the incident settles? What's the decision window?
<!-- wp:answer -->
Recommend staying on the upgraded class through end of quarter, then re-evaluating.
<!-- /wp:answer -->
<!-- /wp:question -->
```

- The visible prompt is normal markdown (bold lead-in, then the question).
- Text you put inside `wp:answer` is a **pre-filled draft** — the app shows it as
  a starting answer the reviewer edits. Pre-fill when you have a real
  recommendation; leave it empty (`<!-- wp:answer --><!-- /wp:answer -->`) when
  you genuinely need their input.

## Choice question — a decision with known options

```markdown
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

- `select="single"` renders as a radio group (pick one); `select="multi"` renders
  as checkboxes (pick several).
- The task-list boxes are the options. Pre-check (`- [x]`) the option you
  recommend; leave all unchecked when you have no lean.
- **Put your "why this pick" reasoning in `wp:rationale`, not `wp:answer`**
  (SPEC 1.1.0). It sits after the options and before `wp:answer`, renders
  read-only as "Why I suggested this" under the pre-checked option, and is kept
  out of the reviewer's answer slot. When you pre-check an option, explain it
  here and leave `wp:answer` **empty** — that box is the reviewer's, and it now
  defaults empty on a choice.
- The `wp:answer` block is the reviewer's always-available elaboration field. **A
  text-only response with no box checked is valid** — always leave room for "none
  of these, here's what I'd do instead."
- `wp:rationale` is optional and choice-only. Omit it when you have no lean; a doc
  without it parses exactly as before (the block is additive in 1.1.0).

## ID discipline

- Every `wp:question` needs an `id`, unique within the document (`q1`, `q2`, …).
- IDs are how answers map back on export and round-trip. Keep them stable: if you
  revise and re-push a doc, reuse the same id for the same question so the mapping
  survives.
- Duplicate or missing ids don't crash the parser (they become warnings), but
  they make the review lossy — don't rely on that.

## Write self-contained prompts

The reviewer navigates card by card, often on a phone, and may act on the digest
without the surrounding prose. So:

- Put everything needed to answer *inside the prompt*. Don't write "given the
  above" — restate the relevant constraint.
- Lead with a short bold label (`**Q3 — Rollback window:**`) so the item is
  scannable in the nav list and the digest heading.
- One decision per question. Split "which DB and which region?" into two.
- Prefer choice questions when the options are known and finite; they are faster
  to answer and produce cleaner digests.

## Pre-filling drafts — when and how

- Pre-fill a `wp:answer` (text) or check a box (choice) whenever you have a
  defensible recommendation. It turns review into "confirm or correct," which is
  far faster than "author from scratch." For a choice, the reasoning for a
  pre-check goes in `wp:rationale` (see above), leaving `wp:answer` empty.
- Make the draft your *actual* recommendation, not a placeholder. If you're
  genuinely unsure, leave it blank and say why in the prompt.
- Never fabricate consensus: if two options are close, present both as a choice
  rather than silently pre-checking one.

## What you get back

On review the source is spliced (answers into `wp:answer` interiors, `[x]` states
onto boxes, a `waypoint_status`/`reviewed_at` frontmatter stamp) — a clean diff,
byte-identical everywhere the reviewer didn't touch. Reviewers can also attach
`wp:comment` blocks (with optional `wp:suggestion` replacement text) anchored to
quoted spans. See [examples.md](examples.md) for the annotated output and the
digest you act on.
