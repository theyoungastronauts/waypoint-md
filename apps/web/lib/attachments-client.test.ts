import { describe, expect, it } from "vitest";
import { attachmentUrl, extractImageFiles } from "./attachments-client";

/** A DataTransferItem-shaped stub — only the fields `extractImageFiles` reads. */
function transferItem(kind: string, type: string, file: File | null) {
  return { kind, type, getAsFile: () => file };
}

/** Cast an array of stubs to the DataTransferItemList shape the handler walks. */
function itemList(items: ReturnType<typeof transferItem>[]): DataTransferItemList {
  return items as unknown as DataTransferItemList;
}

describe("extractImageFiles (paste handler core)", () => {
  it("extracts an image blob from a paste", () => {
    const png = new File([Buffer.from("PNG")], "clip.png", { type: "image/png" });
    const files = extractImageFiles(itemList([transferItem("file", "image/png", png)]));
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("clip.png");
  });

  it("ignores a plain-text paste (falls through to normal text paste)", () => {
    const files = extractImageFiles(itemList([transferItem("string", "text/plain", null)]));
    expect(files).toEqual([]);
  });

  it("takes only the image items from a mixed clipboard", () => {
    const png = new File([Buffer.from("PNG")], "a.png", { type: "image/png" });
    const files = extractImageFiles(
      itemList([
        transferItem("string", "text/html", null),
        transferItem("file", "image/png", png),
        transferItem("file", "application/pdf", new File([Buffer.from("%PDF")], "x.pdf", { type: "application/pdf" })),
      ]),
    );
    expect(files.map((f) => f.name)).toEqual(["a.png"]);
  });

  it("skips a disallowed image type (e.g. SVG) the server would reject", () => {
    const svg = new File([Buffer.from("<svg/>")], "x.svg", { type: "image/svg+xml" });
    expect(extractImageFiles(itemList([transferItem("file", "image/svg+xml", svg)]))).toEqual([]);
  });

  it("handles a null clipboard", () => {
    expect(extractImageFiles(null)).toEqual([]);
  });

  it("builds the thumbnail URL for an id", () => {
    expect(attachmentUrl("abc 123")).toBe("/api/attachments/abc%20123");
  });
});
