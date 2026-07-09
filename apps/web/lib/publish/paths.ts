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
