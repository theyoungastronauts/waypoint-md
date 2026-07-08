/** Small presentation helpers shared by the queue and document views. */

/** Human-friendly relative time ("3m ago", "2d ago") from an ISO-8601 string. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export interface StatusMeta {
  label: string;
  /** Tailwind classes for the status dot. */
  dot: string;
}

const STATUS_META: Record<string, StatusMeta> = {
  pending: { label: "Pending", dot: "bg-amber-500" },
  in_review: { label: "In review", dot: "bg-blue-500" },
  completed: { label: "Completed", dot: "bg-emerald-500" },
  pulled: { label: "Pulled", dot: "bg-violet-500" },
  archived: { label: "Archived", dot: "bg-muted-foreground" },
};

export function statusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status, dot: "bg-muted-foreground" };
}

const SOURCE_LABELS: Record<string, string> = {
  cli: "CLI",
  upload: "Upload",
  paste: "Paste",
  path: "Path",
  url: "URL",
};

export function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? sourceType;
}
