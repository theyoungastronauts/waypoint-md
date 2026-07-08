import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Anthropic SDK regardless of key presence (§14 test requirement). The
// structuring pass is a single JSON-out `messages.create`; the fake returns
// whatever text a test scripts, so anchor validation runs on real model-shaped
// output without a network call.
const mock = vi.hoisted(() => ({
  text: "" as string,
  lastParams: null as unknown as { model: string; system: string; messages: unknown[] },
}));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async (params: { model: string; system: string; messages: unknown[] }) => {
        mock.lastParams = params;
        return { content: [{ type: "text", text: mock.text }] };
      },
    };
  }
  return { default: FakeAnthropic };
});

import { setupTestDb } from "@/test/db";
import { POST as postStructure } from "@/app/api/documents/[id]/structure/route";
import { GET as exportGet } from "@/app/api/documents/[id]/export/route";
import { PUT as putResponse } from "@/app/api/items/[id]/response/route";
import { getDocumentDetail } from "@/lib/documents";
import { ingestDocument } from "@/lib/ingest/service";

const FIXTURES = path.resolve(process.cwd(), "packages/spec/fixtures");
const noConvention = readFileSync(path.join(FIXTURES, "no-convention.md"), "utf8");
const kitchenSink = readFileSync(path.join(FIXTURES, "kitchen-sink.md"), "utf8");

let cleanup: () => void;
beforeAll(async () => {
  cleanup = await setupTestDb();
});
afterAll(() => cleanup?.());

const KEY = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-test-key";
  mock.text = "";
});
afterEach(() => {
  if (KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = KEY;
});

/** Script the model's JSON response for the next structure call. */
function proposals(items: unknown[]): void {
  mock.text = JSON.stringify({ items });
}

function structure(docId: string) {
  return postStructure(new Request(`http://localhost/api/documents/${docId}/structure`, { method: "POST" }), {
    params: Promise.resolve({ id: docId }),
  });
}

function exportAnnotated(docId: string) {
  return exportGet(new Request(`http://localhost/api/documents/${docId}/export?format=annotated`), {
    params: Promise.resolve({ id: docId }),
  });
}

async function answer(itemId: string, value: unknown, status: string | null) {
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

describe("POST /api/documents/:id/structure", () => {
  it("accepts anchored proposals and persists them as synthetic items", async () => {
    const { id } = ingestDocument({ raw: noConvention, sourceType: "paste" });
    proposals([
      { type: "text", prompt: "What does the list cover?", anchor: "a list item" },
      {
        type: "choice",
        prompt: "Which item matters most?",
        anchor: "another one",
        select: "single",
        options: ["The first", "The second"],
      },
    ]);

    const res = await structure(id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(2);
    expect(body.skipped).toEqual([]);

    // The pass ran against the resolved model with the source in the user turn.
    expect(mock.lastParams.model).toBe("claude-sonnet-5");

    const items = getDocumentDetail(id)!.items;
    expect(items).toHaveLength(2);
    expect(items.every((it) => it.synthetic)).toBe(true);
    expect(items.every((it) => it.wpId === null)).toBe(true);
    // Ordered by anchor offset: "a list item" precedes "another one" in the source.
    expect(items[0].anchor).toEqual({ exact: "a list item", start: noConvention.indexOf("a list item") });
    const choice = items.find((it) => it.type === "choice")!;
    expect(choice.config?.options?.map((o) => o.label)).toEqual(["The first", "The second"]);
    expect(choice.config?.options?.every((o) => o.checked === false)).toBe(true);
  });

  it("rejects a fabricated anchor server-side and does not store it", async () => {
    const { id } = ingestDocument({ raw: noConvention, sourceType: "paste" });
    proposals([
      { type: "text", prompt: "Real", anchor: "a list item" },
      { type: "text", prompt: "Fabricated", anchor: "this text is nowhere in the source document" },
    ]);

    const res = await structure(id);
    const body = await res.json();
    expect(body.accepted).toBe(1);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0]).toMatchObject({ prompt: "Fabricated" });

    const items = getDocumentDetail(id)!.items;
    expect(items).toHaveLength(1);
    expect(items[0].promptMd).toBe("Real");
  });

  it("refuses to structure a conventioned document (§5.7)", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const res = await structure(id);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("already_conventioned");
  });

  it("refuses to structure a document twice", async () => {
    const { id } = ingestDocument({ raw: noConvention, sourceType: "paste" });
    proposals([{ type: "text", prompt: "First pass", anchor: "a list item" }]);
    expect((await structure(id)).status).toBe(200);

    const res = await structure(id);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("already_structured");
  });

  it("degrades cleanly with no API key — 400 and nothing stored", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { id } = ingestDocument({ raw: noConvention, sourceType: "paste" });
    proposals([{ type: "text", prompt: "Should not run", anchor: "a list item" }]);

    const res = await structure(id);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("ai_unavailable");
    expect(getDocumentDetail(id)!.items).toHaveLength(0);
  });

  it("returns 502 when the model output is not usable JSON", async () => {
    const { id } = ingestDocument({ raw: noConvention, sourceType: "paste" });
    mock.text = "I could not structure this document.";
    const res = await structure(id);
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("ai_bad_output");
    expect(getDocumentDetail(id)!.items).toHaveLength(0);
  });

  it("404s for an unknown document", async () => {
    const res = await structure("no-such-doc");
    expect(res.status).toBe(404);
  });
});

describe("adoptive-import export — appended section, byte-faithful body", () => {
  it("appends nothing (byte-identical) when synthetic items are unanswered", async () => {
    const { id } = ingestDocument({ raw: noConvention, sourceType: "paste" });
    proposals([{ type: "text", prompt: "Unanswered", anchor: "a list item" }]);
    await structure(id);

    const exported = await (await exportAnnotated(id)).text();
    expect(exported).toBe(noConvention);
    expect(exported).not.toContain("## Waypoint responses");
  });

  it("appends the '## Waypoint responses' section once a synthetic item is answered", async () => {
    const { id } = ingestDocument({ raw: noConvention, sourceType: "paste" });
    proposals([{ type: "text", prompt: "What does the list cover?", anchor: "a list item" }]);
    await structure(id);

    const syntheticId = getDocumentDetail(id)!.items[0].id;
    await answer(syntheticId, { text: "It enumerates the two example points." }, "answered");

    const exported = await (await exportAnnotated(id)).text();
    // The document body above the appended section is byte-identical to the source
    // (synthetic items never enter the splice writer).
    expect(exported.startsWith(noConvention)).toBe(true);
    expect(exported).toContain("## Waypoint responses");
    expect(exported).toContain("> a list item");
    expect(exported).toContain("It enumerates the two example points.");
  });

  it("keeps a conventioned document's export path unaffected by this phase", async () => {
    const { id } = ingestDocument({ raw: kitchenSink, sourceType: "paste" });
    const exported = await (await exportAnnotated(id)).text();
    expect(exported).toBe(kitchenSink);
  });
});
