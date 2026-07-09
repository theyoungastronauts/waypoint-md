import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "@/test/db";
import { POST as uploadRoute } from "@/app/api/items/[id]/attachments/route";
import { DELETE as deleteRoute, GET as streamRoute } from "@/app/api/attachments/[id]/route";
import { getDocumentDetail } from "@/lib/documents";
import { ingestDocument } from "@/lib/ingest/service";

const DOC = `---
waypoint: 1
title: "Upload host"
---

<!-- wp:question id="q1" type="text" -->
**Attach something?**
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
`;

function bytesPath(id: string): string {
  return path.join(process.env.WAYPOINT_DATA_DIR as string, "attachments", id);
}

function uploadRequest(file: File): Request {
  const form = new FormData();
  form.set("file", file);
  return new Request("http://localhost/api/items/x/attachments", { method: "POST", body: form });
}

function pngFile(bytes: Buffer, name = "shot.png"): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

let cleanup: () => void;
let docId: string;
let itemId: string;

beforeAll(async () => {
  cleanup = await setupTestDb();
  const ingested = ingestDocument({ raw: DOC, sourceType: "paste" });
  docId = ingested.id;
  itemId = getDocumentDetail(docId)!.items[0].id;
});
afterAll(() => cleanup?.());

describe("POST /api/items/:id/attachments", () => {
  it("accepts an image and returns its metadata (happy path)", async () => {
    const res = await uploadRoute(uploadRequest(pngFile(Buffer.from("PNGDATA"))), {
      params: Promise.resolve({ id: itemId }),
    });
    expect(res.status).toBe(201);
    const { attachment } = await res.json();
    expect(attachment.id).toBeTruthy();
    expect(attachment.mime).toBe("image/png");
    expect(attachment.filename).toBe("shot.png");
    expect(attachment.exportName).toContain("shot.png");

    // Surfaced through the document detail for the review view + export.
    const item = getDocumentDetail(docId)!.items.find((i) => i.id === itemId)!;
    expect(item.attachments.some((a) => a.id === attachment.id)).toBe(true);
  });

  it("rejects a non-image MIME server-side (400)", async () => {
    const notImage = new File([Buffer.from("hello")], "note.txt", { type: "text/plain" });
    const res = await uploadRoute(uploadRequest(notImage), { params: Promise.resolve({ id: itemId }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("unsupported_media_type");
  });

  it("rejects an image over the 10 MB cap (413)", async () => {
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const res = await uploadRoute(uploadRequest(pngFile(huge, "big.png")), {
      params: Promise.resolve({ id: itemId }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("attachment_too_large");
  });

  it("404s when the item does not exist", async () => {
    const res = await uploadRoute(uploadRequest(pngFile(Buffer.from("x"))), {
      params: Promise.resolve({ id: "no-such-item" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a non-multipart body (400)", async () => {
    const res = await uploadRoute(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: itemId }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects an empty file (400)", async () => {
    const res = await uploadRoute(uploadRequest(pngFile(Buffer.alloc(0))), {
      params: Promise.resolve({ id: itemId }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("empty_file");
  });
});

describe("GET/DELETE /api/attachments/:id", () => {
  it("streams the bytes with the stored content-type (thumbnail)", async () => {
    const bytes = Buffer.from("GIF89a-thumb");
    const gif = new File([bytes], "a.gif", { type: "image/gif" });
    const up = await uploadRoute(uploadRequest(gif), { params: Promise.resolve({ id: itemId }) });
    const { attachment } = await up.json();

    const res = await streamRoute(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: attachment.id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it("streams 404 for an unknown id", async () => {
    const res = await streamRoute(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE removes the row AND the bytes", async () => {
    const up = await uploadRoute(uploadRequest(pngFile(Buffer.from("bits"), "del.png")), {
      params: Promise.resolve({ id: itemId }),
    });
    const { attachment } = await up.json();
    expect(existsSync(bytesPath(attachment.id))).toBe(true);

    const del = await deleteRoute(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: attachment.id }),
    });
    expect(del.status).toBe(200);
    expect(existsSync(bytesPath(attachment.id))).toBe(false);

    // The stream now 404s, and the document detail no longer lists it.
    const after = await streamRoute(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: attachment.id }),
    });
    expect(after.status).toBe(404);
    expect(
      getDocumentDetail(docId)!.items.find((i) => i.id === itemId)!.attachments.some(
        (a) => a.id === attachment.id,
      ),
    ).toBe(false);

    const del404 = await deleteRoute(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id: attachment.id }),
    });
    expect(del404.status).toBe(404);
  });
});
