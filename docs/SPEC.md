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

### Adoptive-import export (`## Waypoint responses`)

Synthetic items have no answer anchor in the source, so `applyReview` never
touches them. Instead, the annotated export **appends** a section after the
byte-faithful document body — and only when at least one synthetic item has a
real answer. A document with no synthetic activity exports exactly what
`applyReview` produced (an untouched document is byte-identical to its source).

The appended section is:

```markdown
## Waypoint responses

<!-- Waypoint adoptive-import responses (SPEC v1 §8). The document above is byte-identical to its imported source; these structured items live only here. -->

### 1. <question, first prompt line>

> <verbatim source anchor quote>

<the reviewer's answer>
```

Each answered synthetic item is one `###` block, numbered in document order (by
anchor offset). Choice answers render as `**Selected:** a, b` followed by any
elaboration; a `flagged`/`skipped` status is noted in italics. The body above
this section is a byte-exact prefix of the export — only a blank line and the
appended section follow it.

---

## 9. Digest export

The **digest** is the second export format (alongside the annotated file):
`GET /api/documents/:id/export?format=digest`, and `waypoint pull --digest`
writes it as `<name>.digest.md`. It is a compact, deterministic summary of a
document's review state — frontmatter counts, `Q → A` pairs, comments, and
adoptive-import responses — so an agent can act on the review **without
re-reading the source document**.

The digest describes exactly the same review state as the annotated export. It
is derived from that export (the merged answers, checkbox states, statuses, and
comments), so the two can never disagree: an untouched pre-filled draft (§2) and
a reviewer's override surface identically in both.

This section is the **parsing contract** — the structure below is stable within
the `1.x` line.

### 9.1 Shape

A digest is a markdown document: YAML frontmatter, an `# Digest — <title>`
heading, then up to three `##` sections in this fixed order — **Questions**,
**Comments**, **Structured responses**. A section is present **only when it has
content**; its absence means zero of that kind.

```markdown
---
waypoint_digest: 1
title: "RDS Migration Plan"
project: "acme-api"
source: "docs/plan.md"
status: "in_review"
reviewed_at: "2026-07-08T12:00:00.000Z"
answered: 2
flagged: 1
skipped: 0
untouched: 0
total: 3
comments: 1
synthetic: 0
---

# Digest — RDS Migration Plan

## Questions

### q1 · text · answered
**Q:** **Q1 — Sizing:** Do we stay on the upgraded instance class?
**A:** Stay on the upgraded class through end of quarter.

### q2 · choice (single) · answered
**Q:** **Q2 — Auth model for v1:**
**Selected:** Tailscale-only, no app auth
**Note:** revisit once we add a second device

### q3 · choice (multi) · flagged
**Q:** **Q3 — Which environments get the change first?**
**Selected:** staging, dev

## Comments

### c1
**Anchor:** "the camcorder photo beat"
**Comment:** This contradicts the phase 2 decision.
**Suggestion:** pays off the barcode scanner beat in act three
```

### 9.2 Frontmatter keys

Fixed key order. `waypoint_digest: 1` is the format-version marker and always
comes first. `title`, `project`, `source` appear only when known. The remaining
keys are always present:

| Key | Meaning |
|---|---|
| `waypoint_digest` | Digest format major version (`1`). |
| `title` / `project` / `source` | Document metadata, when known. |
| `status` | The document's lifecycle status (`pending`/`in_review`/`completed`/`pulled`). |
| `reviewed_at` | ISO-8601 timestamp the digest was generated. |
| `answered` / `flagged` / `skipped` / `untouched` | Question counts by effective status; they sum to `total`. |
| `total` | Number of `## Questions` entries (the `wp:` items). |
| `comments` | Number of `## Comments` entries. |
| `synthetic` | Number of `## Structured responses` entries. |

### 9.3 Entry grammar

- **Questions.** One `###` entry per `wp:` item, in document order. The heading
  is `### <id> · <type> · <status>` where `<type>` is `text`, `choice (single)`,
  or `choice (multi)`, and `<status>` is `answered | flagged | skipped |
  untouched` (the effective status, same rules as §5). `**Q:**` holds the prompt
  collapsed to one line. Then:
  - text items: `**A:** <answer>` (or `**A:** _(no answer)_`).
  - choice items: `**Selected:** <label, label>` (or `_(none)_`), and, when a
    freeform elaboration exists, a following `**Note:** <text>`.
- **Comments.** One `###` entry per comment (reviewer-authored and any authored
  in the source). `### <id>`, then `**Anchor:** "<exact quote>"`, an optional
  `**Comment:** <body>`, and an optional `**Suggestion:** <replacement>`.
- **Structured responses.** One `###` entry per **answered** synthetic
  (adoptive-import) item (§8), numbered from 1 in anchor order:
  `### <n> · <type> · <status>`, then `**Anchor:** "<source quote>"`, `**Q:**`,
  and the same answer lines as a question entry.

**Value spans.** A field label (`**Q:**`, `**A:**`, `**Selected:**`,
`**Note:**`, `**Anchor:**`, `**Comment:**`, `**Suggestion:**`) starts at the
beginning of a line. **Any line that begins with one of these `**Label:**`
tokens is a field boundary** — it ends the value of the preceding field. So a
multi-line value runs until the next line that starts with a `**Label:**`, a
`###` entry heading, or a `##` section heading, whichever comes first.
`**Q:**`, `**Selected:**`, and `**Anchor:**` values are always single-line;
`**A:**`, `**Note:**`, `**Comment:**`, and `**Suggestion:**` values may span
multiple lines and end at the next boundary. (The renderer emits each field on
its own line, so this boundary rule is unambiguous in practice.)

The digest is **not** round-tripped: there is no parser that reconstructs review
state from it. It is a read-only projection. The annotated export remains the
canonical, byte-faithful artifact (§7).

---

## Warning codes

`parseDocument` may emit any of: `missing-id`, `duplicate-id`, `missing-type`,
`unknown-type`, `unclosed-question`, `orphan-question-close`,
`answer-outside-question`, `duplicate-answer`, `orphan-answer-close`,
`unclosed-answer`, `no-options`, `multi-checked-single`, `nested-comment`,
`suggestion-outside-comment`, `orphan-suggestion`, `orphan-comment-close`,
`unclosed-comment`. None is fatal.
