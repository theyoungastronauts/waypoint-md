import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The brief is mocked (no Claude); everything else is the real database path.
vi.mock("@/lib/voice/make-brief", () => ({
  getOrCreateBrief: vi.fn(async () => ({ brief: { version: 2, title: "t", intro: "", questions: [], background: [] }, model: "m", cached: true })),
}));

import { setupTestDb } from "@/test/db";
import { getDocumentDetail, updateDocument } from "@/lib/documents";
import { ingestDocument } from "@/lib/ingest/service";
import { upsertResponse } from "@/lib/responses";
import { openPhoneReview } from "@/lib/voice/phone/runtime";
import { listVoiceSessions } from "@/lib/voice/sessions";

const kitchenSink = readFileSync(path.resolve(process.cwd(), "packages/spec/fixtures/kitchen-sink.md"), "utf8");

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

describe("openPhoneReview (server-side interview store)", () => {
  it("starts from the same drafts the review page shows, and opens a call record", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const [q1, q2] = getDocumentDetail(id)!.items;
    upsertResponse(q2.id, { selected: ["Per-device tokens"] }, "answered");

    const review = await openPhoneReview(id);
    // q1 carries an embedded answer with status="answered" in the source.
    expect(review.store.getDraft(q1.id)).toMatchObject({ text: expect.stringContaining("Stay on the upgraded class") });
    expect(review.store.getDraft(q2.id)).toMatchObject({ selected: ["Per-device tokens"], status: "answered" });
    expect(review.answeredBefore).toEqual(expect.arrayContaining([q1.id, q2.id]));
    expect(listVoiceSessions(id)).toHaveLength(1);
  });

  it("writes answers through the autosave path and submits the review", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const items = getDocumentDetail(id)!.items;
    const choice = items.find((i) => i.type === "choice")!;

    const review = await openPhoneReview(id);
    review.store.writeDraft(choice.id, { text: "", selected: ["Single shared token"], other: "", status: "flagged" });
    const saved = getDocumentDetail(id)!.items.find((i) => i.id === choice.id)!.response;
    expect(saved).toMatchObject({ value: { selected: ["Single shared token"] }, status: "flagged" });
    expect(getDocumentDetail(id)!.status).toBe("in_review");

    await review.store.submit();
    expect(getDocumentDetail(id)!.status).toBe("completed");
  });

  it("refuses to write to an item that isn't on the review", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const review = await openPhoneReview(id);
    expect(() => review.store.writeDraft("other-item", { text: "x", selected: [], other: "", status: "answered" })).toThrow();
  });

  it("records the transcript and closes the record", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const review = await openPhoneReview(id);
    review.store.setStyle("thorough");
    review.record([{ role: "reviewer", at: "t", text: "4821" }]);
    review.close("ended");
    const [session] = listVoiceSessions(id);
    expect(session).toMatchObject({ mode: "thorough", status: "ended", transcript: [{ role: "reviewer", text: "4821" }] });
  });

  it("refuses a review that was finished after the caller picked it", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    updateDocument(id, { status: "completed" });
    await expect(openPhoneReview(id)).rejects.toThrow(/not open for review/);
    expect(listVoiceSessions(id)).toHaveLength(0);
  });
});
