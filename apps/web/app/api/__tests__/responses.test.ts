import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "@/test/db";
import { PUT as putResponse } from "@/app/api/items/[id]/response/route";
import { getDocumentDetail } from "@/lib/documents";
import { ingestDocument } from "@/lib/ingest/service";

const kitchenSink = readFileSync(
  path.resolve(process.cwd(), "packages/spec/fixtures/kitchen-sink.md"),
  "utf8",
);

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

function putRequest(itemId: string, body: unknown) {
  return putResponse(
    new Request(`http://localhost/api/items/${itemId}/response`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: itemId }) },
  );
}

describe("PUT /api/items/:id/response", () => {
  it("creates then updates one response row (upsert)", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const itemId = getDocumentDetail(docId)!.items[0].id;

    const create = await putRequest(itemId, { value: { text: "First answer" }, status: "answered" });
    expect(create.status).toBe(200);
    expect(getDocumentDetail(docId)!.items[0].response).toMatchObject({
      value: { text: "First answer" },
      status: "answered",
    });

    const update = await putRequest(itemId, { value: { text: "Revised" }, status: "flagged" });
    expect(update.status).toBe(200);
    const after = getDocumentDetail(docId)!.items[0].response;
    expect(after).toMatchObject({ value: { text: "Revised" }, status: "flagged" });
    // Still exactly one row for the item (upsert, not insert).
    expect(getDocumentDetail(docId)!.items.filter((i) => i.id === itemId).length).toBe(1);
  });

  it("accepts a status-only clear (null)", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const itemId = getDocumentDetail(docId)!.items[0].id;
    const res = await putRequest(itemId, { value: {}, status: null });
    expect(res.status).toBe(200);
    expect(getDocumentDetail(docId)!.items[0].response?.status).toBeNull();
  });

  it("404s for an unknown item id", async () => {
    const res = await putRequest("no-such-item", { value: { text: "x" } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("rejects an invalid status", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const itemId = getDocumentDetail(docId)!.items[0].id;
    const res = await putRequest(itemId, { value: {}, status: "bogus" });
    expect(res.status).toBe(400);
  });

  it("advances pending → in_review on the first real answer (W4)", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    expect(getDocumentDetail(docId)!.status).toBe("pending");

    const itemId = getDocumentDetail(docId)!.items[0].id;
    await putRequest(itemId, { value: { text: "an answer" }, status: "answered" });
    expect(getDocumentDetail(docId)!.status).toBe("in_review");
  });

  it("does not advance on an empty (cleared) save", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const itemId = getDocumentDetail(docId)!.items[0].id;
    await putRequest(itemId, { value: {}, status: null });
    expect(getDocumentDetail(docId)!.status).toBe("pending");
  });

  it("does not regress a completed document back to in_review", async () => {
    const { id: docId } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    // Simulate a later edit on a completed doc: status must stay completed.
    const { updateDocument } = await import("@/lib/documents");
    updateDocument(docId, { status: "completed" });
    const itemId = getDocumentDetail(docId)!.items[0].id;
    await putRequest(itemId, { value: { text: "late edit" }, status: "answered" });
    expect(getDocumentDetail(docId)!.status).toBe("completed");
  });
});
