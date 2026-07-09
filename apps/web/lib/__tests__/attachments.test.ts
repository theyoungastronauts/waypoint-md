import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "@/test/db";
import {
  attachmentsByItem,
  createAttachment,
  deleteAttachment,
  exportName,
  getAttachmentMeta,
  readAttachment,
} from "@/lib/attachments";
import { getDocumentDetail } from "@/lib/documents";
import { ingestDocument } from "@/lib/ingest/service";

const DOC = `---
waypoint: 1
title: "Attachment host"
---

<!-- wp:question id="q1" type="text" -->
**Anything to attach?**
<!-- wp:answer -->
<!-- /wp:answer -->
<!-- /wp:question -->
`;

/** Path where an attachment's bytes live (mirrors the lib's private layout). */
function bytesPath(id: string): string {
  return path.join(process.env.WAYPOINT_DATA_DIR as string, "attachments", id);
}

let cleanup: () => void;
let itemId: string;

beforeAll(async () => {
  cleanup = await setupTestDb();
  const { id } = ingestDocument({ raw: DOC, sourceType: "paste" });
  itemId = getDocumentDetail(id)!.items[0].id;
});
afterAll(() => cleanup?.());

describe("attachments storage (B-3)", () => {
  it("writes bytes to the data dir (never the DB) and returns metadata", () => {
    const bytes = Buffer.from("PNGDATA");
    const meta = createAttachment(itemId, "shot.png", "image/png", bytes);
    expect(meta).not.toBeNull();
    expect(meta!.itemId).toBe(itemId);
    expect(meta!.filename).toBe("shot.png");
    expect(meta!.mime).toBe("image/png");
    expect(meta!.bytesLen).toBe(bytes.length);
    expect(meta!.exportName).toBe(exportName(meta!.id, "shot.png"));

    // Bytes live on disk under WAYPOINT_DATA_DIR/attachments/<id>.
    expect(existsSync(bytesPath(meta!.id))).toBe(true);
    expect(readFileSync(bytesPath(meta!.id))).toEqual(bytes);
  });

  it("returns null for an unknown item id (route 404s)", () => {
    expect(createAttachment("no-such-item", "x.png", "image/png", Buffer.from("x"))).toBeNull();
  });

  it("reads metadata + bytes back for the thumbnail stream", () => {
    const bytes = Buffer.from("GIF89a-data");
    const meta = createAttachment(itemId, "anim.gif", "image/gif", bytes)!;
    const found = readAttachment(meta.id);
    expect(found).not.toBeNull();
    expect(found!.meta.mime).toBe("image/gif");
    expect(found!.bytes).toEqual(bytes);
    expect(getAttachmentMeta(meta.id)!.filename).toBe("anim.gif");
  });

  it("delete removes BOTH the row and the on-disk bytes", () => {
    const meta = createAttachment(itemId, "gone.webp", "image/webp", Buffer.from("bits"))!;
    expect(existsSync(bytesPath(meta.id))).toBe(true);

    expect(deleteAttachment(meta.id)).toBe(true);
    expect(getAttachmentMeta(meta.id)).toBeNull();
    expect(existsSync(bytesPath(meta.id))).toBe(false);
    // Re-delete is idempotent (unknown id → false, no throw).
    expect(deleteAttachment(meta.id)).toBe(false);
  });

  it("groups attachments by item, oldest first", () => {
    const { id } = ingestDocument({ raw: DOC, sourceType: "paste" });
    const freshItem = getDocumentDetail(id)!.items[0].id;
    const a = createAttachment(freshItem, "one.png", "image/png", Buffer.from("1"))!;
    const b = createAttachment(freshItem, "two.png", "image/png", Buffer.from("22"))!;

    const grouped = attachmentsByItem([freshItem]);
    const list = grouped.get(freshItem)!;
    expect(list.map((m) => m.id)).toEqual([a.id, b.id]);
  });

  it("exportName is collision-free (id-prefixed) and filesystem-safe", () => {
    const messy = exportName("abcdef1234", "my shot (1).png");
    expect(messy).toBe("abcdef12-my-shot-1-.png");
    expect(messy).not.toContain("/");
    expect(messy).not.toContain(" ");
  });
});
