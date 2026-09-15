import { randomUUID } from "node:crypto";
import {
  deletePublication,
  getPublication,
  insertPublication,
  listStaleUnfinalizedMedia,
  stampFinalized,
  type PublicationRow,
} from "../publications";
import { getR2Config } from "./config";
import { mediaExtension, type MediaContentType } from "./media-types";
import { manifestObjectKey, mediaObjectKey, r2FolderFor } from "./paths";
import { deleteObjects, headObject, presignPut, putJson, type PresignedUpload } from "./r2";
import { mediaStem, sanitizeMediaName } from "./text";

/**
 * Media publications (§ media spec Phase B, decisions B-1 … B-3). The contract
 * that shapes this module: **the server never touches the bytes.** A create
 * reserves the object key, writes the registry row unfinalized, and hands back a
 * presigned PUT; the publisher uploads straight to R2; a finalize HEADs the
 * object and opens the row to the registry. So there are two half-states to own
 * — an upload that never started, and one that never finished — and both are
 * swept by the lazy garbage collector at the head of the next create.
 */

/** Fallback slug when a filename sanitizes to nothing (e.g. an all-emoji name). */
const FALLBACK_NAME = "media";

/** How long an unfinalized row is kept before the next create sweeps it (B-2). */
export const UNFINALIZED_TTL_MS = 60 * 60 * 1000;

export interface CreateMediaInput {
  filename: string;
  contentType: MediaContentType;
  /** Size the publisher intends to upload; signed into the presigned PUT. */
  bytes: number;
  title?: string | null;
  group?: string | null;
  label?: string | null;
  /** The render manifest, uploaded beside the file and stored on the row. */
  manifest?: unknown;
  origin: "cli" | "api";
  sourceHost?: string | null;
}

export interface CreateMediaResult {
  id: string;
  /** The R2 object key the presigned URL writes to. */
  key: string;
  uploadUrl: string;
  expiresAt: string;
}

/**
 * Terms a media row is findable by, since it has no source markdown to index:
 * its group and label, plus the manifest fields an author would actually search
 * a render by (B-1). Everything is lowercased and de-duplicated so the FTS index
 * holds one clean bag of words.
 */
const MANIFEST_SEARCH_KEYS = ["composition", "profile", "format"] as const;

export function searchTextFor(
  manifest: unknown,
  group: string | null,
  label: string | null,
): string {
  const terms: string[] = [];
  if (group) terms.push(group);
  if (label) terms.push(label);

  if (typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)) {
    const record = manifest as Record<string, unknown>;
    for (const key of MANIFEST_SEARCH_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) terms.push(value.trim());
      else if (typeof value === "number") terms.push(String(value));
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const term of terms) {
    const lower = term.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    unique.push(lower);
  }
  return unique.join(" ");
}

/** A `title` field inside the render manifest, when the manifest carries one. */
function manifestTitle(manifest: unknown): string | null {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return null;
  const value = (manifest as Record<string, unknown>).title;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Both object keys a media row owns (the manifest key whether or not it exists). */
export function mediaKeysFor(row: PublicationRow): { file: string; manifest: string } {
  return {
    file: mediaObjectKey(row.r2Folder, row.sanitizedName, mediaExtension(row.contentType)),
    manifest: manifestObjectKey(row.r2Folder, row.sanitizedName),
  };
}

/**
 * Sweep abandoned uploads: media rows created more than an hour ago that were
 * never finalized. Their presigned URL expired 45 minutes earlier, so nothing
 * can still be writing to the key. Objects go first, then the row — a failed
 * delete leaves a row pointing at the bytes rather than orphaning them.
 * Returns how many rows were collected.
 */
export async function collectAbandonedUploads(now = Date.now()): Promise<number> {
  const stale = listStaleUnfinalizedMedia(new Date(now - UNFINALIZED_TTL_MS).toISOString());
  for (const row of stale) {
    const keys = mediaKeysFor(row);
    await deleteObjects([keys.file, keys.manifest]);
    deletePublication(row.id);
  }
  return stale.length;
}

/**
 * Reserve a media publication and mint its upload URL. The row exists before the
 * bytes do (so the key is taken and the id is stable for the finalize call) but
 * stays out of the registry until {@link finalizeMediaPublication} confirms the
 * object. The manifest, being small and already in hand, is uploaded now.
 */
export async function createMediaPublication(input: CreateMediaInput): Promise<CreateMediaResult> {
  const config = getR2Config();
  if (!config) throw new Error("Publishing is not configured.");

  await collectAbandonedUploads();

  const sanitizedName = sanitizeMediaName(input.filename) || FALLBACK_NAME;
  const manifest = input.manifest ?? null;
  const title =
    input.title?.trim() || manifestTitle(manifest) || mediaStem(input.filename) || FALLBACK_NAME;
  const group = input.group?.trim() || null;
  const label = input.label?.trim() || null;

  const id = randomUUID();
  const r2Folder = r2FolderFor(id);
  const key = mediaObjectKey(r2Folder, sanitizedName, mediaExtension(input.contentType));

  insertPublication({
    id,
    title,
    sanitizedName,
    // Media rows carry no markdown; the column stays NOT NULL so the FTS
    // triggers need no null handling (B-1).
    sourceMd: "",
    kind: "media",
    contentType: input.contentType,
    bytes: input.bytes,
    groupSlug: group,
    label,
    manifestJson: manifest,
    searchText: searchTextFor(manifest, group, label),
    r2Folder,
    publicBase: config.publicDomain,
    origin: input.origin,
    sourceHost: input.sourceHost ?? null,
  });

  if (manifest !== null) {
    await putJson(manifestObjectKey(r2Folder, sanitizedName), manifest);
  }

  const presigned: PresignedUpload = await presignPut({
    key,
    contentType: input.contentType,
    contentLength: input.bytes,
  });

  return { id, key, uploadUrl: presigned.url, expiresAt: presigned.expiresAt };
}

/** Why a finalize could not complete; the route maps each to a status. */
export type FinalizeFailure = "not_found" | "not_media" | "upload_missing";

export type FinalizeResult =
  | { ok: true; row: PublicationRow }
  | { ok: false; reason: FinalizeFailure };

/**
 * Confirm an upload landed and open the row to the registry. The HEAD is the
 * whole point: without it a row could advertise a key that holds nothing, since
 * the server never saw the bytes. The recorded size comes from the HEAD rather
 * than from what the publisher claimed at create time.
 */
export async function finalizeMediaPublication(id: string): Promise<FinalizeResult> {
  const row = getPublication(id);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.kind !== "media") return { ok: false, reason: "not_media" };

  const head = await headObject(mediaKeysFor(row).file);
  if (!head) return { ok: false, reason: "upload_missing" };

  const finalized = stampFinalized(id, head.contentLength);
  if (!finalized) return { ok: false, reason: "not_found" };
  return { ok: true, row: finalized };
}
