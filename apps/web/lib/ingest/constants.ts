/** 1 MB cap on ingested bytes — the URL door hard limit (§15), reused by the
 *  path/upload doors as a sanity bound so no single import can exhaust memory. */
export const MAX_DOC_BYTES = 1024 * 1024;

/** File extensions accepted by the upload and path doors (§7). */
export const ALLOWED_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

/** True when `name` ends in an accepted markdown/text extension (case-insensitive). */
export function hasAllowedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
