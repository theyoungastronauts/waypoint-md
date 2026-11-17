import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "@/test/db";
import { GET as reviewRoute } from "@/app/api/documents/[id]/review/route";
import { PUT as putResponse } from "@/app/api/items/[id]/response/route";
import { POST as postComment } from "@/app/api/documents/[id]/comments/route";
import { GET as exportRoute } from "@/app/api/documents/[id]/export/route";
import { ingestDocument } from "@/lib/ingest/service";
import type { NativeQuestion, NativeReview } from "@/lib/render/native-review";

const FIXTURES = path.resolve(process.cwd(), "packages/spec/fixtures");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

async function review(id: string): Promise<NativeReview> {
  const res = await reviewRoute(new Request(`http://localhost/api/documents/${id}/review`), { params: Promise.resolve({ id }) });
  expect(res.status).toBe(200);
  return res.json();
}

const questions = (r: NativeReview) =>
  r.segments.filter((s): s is { kind: "question" } & NativeQuestion => s.kind === "question");

describe("GET /api/documents/:id/review", () => {
  it("returns prose as markdown and each question parsed, in document order", async () => {
    const { id } = ingestDocument({ raw: fixture("kitchen-sink.md"), sourceType: "paste" });
    const r = await review(id);
    expect(r.document.title).toBe("RDS Migration Plan");
    // The server's walk drops whitespace-only prose between questions.
    expect(r.segments.map((s) => s.kind)).toEqual(["prose", "question", "question", "question", "prose"]);
    expect(r.segments[0]).toMatchObject({ kind: "prose" });
    expect((r.segments[0] as { markdown: string }).markdown).toContain("Some intro prose describing the migration, with **bold**");

    const [q1, q2, q3] = questions(r);
    expect(q1).toMatchObject({ wpId: "q1", type: "text", select: null, saved: false });
    expect(q1.promptMd).toContain("**Q1 — Sizing:**");
    // The source's pre-filled answer is the draft to start from, as on the web.
    expect(q1.draft).toEqual({ text: "Stay on the upgraded class through end of quarter, then re-evaluate.", selected: [], other: "", status: "answered" });
    expect(q2).toMatchObject({ type: "choice", select: "single" });
    expect(q2.options).toEqual([
      { label: "Single shared token", checked: false },
      { label: "Per-device tokens", checked: false },
      { label: "Tailscale-only, no app auth", checked: true },
    ]);
    expect(q3.select).toBe("multi");
    expect(q3.draft.selected).toEqual(["staging", "dev"]);
    expect(q1.itemId).toBeTruthy();
  });

  it("carries the rationale read only, separate from the elaboration", async () => {
    const { id } = ingestDocument({ raw: fixture("choice-with-rationale.md"), sourceType: "paste" });
    const [q] = questions(await review(id));
    expect(q.rationaleMd).toBeTruthy();
    expect(q.draft.other).toBe("");
  });

  it("gives each question a comment anchor that the comment route accepts and the export places", async () => {
    const { id } = ingestDocument({ raw: fixture("kitchen-sink.md"), sourceType: "paste" });
    const [, q2] = questions(await review(id));
    expect(q2.commentAnchor?.exact).toBe("**Q2 — Auth model for v1:**");
    const res = await postComment(
      new Request(`http://localhost/api/documents/${id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ anchor: q2.commentAnchor, bodyMd: "Does Tailscale cover the phone?" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(201);
    const after = await review(id);
    expect(after.comments).toHaveLength(1);
    const exported = await (await exportRoute(new Request(`http://localhost/api/documents/${id}/export?format=annotated`), {
      params: Promise.resolve({ id }),
    })).text();
    expect(exported).toContain("Does Tailscale cover the phone?");
  });

  it("starts from the saved answer once one exists", async () => {
    const { id } = ingestDocument({ raw: fixture("kitchen-sink.md"), sourceType: "paste" });
    const [, q2] = questions(await review(id));
    const put = await putResponse(
      new Request(`http://localhost/api/items/${q2.itemId}/response`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: { selected: ["Per-device tokens"], other: "Revocable per phone." }, status: "answered" }),
      }),
      { params: Promise.resolve({ id: q2.itemId }) },
    );
    expect(put.status).toBe(200);
    const [, again] = questions(await review(id));
    expect(again.saved).toBe(true);
    expect(again.draft).toEqual({ text: "", selected: ["Per-device tokens"], other: "Revocable per phone.", status: "answered" });
    expect((await review(id)).document.status).toBe("in_review");
  });

  it("404s for an unknown document", async () => {
    const res = await reviewRoute(new Request("http://localhost/api/documents/nope/review"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});
