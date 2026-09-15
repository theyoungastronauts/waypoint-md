/** Human labels for a publication's recorded origin (§ publish spec: cli/api/backfill). */
const ORIGIN_LABELS: Record<string, string> = {
  cli: "CLI",
  api: "API",
  backfill: "Backfill",
};

export function originLabel(origin: string): string {
  return ORIGIN_LABELS[origin] ?? origin;
}

/**
 * The kind badge (decision B-4). A media publication says what it actually is —
 * Video, Image, PDF — rather than the generic "Media", because the distinction
 * is what tells a reader whether a row is a render or a still at a glance.
 */
export function kindLabel(kind: string, contentType: string | null): string {
  if (kind !== "media") return "Markdown";
  if (contentType === null) return "Media";
  if (contentType.startsWith("video/")) return "Video";
  if (contentType.startsWith("image/")) return "Image";
  if (contentType === "application/pdf") return "PDF";
  return "Media";
}

/** A byte count for display: "248.3 MB". Exact for bytes, one decimal above. */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
