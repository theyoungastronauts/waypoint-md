---
name: waypoint
description: Author markdown for human review in Waypoint and run its push/pull review loop. Use when you produce a plan, summary, design, or set of decisions/questions that a human should review before you act — write it in the Waypoint SPEC (text + choice questions), push it with `waypoint push`, watch for the review in the background and act on it when it completes, and at the start of a session pull any completed reviews and act on the annotations. Also use when the user mentions Waypoint, a review doc, `waypoint push`/`pull`, or a `.waypoint/pending.json` pointer.
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
4. If it is not yet completed, tell the user it's still under review, start a
   background watch for it (see "Watch for the review" below), and move on.
   Don't block the turn waiting, but do keep watching in the background.

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
3. Tell the user where to review it (relay the printed URL as-is; reviewable from a phone
   over Tailscale), then start a
   background watch for it (below) and continue with work that does not depend
   on the answers. Don't wait for the user to say the review is in.

### Watch for the review

Right after a push, start a non-blocking watch that ends the moment the review
completes. Run it as a background shell command that notifies you once on exit
(in Claude Code, a Bash call with `run_in_background`), from the same directory
you pushed from so `waypoint status` resolves the same project:

```bash
id=$(sed -n 's/.*"id"[^"]*"\([^"]*\)".*/\1/p' .waypoint/pending.json | cut -c1-8)
for i in $(seq 1 1440); do
  s=$(waypoint status 2>/dev/null | awk -v id="$id" '$1==id{print $2}')
  case "$s" in
    completed) echo "REVIEW COMPLETED $id"; exit 0;;
    pulled) echo "ALREADY PULLED $id"; exit 0;;
  esac
  sleep 60
done
echo "WATCH TIMED OUT $id"; exit 1
```

`waypoint status` prints one row per document, `  <8-char id>  <status>  <title>`;
the statuses are `pending`, `in_review`, `completed`, `pulled`. Read the id right
after the push, because the next push overwrites the pointer. A queued offline
push has no id yet, so there is nothing to watch until it is delivered.

When the watch reports `REVIEW COMPLETED`, run `waypoint pull <id> --digest` and
act on it straight away (step 3 of the pull loop), then tell the user what you
did. `ALREADY PULLED` means another session took it, so check the review files
before acting twice. On a timeout, fall back to the pull loop next session.

Do not push trivial output. Push the things a human genuinely needs to weigh in
on: irreversible choices, ambiguous requirements, architectural forks, anything
where guessing wrong is expensive.

## Media publications and reviews

Waypoint also publishes **media** — a render, a still, a PDF — and takes
timecoded review notes on it. Use this when a human needs to watch something and
say what to change, rather than read something and answer questions.

1. **Publish the render.** `waypoint publish out/spot.mp4 --group <material> --label v2 --json`
   uploads the file straight to storage and prints `{ id, title, kind, urls }` on
   stdout and nothing else. A `<file>.manifest.json` beside the render is picked
   up automatically. `--group` is what makes v1 and v2 the same material.
2. **Mint one link per reviewer.** `waypoint links <publication-id> --add "Jay"`
   prints the URL to send. The name is bound to the link, so every note that
   arrives through it is attributed to that person — never ask the reviewer to
   type their name, and never pass one yourself. `waypoint links <publication-id>`
   lists them; `--revoke <link-id>` kills one, instantly and without touching the
   render or the notes already left.
3. **Poll for notes.** `waypoint status --publications` lists every publication
   with its group, label, and how many notes are still unresolved. There is no
   push notification — check it at the start of a session, as with the pull loop.
4. **Pull the notes.** `waypoint pull <publication-id> --digest` writes
   `<name>.digest.md` in the current directory. It is a **media digest**
   (`kind: media`, SPEC §9.4): one entry per open note, each with an
   `**Anchor:**` of `"mm:ss.d"` (or `"general"`), an optional `**Region:**`
   marking a box on the frame as four fractions `x,y,w,h`, a `**By:**` author,
   and the `**Comment:**` itself. No pointer is written and nothing is marked
   pulled — a publication has no review lifecycle.
5. **Act, then resolve each note.** `waypoint resolve <publication-id> c3` marks
   the note the digest called `c3` as acted on, which is what removes it from the
   unresolved count. Resolve one note per change you actually made; leave the
   rest open. Numbers are positional, so resolve against a digest you just
   pulled, not a stale one.

A render usually goes through more than one pass. Publishing v2 with the same
`--group` keeps every existing review link working — the reviewer's link opens
the new version, with its own notes.

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
  annotated result, the digest an agent acts on, and a worked media digest.

## Setup (first time in a repo)

If `waypoint` is not on PATH, run it via `npx waypoint-md <command>`. If the repo
has no `.waypoint.json`, run `waypoint init` (writes config, ignores the pointer
dir, and installs this skill locally). Config resolves flags → env
(`WAYPOINT_URL`, `WAYPOINT_TOKEN`) → `.waypoint.json` → `~/.waypoint/config.json`;
the token is never written to the project-local file.
