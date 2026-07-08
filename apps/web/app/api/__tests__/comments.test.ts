import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDocument } from "@waypoint/spec";

import { setupTestDb } from "@/test/db";
import { buildAnchorFromRenderedSelection } from "@/lib/anchor/source-map";
import { POST as postComment } from "@/app/api/documents/[id]/comments/route";
import { PATCH as patchComment, DELETE as deleteCommentRoute } from "@/app/api/comments/[id]/route";
import { GET as exportRoute } from "@/app/api/documents/[id]/export/route";
import { getDocumentDetail } from "@/lib/documents";
import { ingestDocument } from "@/lib/ingest/service";

const FIXTURES = path.resolve(process.cwd(), "packages/spec/fixtures");
const kitchenSink = readFileSync(path.join(FIXTURES, "kitchen-sink.md"), "utf8");

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

interface CommentBody {
  anchor: { exact: string; prefix?: string; suffix?: string; exactHash?: string };
  bodyMd?: string;
  suggestionMd?: string | null;
}

function postCommentFor(docId: string, body: CommentBody) {
  return postComment(
    new Request(`http://localhost/api/documents/${docId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: docId }) },
  );
}

function patchCommentFor(commentId: string, body: unknown) {
  return patchComment(
    new Request(`http://localhost/api/comments/${commentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: commentId }) },
  );
}

function deleteCommentFor(commentId: string) {
  return deleteCommentRoute(new Request(`http://localhost/api/comments/${commentId}`, { method: "DELETE" }), {
    params: Promise.resolve({ id: commentId }),
  });
}

function exportGet(docId: string) {
  return exportRoute(new Request(`http://localhost/api/documents/${docId}/export?format=annotated`), {
    params: Promise.resolve({ id: docId }),
  });
}

describe("POST /api/documents/:id/comments", () => {
  it("creates a comment and returns it with a capped anchor", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const res = await postCommentFor(id, {
      anchor: { exact: "intro prose", prefix: "Some ", suffix: " describing" },
      bodyMd: "Tighten this sentence.",
    });
    expect(res.status).toBe(201);
    const { comment } = await res.json();
    expect(comment.anchor.exact).toBe("intro prose");
    expect(getDocumentDetail(id)!.comments).toHaveLength(1);
  });

  it("caps an over-long exact server-side even if the client does not", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const long = "z".repeat(300);
    const res = await postCommentFor(id, { anchor: { exact: long }, bodyMd: "x" });
    const { comment } = await res.json();
    expect(comment.anchor.exact.length).toBe(200);
    expect(comment.anchor.exactHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("404s for an unknown document", async () => {
    const res = await postCommentFor("nope", { anchor: { exact: "x" }, bodyMd: "y" });
    expect(res.status).toBe(404);
  });

  it("rejects a comment with neither body nor suggestion", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const res = await postCommentFor(id, { anchor: { exact: "intro prose" }, bodyMd: "   " });
    expect(res.status).toBe(400);
  });

  it("accepts a suggestion-only comment (empty body)", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const res = await postCommentFor(id, {
      anchor: { exact: "intro prose" },
      bodyMd: "",
      suggestionMd: "intro copy",
    });
    expect(res.status).toBe(201);
  });
});

describe("PATCH / DELETE /api/comments/:id", () => {
  it("updates the body and suggestion", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const created = (await (await postCommentFor(id, { anchor: { exact: "intro prose" }, bodyMd: "first" })).json())
      .comment;

    const res = await patchCommentFor(created.id, { bodyMd: "second", suggestionMd: "a suggestion" });
    expect(res.status).toBe(200);
    const detail = getDocumentDetail(id)!.comments[0];
    expect(detail.bodyMd).toBe("second");
    expect(detail.suggestionMd).toBe("a suggestion");
  });

  it("clears a suggestion with null", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const created = (
      await (await postCommentFor(id, { anchor: { exact: "intro prose" }, bodyMd: "b", suggestionMd: "s" })).json()
    ).comment;
    await patchCommentFor(created.id, { suggestionMd: null });
    expect(getDocumentDetail(id)!.comments[0].suggestionMd).toBeNull();
  });

  it("404s for an unknown comment on patch and delete", async () => {
    expect((await patchCommentFor("nope", { bodyMd: "x" })).status).toBe(404);
    expect((await deleteCommentFor("nope")).status).toBe(404);
  });

  it("deletes a comment", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const created = (await (await postCommentFor(id, { anchor: { exact: "intro prose" }, bodyMd: "gone soon" })).json())
      .comment;
    expect((await deleteCommentFor(created.id)).status).toBe(200);
    expect(getDocumentDetail(id)!.comments).toHaveLength(0);
  });
});

describe("export with comments (§5.4, §11) — end to end", () => {
  it("splices wp:comment + nested wp:suggestion after the anchored block and round-trips", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    await postCommentFor(id, {
      anchor: { exact: "intro prose", prefix: "Some ", suffix: " describing" },
      bodyMd: "This contradicts the phase 2 decision.",
      suggestionMd: "Some corrected prose describing",
    });

    const exported = await (await exportGet(id)).text();

    // The comment lands after the intro paragraph, before q1.
    const introIdx = exported.indexOf("Some intro prose describing");
    const commentIdx = exported.indexOf("<!-- wp:comment");
    const q1Idx = exported.indexOf('<!-- wp:question id="q1"');
    expect(commentIdx).toBeGreaterThan(introIdx);
    expect(commentIdx).toBeLessThan(q1Idx);
    expect(exported).toContain("<!-- wp:suggestion -->\nSome corrected prose describing\n<!-- /wp:suggestion -->");

    // Re-parse recovers the comment with its suggestion.
    const reparsed = parseDocument(exported);
    expect(reparsed.comments).toHaveLength(1);
    expect(reparsed.comments[0].bodyMd).toBe("This contradicts the phase 2 decision.");
    expect(reparsed.comments[0].suggestionMd).toBe("Some corrected prose describing");
    expect(reparsed.comments[0].anchor.exact).toBe("intro prose");
  });

  it("byte-fidelity: a comment-only export adds exactly the comment block + stamp", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    await postCommentFor(id, {
      anchor: { exact: "intro prose", prefix: "Some ", suffix: " describing" },
      bodyMd: "note",
    });
    const exported = await (await exportGet(id)).text();

    // Untouched regions survive byte-for-byte: closing prose, prompts, and q1's
    // embedded draft answer (no responses were submitted).
    expect(exported).toContain("Closing prose that should never be touched by the writer.");
    expect(exported).toContain("Stay on the upgraded class through end of quarter, then re-evaluate.");
    // Reconstruct the source by removing the two known insertions.
    const stripped = exported
      .replace(/\nwaypoint_status: completed\nreviewed_at: [^\n]+/, "")
      .replace(/\n\n<!-- wp:comment[\s\S]*?<!-- \/wp:comment -->/, "");
    expect(stripped).toBe(kitchenSink);
  });

  it("the killer test: a repeated phrase resolves to the occurrence that was selected", async () => {
    // Two prose paragraphs contain the same phrase. Selecting it in the SECOND
    // paragraph (the client builds the anchor from that segment's source) must
    // export a comment after the second block, not the first.
    const doc = ["---", "waypoint: 1", "---", "", "The plan looks solid.", "", "I disagree with the plan here.", ""].join(
      "\n",
    );
    const { id } = ingestDocument({ raw: doc, sourceType: "paste" });

    const segSource = "I disagree with the plan here.";
    const segBase = doc.indexOf(segSource);
    const at = segSource.indexOf("the plan");
    const built = buildAnchorFromRenderedSelection({
      renderedText: segSource, // plain prose: rendered === source
      selStart: at,
      selEnd: at + "the plan".length,
      segSource,
      segBase,
    })!;

    await postCommentFor(id, { anchor: built.anchor, bodyMd: "which plan?" });
    const exported = await (await exportGet(id)).text();

    const firstIdx = exported.indexOf("The plan looks solid.");
    const secondIdx = exported.indexOf("I disagree with the plan here.");
    const commentIdx = exported.indexOf("<!-- wp:comment");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(commentIdx).toBeGreaterThan(secondIdx); // after the SECOND paragraph
  });

  it("documents the observed mid-question-block placement (Phase 2 handoff)", async () => {
    // A comment whose anchor is INSIDE a question prompt (not prose) lands after
    // the prompt paragraph — inside the wp:question block, before wp:answer. It
    // still exports and re-parses as a valid comment; the observed trade-off is
    // that the re-parsed prompt text visually includes the inserted comment.
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    await postCommentFor(id, {
      anchor: { exact: "Auth model for v1", prefix: "**Q2 — ", suffix: ":**" },
      bodyMd: "clarify which surface",
    });
    const exported = await (await exportGet(id)).text();

    const q2Open = exported.indexOf('<!-- wp:question id="q2"');
    const commentIdx = exported.indexOf("<!-- wp:comment", q2Open);
    const q2Answer = exported.indexOf("<!-- wp:answer", q2Open);
    // The comment sits between the prompt and the answer block (inside q2).
    expect(commentIdx).toBeGreaterThan(q2Open);
    expect(commentIdx).toBeLessThan(q2Answer);

    // It still round-trips as a comment (never dropped, never corrupts the parse).
    const reparsed = parseDocument(exported);
    expect(reparsed.comments.map((c) => c.bodyMd)).toContain("clarify which surface");
    expect(reparsed.items.find((i) => i.wpId === "q2")).toBeDefined();
  });
});
