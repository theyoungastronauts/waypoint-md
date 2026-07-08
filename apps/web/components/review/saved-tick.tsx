import { cn } from "@/lib/utils";
import type { SaveStatus } from "./responses-store";

/**
 * The subtle per-card autosave indicator (§9). Honest by design: it shows
 * "Saving…" while a request is in flight, a check once the server confirms, and
 * a plain "Not saved — retrying" on failure — it never claims saved when it is
 * not (a killed network keeps the draft but shows the error, per the review
 * notes). Idle renders nothing.
 */
export function SavedTick({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;

  const meta: Record<Exclude<SaveStatus, "idle">, { label: string; className: string }> = {
    saving: { label: "Saving…", className: "text-muted-foreground" },
    saved: { label: "Saved", className: "text-emerald-600 dark:text-emerald-400" },
    error: { label: "Not saved — retrying", className: "text-destructive" },
  };
  const { label, className } = meta[status];

  return (
    <span className={cn("flex items-center gap-1 text-xs", className)} aria-live="polite">
      {status === "saved" && (
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8.5l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {label}
    </span>
  );
}
