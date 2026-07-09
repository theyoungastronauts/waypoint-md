import { randomUUID } from "node:crypto";
import {
  getPublication,
  insertPublication,
  publicationExists,
  stampRevoked,
  type PublicationRow,
} from "../publications";
import { getR2Config } from "./config";
import { R2_PREFIX, r2FolderFor } from "./paths";
import {
  deletePublicationObjects,
  getObjectText,
  listShareObjects,
  putPublicationObjects,
} from "./r2";
import { toHtml, toPdf } from "./render";
import { addShareBar } from "./template";
import { extractTitle, sanitizeFilename } from "./text";

/**
 * The publish orchestration (§ publish spec), the server-side equivalent of the
 * Smitty `share` CLI's `main()`: render markdown → HTML + PDF, upload the three
 * objects to R2, and record the registry row. Also owns revoke (delete objects
 * + stamp) and backfill (index existing objects). Callers gate on
 * {@link publishEnabled} before invoking any of these.
 */

export interface PublishInput {
  markdown: string;
  /** Original filename, if any — drives the sanitized object name. */
  filename?: string | null;
  /** Explicit title; falls back to the first `#` heading, then the name. */
  title?: string | null;
  origin: "cli" | "api";
  /** Publishing host, recorded for `cli` origins; null otherwise. */
  sourceHost?: string | null;
}

/** Fallback slug when a name sanitizes to nothing (e.g. an all-emoji title). */
const FALLBACK_NAME = "document";

/**
 * Render, upload, and index a new publication. Returns the persisted row (the
 * route maps it to `{ id, title, urls }`). The uuid is both the primary key and
 * the R2 folder name, so the registry id and object prefix never diverge.
 */
export async function publish(input: PublishInput): Promise<PublicationRow> {
  const config = getR2Config();
  if (!config) throw new Error("Publishing is not configured.");

  const nameSource = input.filename ?? input.title ?? FALLBACK_NAME;
  const sanitizedName = sanitizeFilename(nameSource) || FALLBACK_NAME;
  const title = input.title?.trim() || extractTitle(input.markdown, nameSource);

  const id = randomUUID();
  const r2Folder = r2FolderFor(id);
  const publicBase = config.publicDomain;

  // Clean HTML (no bar) is what the PDF is rendered from; the web HTML gets the
  // share bar added on top — exactly as `share` did.
  const cleanHtml = toHtml(input.markdown, title);
  const pdf = await toPdf(cleanHtml);
  const webHtml = addShareBar(cleanHtml, sanitizedName);

  await putPublicationObjects({ r2Folder, sanitizedName, markdown: input.markdown, html: webHtml, pdf });

  return insertPublication({
    id,
    title,
    sanitizedName,
    sourceMd: input.markdown,
    r2Folder,
    publicBase,
    origin: input.origin,
    sourceHost: input.sourceHost ?? null,
  });
}

/**
 * Revoke a publication: delete its three R2 objects and stamp `revoked_at`
 * (idempotent — re-revoking deletes nothing new and keeps the first timestamp).
 * Returns the row, or null when there is no such publication.
 */
export async function revoke(id: string): Promise<PublicationRow | null> {
  const row = getPublication(id);
  if (!row) return null;
  await deletePublicationObjects(row.r2Folder, row.sanitizedName);
  return stampRevoked(id);
}

export interface BackfillResult {
  indexed: number;
  skipped: number;
}

/** Parse a share object key into its folder uuid and filename. */
function parseShareKey(key: string): { uuid: string; filename: string } | null {
  const rest = key.slice(`${R2_PREFIX}/`.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const uuid = rest.slice(0, slash);
  const filename = rest.slice(slash + 1);
  if (!uuid || !filename) return null;
  return { uuid, filename };
}

/**
 * Index existing `smitty/shares/` objects into the registry (§ publish spec).
 * Groups objects by their uuid folder, reads each folder's `.md` for the source,
 * and inserts a row (origin `backfill`, `created_at` from the object's
 * LastModified) for any uuid not already present. Idempotent and read-only
 * against the bucket. Returns how many rows were indexed vs. skipped (present).
 */
export async function backfill(): Promise<BackfillResult> {
  const config = getR2Config();
  if (!config) throw new Error("Publishing is not configured.");
  const objects = await listShareObjects();

  // Collect the `.md` object per uuid folder — that is the source of the row.
  const mdByUuid = new Map<string, { key: string; filename: string; lastModified: Date | null }>();
  for (const obj of objects) {
    const parsed = parseShareKey(obj.key);
    if (!parsed || !parsed.filename.endsWith(".md")) continue;
    // First `.md` wins; a share folder only ever has one.
    if (!mdByUuid.has(parsed.uuid)) {
      mdByUuid.set(parsed.uuid, { key: obj.key, filename: parsed.filename, lastModified: obj.lastModified });
    }
  }

  let indexed = 0;
  let skipped = 0;
  for (const [uuid, md] of mdByUuid) {
    if (publicationExists(uuid)) {
      skipped += 1;
      continue;
    }
    const sourceMd = await getObjectText(md.key);
    const sanitizedName = md.filename.slice(0, -".md".length);
    const title = extractTitle(sourceMd, sanitizedName);

    insertPublication({
      id: uuid,
      title,
      sanitizedName,
      sourceMd,
      r2Folder: r2FolderFor(uuid),
      publicBase: config.publicDomain,
      origin: "backfill",
      createdAt: (md.lastModified ?? new Date()).toISOString(),
      sourceHost: null,
    });
    indexed += 1;
  }

  return { indexed, skipped };
}
