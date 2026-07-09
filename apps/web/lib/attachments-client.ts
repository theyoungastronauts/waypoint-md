/**
 * Browser-safe attachment helpers (§6, decision B-3). Deliberately free of any
 * Node/DB import so it is safe in the client bundle: the server (`lib/attachments`
 * + the API routes) owns the real trust boundary; this only extracts image blobs
 * from a paste, talks to the endpoints, and builds the thumbnail URL.
 */

/**
 * Image MIME types the paste handler will upload. The server is the source of
 * truth (`IMAGE_MIME_ALLOWLIST` in `lib/attachments`); this mirror lets the
 * client skip a paste that would only 400 (e.g. an SVG), keeping the UX honest.
 */
const CLIENT_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The metadata the client keeps for a rendered thumbnail chip. */
export interface AttachmentMeta {
  id: string;
  filename: string;
  mime: string;
}

/**
 * Extract the image files from a paste/drop `DataTransferItemList` (§6). Returns
 * every clipboard item that is a file with an allowlisted image MIME; non-image
 * items (plain text, HTML) are ignored so a normal text paste falls through
 * untouched. Pure and DOM-list-shaped so it is unit-testable without a real
 * paste event.
 */
export function extractImageFiles(items: DataTransferItemList | null | undefined): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "file") continue;
    if (!CLIENT_IMAGE_MIME.has(item.type)) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

/** The GET endpoint that streams an attachment's bytes (thumbnail `src`). */
export function attachmentUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}`;
}

/** Upload one image for an item's response; resolves to its stored metadata. */
export async function uploadAttachment(itemId: string, file: File): Promise<AttachmentMeta> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/attachments`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`attachment upload failed (HTTP ${res.status})`);
  const body = (await res.json()) as { attachment: AttachmentMeta };
  return { id: body.attachment.id, filename: body.attachment.filename, mime: body.attachment.mime };
}

/** Delete an attachment (row + bytes). Throws on a non-2xx. */
export async function deleteAttachmentRequest(id: string): Promise<void> {
  const res = await fetch(attachmentUrl(id), { method: "DELETE" });
  if (!res.ok) throw new Error(`attachment delete failed (HTTP ${res.status})`);
}
