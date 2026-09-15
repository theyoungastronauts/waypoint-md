/**
 * The R2 object layout, shared by the uploader (where bytes are written) and the
 * registry views (where public URLs are derived). One place owns the mapping so
 * a key and its URL can never drift. The prefix is `smitty/shares` — kept, not
 * renamed (spec Q1): existing objects are immutable history, and a second
 * namespace would be a real cost for a cosmetic name.
 */

export const R2_PREFIX = "smitty/shares";

/** The three published file extensions, in the order `share` printed them. */
export const PUBLICATION_EXTS = ["html", "pdf", "md"] as const;
export type PublicationExt = (typeof PUBLICATION_EXTS)[number];

export interface PublicationUrls {
  html: string;
  pdf: string;
  md: string;
}

/** The R2 folder for a publication id: `smitty/shares/<uuid>`. */
export function r2FolderFor(uuid: string): string {
  return `${R2_PREFIX}/${uuid}`;
}

/** The object key for one file: `<r2Folder>/<sanitizedName>.<ext>`. */
export function objectKey(r2Folder: string, sanitizedName: string, ext: PublicationExt): string {
  return `${r2Folder}/${sanitizedName}.${ext}`;
}

/** The public URLs for all three files, from folder + name + public domain. */
export function publicationUrls(
  publicBase: string,
  r2Folder: string,
  sanitizedName: string,
): PublicationUrls {
  const url = (ext: PublicationExt) => `https://${publicBase}/${objectKey(r2Folder, sanitizedName, ext)}`;
  return { html: url("html"), pdf: url("pdf"), md: url("md") };
}

/**
 * A media publication lands two objects in the same folder layout: the file
 * itself and, when the publisher supplied one, the render manifest beside it —
 * so a share folder stays self-describing (spec §Phase B, "Object layout").
 * The extension is the canonical one for the content type, not whatever the
 * source file happened to be called, so a key and its public URL are both a pure
 * function of the row and can never drift.
 */
export function mediaObjectKey(r2Folder: string, sanitizedName: string, ext: string): string {
  return `${r2Folder}/${sanitizedName}.${ext}`;
}

/** The manifest object key: `<r2Folder>/<sanitizedName>.manifest.json`. */
export function manifestObjectKey(r2Folder: string, sanitizedName: string): string {
  return `${r2Folder}/${sanitizedName}.manifest.json`;
}

export interface MediaUrls {
  file: string;
  /** Null when the publication carries no render manifest. */
  manifest: string | null;
}

/** The public URLs for a media publication's file and (optional) manifest. */
export function mediaUrls(
  publicBase: string,
  r2Folder: string,
  sanitizedName: string,
  ext: string,
  hasManifest: boolean,
): MediaUrls {
  return {
    file: `https://${publicBase}/${mediaObjectKey(r2Folder, sanitizedName, ext)}`,
    manifest: hasManifest
      ? `https://${publicBase}/${manifestObjectKey(r2Folder, sanitizedName)}`
      : null,
  };
}

/** The tailnet detail page for a publication — relative, as `/d/:id` is (§8). */
export function publicationPagePath(id: string): string {
  return `/publications/${id}`;
}
