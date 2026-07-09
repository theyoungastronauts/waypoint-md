import { describe, expect, it } from "vitest";
import type { DocumentDetail, ItemDetail } from "@/lib/documents";
import { buildReviewState, exportFilename } from "@/lib/review-state";

function item(partial: Partial<ItemDetail>): ItemDetail {
  return {
    id: "item-id",
    wpId: "q1",
    type: "text",
    config: null,
    promptMd: "prompt",
    synthetic: false,
    anchor: null,
    orderIndex: 0,
    response: null,
    attachments: [],
    ...partial,
  };
}

function detail(items: ItemDetail[], comments: DocumentDetail["comments"] = []): DocumentDetail {
  return {
    id: "doc-1",
    projectId: null,
    projectName: null,
    title: "Doc",
    rawMd: "",
    frontmatter: null,
    sourceType: "paste",
    sourcePath: null,
    sourceUrl: null,
    pushedFromHost: null,
    specVersion: null,
    status: "pending",
    supersedesId: null,
    createdAt: "",
    updatedAt: "",
    items,
    comments,
  };
}

describe("buildReviewState", () => {
  it("always passes reviewedAt through (handoff: applyReview stamps nothing otherwise)", () => {
    const state = buildReviewState(detail([]), "2026-07-07T00:00:00.000Z");
    expect(state.reviewedAt).toBe("2026-07-07T00:00:00.000Z");
    expect(state.responses).toBeUndefined();
  });

  it("maps persisted responses keyed by wp_id, folding status in", () => {
    const state = buildReviewState(
      detail([
        item({ id: "a", wpId: "q1", response: { value: { text: "Yes" }, status: "answered", updatedAt: "" } }),
        item({
          id: "b",
          wpId: "q2",
          type: "choice",
          response: { value: { selected: ["Beta"], other: "why" }, status: "flagged", updatedAt: "" },
        }),
      ]),
      "t",
    );
    expect(state.responses).toEqual({
      q1: { text: "Yes", status: "answered" },
      q2: { selected: ["Beta"], other: "why", status: "flagged" },
    });
  });

  it("skips wp_id-less and synthetic items entirely", () => {
    const state = buildReviewState(
      detail([
        item({ id: "a", wpId: null, response: { value: { text: "orphan" }, status: null, updatedAt: "" } }),
        item({ id: "c", wpId: "q3", synthetic: true, response: { value: { text: "syn" }, status: "answered", updatedAt: "" } }),
      ]),
      "t",
    );
    expect(state.responses).toBeUndefined();
  });

  it("marks an empty-content response row as cleared (W1), never dropping it", () => {
    const state = buildReviewState(
      detail([
        // A response row exists but carries no content: the reviewer emptied a
        // pre-filled draft. It must export as an explicit clear, not vanish.
        item({ id: "b", wpId: "q2", response: { value: { text: "  " }, status: null, updatedAt: "" } }),
      ]),
      "t",
    );
    expect(state.responses).toEqual({ q2: { text: "  ", cleared: true } });
  });

  it("leaves a never-touched item (no response row) out of the review state", () => {
    const state = buildReviewState(
      detail([item({ id: "b", wpId: "q2", response: null })]),
      "t",
    );
    expect(state.responses).toBeUndefined();
  });
});

describe("exportFilename", () => {
  it("prefers the source path stem", () => {
    expect(exportFilename({ id: "x", title: "Ignored", sourcePath: "docs/plan.md" })).toBe("plan.review.md");
  });
  it("falls back to a slugified title, then the id", () => {
    expect(exportFilename({ id: "x", title: "RDS Migration Plan", sourcePath: null })).toBe("rds-migration-plan.review.md");
    expect(exportFilename({ id: "doc-1", title: null, sourcePath: null })).toBe("doc-1.review.md");
  });
});
