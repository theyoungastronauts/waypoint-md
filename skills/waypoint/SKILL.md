---
name: waypoint
description: Author markdown for human review in Waypoint and run its push/pull review loop. Use when you produce a plan, summary, design, or set of decisions/questions that a human should review before you act — write it in the Waypoint SPEC (text + choice questions), push it with `waypoint push`, and at the start of a session pull any completed reviews and act on the annotations. Also use when the user mentions Waypoint, a review doc, `waypoint push`/`pull`, or a `.waypoint/pending.json` pointer.
allowed-tools: Bash(waypoint *), Bash(npx waypoint *)
---

# Waypoint review loop

Waypoint turns a markdown document into an interactive review surface: the human
answers questions, checks options, comments on prose, and you get back an
annotated file (or a compact digest) to act on. Your job is to (1) author review
docs in the SPEC, and (2) run the push/pull loop so a human stays in the loop
without blocking you.

## Pending reviews in this repo

!`if [ -f .waypoint/pending.json ]; then echo "A pending pointer exists — a doc is awaiting or has finished review:"; cat .waypoint/pending.json; else echo "No .waypoint/pending.json in this directory."; fi`

## At the start of a session (pull loop)

If a `.waypoint/pending.json` pointer exists (see above), a document you pushed
earlier may now be reviewed:

1. Run `waypoint status` to see whether the doc is `completed` (reviewer
   finished) or still `pending`/`in_review`.
2. If it is `completed`, run `waypoint pull` (add `--digest` for the compact
   agent-friendly form). This writes `<name>.review.md` beside the source (and
   `<name>.digest.md` with `--digest`), clears the pointer, and marks the doc
   `pulled`.
3. Read the pulled file and **act on it**: apply the reviewer's answers, checked
   options, and any `wp:suggestion` edits; address comments; treat `flagged`
   items as "needs discussion", `skipped` as "deliberately deferred".
4. If it is not yet completed, tell the user it's still under review and move on —
   never block waiting.

The digest is the cheapest thing to act on: it is `Q → A` pairs plus comments and
their quoted anchors, so you can apply a review without re-reading the whole doc.
Its exact grammar is the parsing contract in the Waypoint SPEC, §9 (`docs/SPEC.md`
in the Waypoint repo). See [references/examples.md](references/examples.md) for a
worked digest.

## When you produce something for a human to review (push loop)

When you write a plan, migration, design decision, summary, or a set of open
questions that a human should sign off on before you proceed:

1. Write it as a `.md` file using the Waypoint SPEC — real questions the human
   can answer, not just prose. See [references/authoring.md](references/authoring.md).
2. Push it: `waypoint push path/to/doc.md [--project <name>] [--title "<title>"]`.
   This prints a review URL and drops a `.waypoint/pending.json` pointer. If the
   server is down, the push is queued offline and does not fail — say so and
   continue.
3. Tell the user where to review it (the printed URL; reviewable from a phone
   over Tailscale), then continue with work that does not depend on the answers.
   Pick the review back up next session via the pull loop above.

Do not push trivial output. Push the things a human genuinely needs to weigh in
on: irreversible choices, ambiguous requirements, architectural forks, anything
where guessing wrong is expensive.

## Authoring rules (summary)

Full guidance with examples is in [references/authoring.md](references/authoring.md).
The essentials:

- Opt in with frontmatter `waypoint: 1`. Everything else is plain markdown; all
  machinery lives in `<!-- wp:… -->` HTML comments, invisible in any renderer.
- **Text question** for open-ended input; **choice question** for a decision with
  known options (`select="single"` → pick one, `select="multi"` → pick several).
- Every question needs a unique, stable `id` (`q1`, `q2`, …). Keep prompts
  self-contained — the reviewer may only see that one card.
- Pre-fill a `wp:answer` block with your recommended answer or a checked box when
  you have a real recommendation; the human edits it rather than starting blank.
- A text-only response on a choice question is always valid — leave room for "none
  of these, here's what I'd do instead."

## Reference files

- [references/authoring.md](references/authoring.md) — how to write SPEC v1 docs:
  text vs choice, ID discipline, self-contained prompts, pre-filling drafts.
- [references/examples.md](references/examples.md) — a complete review doc, the
  annotated result, and the digest an agent acts on.

## Setup (first time in a repo)

If `waypoint` is not on PATH, run it via `npx waypoint-md <command>`. If the repo
has no `.waypoint.json`, run `waypoint init` (writes config, ignores the pointer
dir, and installs this skill locally). Config resolves flags → env
(`WAYPOINT_URL`, `WAYPOINT_TOKEN`) → `.waypoint.json` → `~/.waypoint/config.json`;
the token is never written to the project-local file.
