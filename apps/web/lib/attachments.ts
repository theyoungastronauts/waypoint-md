import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { getDb, resolveDataDir } from "./db/client";
import { attachments, items } from "./db/schema";

/**
 * Image attachment storage (§6, decision B-3). Metadata rows live in the
 * `attachments` table; the raw bytes live on disk under
 * `WAYPOINT_DATA_DIR/attachments/<id>` — never in the DB, mirroring how the
 * document raw uploads are handled. The API layer enforces the trust boundary
 * (image MIME allowlist + 10 MB cap); this module just persists validated bytes
 * and hands them back for the thumbnail stream and the export materialization.
 */

/** Accepted image MIME types (decision B-3). Everything else is rejected. */
export const IMAGE_MIME_ALLOWLIST = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Hard cap on an attachment's size in bytes (10 MB, decision B-3). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function isAllowedImageMime(mime: string): boolean {
  return IMAGE_MIME_ALLOWLIST.has(mime);
}

/** Attachment metadata (the persisted row plus its deterministic export name). */
export interface AttachmentMeta {
  id: string;
  itemId: string;
  filename: string;
  mime: string;
  bytesLen: number;
  createdAt: string;
  /**
   * The collision-free filename this attachment materializes as inside the
   * sibling `<name>.attachments/` folder on export/pull (decision B-4). Derived
   * from the id + a sanitized original filename, so the export reference line and
   * the CLI's on-disk write always agree.
   */
  exportName: string;
}

/** The bytes directory, created on first use (mirrors {@link resolveDataDir}). */
export function attachmentsDir(): string {
  const dir = path.join(resolveDataDir(), "attachments");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function bytesPath(id: string): string {
  return path.join(attachmentsDir(), id);
}

/**
 * A filesystem-safe rendering of an original filename: directory separators and
 * anything outside `[A-Za-z0-9._-]` collapse to `-`, so a clipboard image named
 * `image (1).png` or a path-y name can never escape the attachments folder.
 */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "image";
}

/** The materialized filename for an attachment inside `<name>.attachments/`. */
export function exportName(id: string, filename: string): string {
  return `${id.slice(0, 8)}-${sanitizeFilename(filename)}`;
}

function toMeta(row: typeof attachments.$inferSelect): AttachmentMeta {
  return {
    id: row.id,
    itemId: row.itemId,
    filename: row.filename,
    mime: row.mime,
    bytesLen: row.bytesLen,
    createdAt: row.createdAt,
    exportName: exportName(row.id, row.filename),
  };
}

/**
 * Persist a validated image: write the bytes to disk, then insert the metadata
 * row. Returns null when the target item does not exist so the route can 404.
 * The bytes are written before the row so a crash between the two leaves an
 * orphan file (harmless, no dangling row) rather than a row pointing at nothing.
 */
export function createAttachment(
  itemId: string,
  filename: string,
  mime: string,
  bytes: Buffer,
): AttachmentMeta | null {
  const db = getDb();
  const item = db.select({ id: items.id }).from(items).where(eq(items.id, itemId)).get();
  if (!item) return null;

  const id = randomUUID();
  fs.writeFileSync(bytesPath(id), bytes);
  const createdAt = new Date().toISOString();
  db
    .insert(attachments)
    .values({ id, itemId, filename, mime, bytesLen: bytes.length, createdAt })
    .run();

  return { id, itemId, filename, mime, bytesLen: bytes.length, createdAt, exportName: exportName(id, filename) };
}

/** Metadata for one attachment, or null when the id is unknown. */
export function getAttachmentMeta(id: string): AttachmentMeta | null {
  const db = getDb();
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  return row ? toMeta(row) : null;
}

/** Metadata + bytes for the thumbnail stream, or null when the id is unknown. */
export function readAttachment(id: string): { meta: AttachmentMeta; bytes: Buffer } | null {
  const meta = getAttachmentMeta(id);
  if (!meta) return null;
  const file = bytesPath(id);
  if (!fs.existsSync(file)) return null;
  return { meta, bytes: fs.readFileSync(file) };
}

/**
 * Delete an attachment's row and its bytes. Returns false when the id is
 * unknown. The row is removed first (the source of truth for "does it exist"),
 * then the bytes; a missing byte file is ignored so a re-delete is idempotent.
 */
export function deleteAttachment(id: string): boolean {
  const db = getDb();
  const existing = db.select({ id: attachments.id }).from(attachments).where(eq(attachments.id, id)).get();
  if (!existing) return false;
  db.delete(attachments).where(eq(attachments.id, id)).run();
  const file = bytesPath(id);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  return true;
}

/**
 * All attachments for a set of item ids, grouped by item id and ordered oldest
 * first. Used by {@link getDocumentDetail} to fold attachments into item
 * payloads without loading the whole table. Empty input short-circuits.
 */
export function attachmentsByItem(itemIds: string[]): Map<string, AttachmentMeta[]> {
  const byItem = new Map<string, AttachmentMeta[]>();
  if (itemIds.length === 0) return byItem;
  const db = getDb();
  const rows = db
    .select()
    .from(attachments)
    .where(inArray(attachments.itemId, itemIds))
    .orderBy(attachments.createdAt)
    .all();
  for (const row of rows) {
    const meta = toMeta(row);
    const list = byItem.get(meta.itemId) ?? [];
    list.push(meta);
    byItem.set(meta.itemId, list);
  }
  return byItem;
}
