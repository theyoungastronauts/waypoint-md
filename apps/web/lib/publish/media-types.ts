/**
 * The media upload allowlist (decision B-2). Deliberately small and explicit:
 * a presigned PUT hands the caller a signed write into the bucket, so the server
 * decides up front exactly what may be written and under which extension.
 *
 * Kept in its own module so the zod route schema, the object-key helpers, and
 * the registry views can all share one source of truth without pulling in the
 * S3 client. The map is content-type → **canonical** extension: the object key
 * and the public URL are both derived from the content type, never from the
 * caller's filename, so the two can never disagree (a `.jpeg` upload lands as
 * `.jpg`, exactly as `My Render.MP4` already lands as `my-render`).
 */

export const MEDIA_CONTENT_TYPES = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
} as const;

export type MediaContentType = keyof typeof MEDIA_CONTENT_TYPES;

/** The allowlist as a tuple, for `z.enum` and for error messages. */
export const MEDIA_CONTENT_TYPE_VALUES = Object.keys(MEDIA_CONTENT_TYPES) as [
  MediaContentType,
  ...MediaContentType[],
];

/** Smallest and largest upload accepted: one byte to 4 GiB (decision B-2). */
export const MIN_MEDIA_BYTES = 1;
export const MAX_MEDIA_BYTES = 4 * 1024 * 1024 * 1024;

/** How long a presigned upload URL stays valid (decision B-2). */
export const UPLOAD_URL_TTL_SECONDS = 900;

/** Whether a string is one of the allowed media content types. */
export function isMediaContentType(value: string): value is MediaContentType {
  return Object.prototype.hasOwnProperty.call(MEDIA_CONTENT_TYPES, value);
}

/**
 * The canonical object extension for a content type. Unknown types cannot reach
 * a stored row (the route validates against the allowlist before insert), so the
 * `bin` fallback exists only to keep this total for a hand-edited database row.
 */
export function mediaExtension(contentType: string | null): string {
  if (contentType !== null && isMediaContentType(contentType)) {
    return MEDIA_CONTENT_TYPES[contentType];
  }
  return "bin";
}

/** Broad category, for choosing a player on the detail page (decision B-4). */
export type MediaCategory = "video" | "image" | "pdf" | "file";

export function mediaCategory(contentType: string | null): MediaCategory {
  if (contentType === null) return "file";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  return "file";
}
