import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractReviewState, parseDocument, type ResponseValue } from "@waypoint/spec";

import { setupTestDb } from "@/test/db";
import { GET as exportRoute } from "@/app/api/documents/[id]/export/route";
import { PUT as putResponse } from "@/app/api/items/[id]/response/route";
import { getDocumentDetail } from "@/lib/documents";
import { ingestDocument } from "@/lib/ingest/service";

const FIXTURES = path.resolve(process.cwd(), "packages/spec/fixtures");
const kitchenSink = readFileSync(path.join(FIXTURES, "kitchen-sink.md"), "utf8");

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

function exportGet(docId: string, format = "annotated") {
  return exportRoute(new Request(`http://localhost/api/documents/${docId}/export?format=${format}`), {
    params: Promise.resolve({ id: docId }),
  });
}

async function putResponseFor(itemId: string, value: ResponseValue, status: string | null) {
  const res = await putResponse(
    new Request(`http://localhost/api/items/${itemId}/response`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value, status }),
    }),
    { params: Promise.resolve({ id: itemId }) },
  );
  expect(res.status).toBe(200);
}

/** wp_id → DB item id for a document. */
function itemIdsByWpId(docId: string): Record<string, string> {
  const detail = getDocumentDetail(docId)!;
  return Object.fromEntries(detail.items.map((i) => [i.wpId ?? "", i.id]));
}

describe("GET /api/documents/:id/export?format=annotated", () => {
  it("exports an untouched document byte-identically to the source (§17.4)", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const res = await exportGet(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("content-disposition")).toContain(".review.md");
    expect(await res.text()).toBe(kitchenSink);
  });

  it("round-trips submitted responses through the annotated export (§17.4)", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const ids = itemIdsByWpId(id);

    const submitted: Record<string, ResponseValue> = {
      q1: { text: "Stay on the upgraded class through end of quarter.", status: "answered" },
      q2: { selected: ["Single shared token"], other: "prefer tailscale", status: "answered" },
      q3: { selected: ["staging", "production"], status: "answered" },
    };
    await putResponseFor(ids.q1, { text: submitted.q1.text }, "answered");
    await putResponseFor(ids.q2, { selected: submitted.q2.selected, other: submitted.q2.other }, "answered");
    await putResponseFor(ids.q3, { selected: submitted.q3.selected }, "answered");

    const exported = await (await exportGet(id)).text();
    const recovered = extractReviewState(parseDocument(exported));
    expect(recovered.responses).toEqual(submitted);
  });

  it("keeps the diff to answer interiors, checkbox states, and the frontmatter stamp", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const ids = itemIdsByWpId(id);
    await putResponseFor(ids.q3, { selected: ["staging", "production"] }, "answered");

    const exported = await (await exportGet(id)).text();
    // Closing prose is outside every wp block — it must be untouched.
    expect(exported).toContain("Closing prose that should never be touched by the writer.");
    // Only the flipped boxes changed in q3 (dev off, production on; staging stays).
    expect(exported).toContain("- [x] staging\n- [x] production\n- [ ] dev");
    // A non-empty review stamps the frontmatter.
    expect(exported).toContain("waypoint_status: completed");
    expect(exported).toMatch(/reviewed_at: /);
  });

  it("rejects an unknown export format", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const res = await exportGet(id, "digest");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("unsupported_format");
  });

  it("404s for an unknown document", async () => {
    const res = await exportGet("nope");
    expect(res.status).toBe(404);
  });
});

describe("clearing a pre-filled draft does not resurrect it on export (W1)", () => {
  it("empties the answer interior when a response row exists but is blank", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const ids = itemIdsByWpId(id);

    // q1 ships with a pre-filled draft. Clearing the field sends an empty value.
    await putResponseFor(ids.q1, {}, null);

    const exported = await (await exportGet(id)).text();
    expect(exported).not.toContain("Stay on the upgraded class through end of quarter");
    // The interior is now empty, not the draft.
    expect(exported).toContain("<!-- wp:answer -->\n<!-- /wp:answer -->");
  });

  it("leaves the draft untouched when the item was never answered", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    // No response submitted for q1 at all → byte-identical export.
    const exported = await (await exportGet(id)).text();
    expect(exported).toBe(kitchenSink);
  });
});

describe("getDocumentDetail response scoping", () => {
  it("does not attach one document's responses to another's items", async () => {
    const a = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const b = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const aItem = getDocumentDetail(a.id)!.items[0].id;
    await putResponseFor(aItem, { text: "answer for A only" }, "answered");

    expect(getDocumentDetail(b.id)!.items.every((i) => i.response === null)).toBe(true);
    expect(getDocumentDetail(a.id)!.items[0].response).not.toBeNull();
  });
});
