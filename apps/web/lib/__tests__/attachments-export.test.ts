import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyReview } from "@waypoint/spec";

import type { AttachmentMeta } from "@/lib/attachments";
import { exportName } from "@/lib/attachments";
import {
  attachmentReferenceLine,
  enrichReviewWithAttachments,
} from "@/lib/attachments-export";
import { buildDigest } from "@/lib/digest";
import type { DocumentDetail, ItemDetail } from "@/lib/documents";
import { buildReviewState, exportBaseName } from "@/lib/review-state";

const FIXTURES = path.resolve(process.cwd(), "packages/spec/fixtures");
const rationaleAndAnswer = readFileSync(path.join(FIXTURES, "choice-rationale-and-answer.md"), "utf8");
const AT = "2026-07-09T00:00:00.000Z";

/** The verbatim rationale block that must survive an attachment export untouched. */
const RATIONALE_BLOCK = `<!-- wp:rationale -->
Fly's per-region volumes match the WAL-mode SQLite file we already ship, so
there's no storage rework to standing this up.
<!-- /wp:rationale -->`;

function meta(over: Partial<AttachmentMeta> = {}): AttachmentMeta {
  const base = {
    id: "att12abcd",
    itemId: "it-deploy",
    filename: "screenshot.png",
    mime: "image/png",
    bytesLen: 12,
    createdAt: AT,
    ...over,
  };
  return { ...base, exportName: over.exportName ?? exportName(base.id, base.filename) };
}

function makeDetail(over: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: "doc1",
    projectId: null,
    projectName: null,
    title: "Deploy target",
    rawMd: "",
    frontmatter: null,
    sourceType: "paste",
    sourcePath: null,
    sourceUrl: null,
    pushedFromHost: null,
    specVersion: null,
    status: "in_review",
    supersedesId: null,
    createdAt: AT,
    updatedAt: AT,
    items: [],
    comments: [],
    ...over,
  };
}

function choiceItem(over: Partial<ItemDetail> = {}): ItemDetail {
  return {
    id: "it-deploy",
    wpId: "deploy",
    type: "choice",
    config: null,
    promptMd: null,
    synthetic: false,
    anchor: null,
    orderIndex: 0,
    response: null,
    attachments: [],
    ...over,
  };
}

describe("attachment export enrichment (B-4)", () => {
  it("appends a reference line inside the answer interior as reviewer content", () => {
    const detail = makeDetail({
      rawMd: rationaleAndAnswer,
      items: [
        choiceItem({
          response: {
            value: {
              selected: ["Fly.io"],
              other: "Going with Fly, but pin a specific region so the volume never migrates.",
            },
            status: "answered",
            updatedAt: AT,
          },
          attachments: [meta()],
        }),
      ],
    });

    const review = enrichReviewWithAttachments(buildReviewState(detail, AT), detail);
    const exported = applyReview(detail.rawMd, review);

    const ref = attachmentReferenceLine(exportBaseName(detail), meta());
    // The reference lands inside the wp:answer interior, after the elaboration.
    expect(exported).toContain("Going with Fly, but pin a specific region");
    expect(exported).toContain(ref);
    const answerInterior = exported.slice(
      exported.indexOf("<!-- wp:answer"),
      exported.indexOf("<!-- /wp:answer -->"),
    );
    expect(answerInterior).toContain(ref);
    // The reference path points at the sibling attachments folder.
    expect(ref).toBe(
      `_Attachment: ![screenshot](deploy-target.attachments/${meta().exportName})_`,
    );
  });

  it("CRITICAL: a rationale block stays byte-identical alongside an attachment reference", () => {
    const detail = makeDetail({
      rawMd: rationaleAndAnswer,
      items: [
        choiceItem({
          response: {
            value: { selected: ["Fly.io"], other: "Pin the region." },
            status: "answered",
            updatedAt: AT,
          },
          attachments: [meta()],
        }),
      ],
    });

    const review = enrichReviewWithAttachments(buildReviewState(detail, AT), detail);
    const exported = applyReview(detail.rawMd, review);

    // The append targets the wp:answer interior, never the wp:rationale interior.
    expect(exported).toContain(RATIONALE_BLOCK);
    // And the reference really did splice into the answer interior.
    expect(exported).toContain(attachmentReferenceLine(exportBaseName(detail), meta()));
  });

  it("byte-fidelity: a doc WITH attachments still yields applyReview(raw, {}) === raw", () => {
    const detail = makeDetail({
      rawMd: rationaleAndAnswer,
      items: [choiceItem({ attachments: [meta()] })],
    });
    // Attachments are additive; applyReview never learns about them, so the empty
    // review is a perfect round-trip — the #1 non-negotiable holds.
    expect(applyReview(detail.rawMd, {})).toBe(rationaleAndAnswer);
  });

  it("a doc with NO attachments enriches to a no-op and exports byte-identically", () => {
    const detail = makeDetail({ rawMd: rationaleAndAnswer, items: [choiceItem()] });
    const review = enrichReviewWithAttachments(buildReviewState(detail, AT), detail);
    // No responses + no attachments → empty review → byte-identical export.
    expect(applyReview(detail.rawMd, review)).toBe(rationaleAndAnswer);
  });

  it("preserves an untouched item's pre-filled draft when only an attachment exists", () => {
    // The reviewer pasted an image (an attachment) but never edited the text, so
    // there is no response row. The source draft must survive, with the reference
    // appended after it — not clobbered by a bare reference.
    const raw = `<!-- wp:question id="q1" type="text" -->
**Q?**
<!-- wp:answer -->
The agent's suggested draft.
<!-- /wp:answer -->
<!-- /wp:question -->
`;
    const untouched = choiceItem({
      id: "it-q1",
      wpId: "q1",
      type: "text",
      response: null, // no reviewer response row
      attachments: [meta({ id: "dd44ee55", itemId: "it-q1", filename: "note.png" })],
    });
    const detail = makeDetail({ id: "d3", title: "Draft host", rawMd: raw, items: [untouched] });

    const review = enrichReviewWithAttachments(buildReviewState(detail, AT), detail);
    const exported = applyReview(detail.rawMd, review);
    expect(exported).toContain("The agent's suggested draft.");
    expect(exported).toContain(
      attachmentReferenceLine(exportBaseName(detail), meta({ id: "dd44ee55", filename: "note.png" })),
    );
    // Draft comes before the reference (appended, not prepended).
    expect(exported.indexOf("suggested draft")).toBeLessThan(exported.indexOf("_Attachment:"));
  });

  it("appends into the text answer of a text item (field routing)", () => {
    const raw = `<!-- wp:question id="q1" type="text" -->
**Q?**
<!-- wp:answer -->
My answer.
<!-- /wp:answer -->
<!-- /wp:question -->
`;
    const textItem = choiceItem({
      id: "it-q1",
      wpId: "q1",
      type: "text",
      response: { value: { text: "My answer." }, status: "answered", updatedAt: AT },
      attachments: [meta({ id: "aa11bb22", itemId: "it-q1", filename: "diagram.png" })],
    });
    const detail = makeDetail({ id: "d2", title: "Text host", rawMd: raw, items: [textItem] });

    const review = enrichReviewWithAttachments(buildReviewState(detail, AT), detail);
    const exported = applyReview(detail.rawMd, review);
    expect(exported).toContain("My answer.");
    expect(exported).toContain(
      attachmentReferenceLine(exportBaseName(detail), meta({ id: "aa11bb22", filename: "diagram.png" })),
    );
  });
});

describe("digest gains an Attachments field (B-4)", () => {
  it("lists each response's attachment relative paths, distinct from the answer", () => {
    const detail = makeDetail({
      rawMd: rationaleAndAnswer,
      items: [
        choiceItem({
          response: {
            value: { selected: ["Fly.io"], other: "Pin the region." },
            status: "answered",
            updatedAt: AT,
          },
          attachments: [meta(), meta({ id: "cc33dd44", filename: "logs.png" })],
        }),
      ],
    });

    const digest = buildDigest(detail, AT);
    expect(digest).toContain("**Attachments:**");
    expect(digest).toContain(`deploy-target.attachments/${meta().exportName}`);
    expect(digest).toContain(`deploy-target.attachments/${exportName("cc33dd44", "logs.png")}`);
    // The answer body itself is not polluted with the reference syntax.
    const questionBlock = digest.slice(digest.indexOf("### deploy"));
    expect(questionBlock).not.toContain("_Attachment:");
  });

  it("omits the Attachments field when a response has none", () => {
    const detail = makeDetail({
      rawMd: rationaleAndAnswer,
      items: [
        choiceItem({
          response: { value: { selected: ["Fly.io"] }, status: "answered", updatedAt: AT },
        }),
      ],
    });
    expect(buildDigest(detail, AT)).not.toContain("**Attachments:**");
  });
});
