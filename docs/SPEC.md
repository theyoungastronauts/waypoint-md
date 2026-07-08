# Waypoint Review Convention — SPEC v1.0.0

**Status:** Stable · **Spec version:** `1.0.0` · **Frontmatter marker:** `waypoint: 1`

This is the public contract for the Waypoint review convention: a tiny set of
HTML-comment markers that turn ordinary markdown into an interactive review
surface, and the rules for parsing it and writing reviewer state back out.

It is implemented by the `@waypoint/spec` package (`parseDocument`,
`applyReview`). The convention is versioned independently of the app and CLI;
anything consuming Waypoint output should pin to a spec version.

## Versioning

The spec carries its own semver, exported as `SPEC_VERSION`. The `waypoint`
frontmatter value is the **major** version of the convention a document opts
into (`waypoint: 1` for the `1.x` line). Within a major version:

- **Patch** — clarifications and parser bug fixes; no format change.
- **Minor** — additive, backward-compatible markers or attributes.
- **Major** — a breaking change to existing markers; a new `waypoint:` value.

## Design principles

- **Reads as plain markdown.** Every marker is an HTML comment (`<!-- wp:… -->`),
  invisible in any renderer. The visible content is ordinary markdown.
- **Hand-answerable.** A person with only a text editor can fill in answers and
  check boxes. The app is the nice way, not the only way.
- **Deterministic.** Open/close comment pairs carry explicit IDs. When the
  convention is present, no heuristics are needed.
- **Splice-friendly.** Every block's byte offsets are recorded at parse time so
  the writer modifies only block interiors — clean diffs are a feature.

---

## 1. Frontmatter

Optional YAML frontmatter at the very top of the file:

```markdown
---
waypoint: 1                  # convention major version (opt-in marker)
title: "RDS Migration Plan"
project: acme-api            # optional; the CLI sets it
source: docs/plan.md         # optional; the CLI sets it for round-trip
---
```

All keys are optional and unknown keys are preserved. `waypoint: 1` signals
that a document intends to use the convention; the parser does not require it —
`wp:` markers are parsed wherever they appear (a document can carry questions
without frontmatter). The writer stamps two keys on export; see §6.

## 2. Free-text question

```markdown
<!-- wp:question id="q1" type="text" -->
**Q1 — Sizing:** Do we stay on the upgraded instance class, or right-size
down once the incident settles? What's the decision window?
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
```

- `id` — unique within the document. Required; a missing id produces a warning.
- The visible markdown between the question-open comment and `wp:answer` is the
  **prompt**.
- The reviewer's answer is written **inside** the `wp:answer` block on export. An
  agent (or human) may pre-fill a suggested answer there; the app shows it as a
  pre-populated draft.

## 3. Choice question

```markdown
<!-- wp:question id="q2" type="choice" select="single" -->
**Q2 — Auth model for v1:**
- [ ] Single shared token
- [ ] Per-device tokens
- [x] Tailscale-only, no app auth
<!-- wp:answer -->
Optional elaboration / "other" text lands here.
<!-- /wp:answer -->
<!-- /wp:question -->
```

- `select="single" | "multi"` (defaults to `single` if omitted).
- Options are a GFM task list. The checked boxes are the selection; each
  option's **label** (its source-markdown text) is its stable value.
- The `wp:answer` block carries free-text **elaboration** ("other").
- A free-text answer is always allowed — alongside a selection or instead of
  one. **A text-only response with no box checked is valid.**

**Ratified semantics — first-checked-wins.** If a `select="single"` question has
more than one box checked, the parser emits a `multi-checked-single` warning and
keeps **only the first checked option**. By hand the boxes just work; the app
renders `single` as a radio group and `multi` as checkboxes.

## 4. Comment

Emitted on export from selection comments; agents may also author them by hand.

```markdown
<!-- wp:comment id="c1" exact="the camcorder photo beat" prefix="pays off " suffix=" in act three" -->
This contradicts the phase 2 decision — it's the barcode scanner now.
<!-- wp:suggestion -->
pays off the barcode scanner beat in act three
<!-- /wp:suggestion -->
<!-- /wp:comment -->
```

- **Quote-based anchoring** (W3C-annotation style), not offsets, so anchors
  survive minor edits: `exact` is the selected text; `prefix`/`suffix` are short
  context strings on either side.
- **Caps:** `prefix` and `suffix` ≤ 32 characters; `exact` ≤ 200 characters.
  A longer selection is truncated to 200 and an `exact-hash` attribute carries a
  hash of the full selection.
- **Encoding:** attribute values are HTML-attribute-encoded (`&` `<` `>` `"`).
- The optional nested `wp:suggestion` block carries proposed replacement text —
  a diff an agent can apply verbatim.
- On export, a comment is placed **immediately after the source block that
  contains its anchor**.

## 5. Answer status

The `wp:answer` open comment may carry a `status` attribute, written on export:

```markdown
<!-- wp:answer status="flagged" -->
Need to check with Jona before answering.
<!-- /wp:answer -->
```

`status ∈ answered | flagged | skipped`. Absent means untouched. `flagged`
means "revisit later"; `skipped` means intentionally passed over.

---

## 6. Parsing

`parseDocument(raw)` returns:

```ts
{
  frontmatter: Frontmatter        // parsed YAML; {} when absent
  items: Item[]                    // questions: type, config, prompt, options, spans, embedded response
  comments: Comment[]              // authored comments with anchors + spans
  spans: SpanIndex                 // byte offsets for every wp block + interior
  warnings: Warning[]              // non-fatal problems (see below)
}
```

Guarantees:

- **Never throws.** All malformed structure degrades to `warnings`: missing or
  duplicate ids, unpaired open/close tags, orphan closes, a choice with no
  options, and the multi-checked-single case. The document still parses and
  remains usable.
- **A no-convention document parses to zero items, zero comments, zero
  warnings.**
- **Fence-aware.** `wp:` markers inside fenced or inline code do **not** parse —
  they are documentation, not machinery.
- **CRLF is tolerated and never normalized.** Byte offsets index straight back
  into the source.
- The **response currently embedded in the document** (a pre-filled draft, the
  checked boxes, a `status`) is surfaced on each item as `response`.

## 7. Export and round-trip

`applyReview(raw, review)` writes reviewer state back into the document. It is a
**pure function of `(raw, review)`** and never re-serializes the markdown AST
(that would normalize formatting and produce noisy diffs). Using the parser's
byte offsets, it:

1. replaces the interior of each `wp:answer` with the response text;
2. flips `[ ]`/`[x]` checkbox markers to match the selection (unchanged boxes
   are left untouched);
3. writes the `status` attribute on the answer-open comment;
4. inserts `wp:comment` blocks after the source block that contains each anchor;
5. stamps `waypoint_status` and (when supplied) `reviewed_at` into the
   frontmatter, creating a frontmatter block if the source had none.

Edits are applied in **descending byte-offset order**, so an earlier edit never
invalidates a later span.

**The two invariants (enforced by tests over every fixture):**

- **Byte-fidelity.** `applyReview(raw, {}) === raw`, byte-for-byte. An empty
  review — and a review carrying only empty responses — changes nothing, stamps
  nothing, and preserves CRLF and trailing bytes exactly.
- **Round-trip.** `parseDocument(applyReview(raw, state))` recovers `state`: text
  answers, single/multi selections, elaborations, statuses, and comments with
  their suggestions come back exactly.

The frontmatter stamp is applied **only when the review is non-empty**, so an
untouched document exports identically to its source. It is also applied only
when the review *materially* touches the document — a response keyed to a
`wp_id` that does not exist in the source (and no comments) changes nothing and
stamps nothing.

### Explicit-empty answers (clearing a pre-filled draft)

A `wp:answer` block may ship with a **pre-filled draft** (an agent's suggested
answer). Two reviewer actions must be distinguished on export:

- **Never touched** — no response is supplied for the item. The source draft is
  left exactly as it was (byte-identical).
- **Explicitly cleared** — the reviewer deleted the draft. The response carries
  an explicit-empty sentinel (`cleared: true` on the `ResponseValue`), and the
  writer replaces the answer interior with an empty one, so the rejected draft
  does **not** reappear in the export.

Without the sentinel, an absent-or-blank response is indistinguishable from
"untouched," and a deleted draft would silently return on export. `cleared` is
an **export input only**: the parser never emits it, and a cleared answer
round-trips to *no* embedded response (the block is empty). Clearing an answer
that was already empty changes nothing but the frontmatter stamp.

## 8. Documents without the convention

Any markdown file is valid input. Two escalating affordances (built in later
phases, listed here for completeness) require no `wp:` markers in the source:

- **Selection comments** anchor to quoted text and need no structure.
- **Adoptive import** proposes structured questions anchored by quotes. Such
  items are `synthetic`: they live outside the source and export into an
  appended `## Waypoint responses` section rather than spliced blocks, so the
  original document body stays byte-identical.

---

## Warning codes

`parseDocument` may emit any of: `missing-id`, `duplicate-id`, `missing-type`,
`unknown-type`, `unclosed-question`, `orphan-question-close`,
`answer-outside-question`, `duplicate-answer`, `orphan-answer-close`,
`unclosed-answer`, `no-options`, `multi-checked-single`, `nested-comment`,
`suggestion-outside-comment`, `orphan-suggestion`, `orphan-comment-close`,
`unclosed-comment`. None is fatal.
