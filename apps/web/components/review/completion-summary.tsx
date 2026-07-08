"use client";

import { useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { STATUS_DOT } from "@/lib/review-status";
import { useResponses } from "./responses-store";

/**
 * The one-screen completion summary (§9). Opened from the rail's "Finish
 * review"; shows the answered/flagged/skipped/untouched tally and marks the
 * document completed (`PATCH status`). Leaving items flagged or untouched is the
 * reviewer's call — the summary informs, it does not block.
 */
export function CompletionSummary({
  docId,
  open,
  onClose,
  onCompleted,
}: {
  docId: string;
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const { progress } = useResponses();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) throw new Error(`Could not mark completed (HTTP ${res.status}).`);
      return res.json();
    },
    onSuccess: () => {
      onCompleted();
      onClose();
    },
  });

  if (!open) return null;

  const rows: Array<{ label: string; value: number; status: keyof typeof STATUS_DOT }> = [
    { label: "Answered", value: progress.answered, status: "answered" },
    { label: "Flagged", value: progress.flagged, status: "flagged" },
    { label: "Skipped", value: progress.skipped, status: "skipped" },
    { label: "Untouched", value: progress.untouched, status: "untouched" },
  ];
  const remaining = progress.untouched + progress.flagged;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Review summary"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Review summary</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {remaining === 0
            ? "Every item is answered or skipped."
            : `${remaining} item${remaining === 1 ? "" : "s"} still flagged or untouched.`}
        </p>

        <dl className="mt-4 space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-2 text-sm">
              <span className={cn("size-2 rounded-full", STATUS_DOT[row.status])} aria-hidden />
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="ml-auto font-medium tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>

        {mutation.isError && (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {(mutation.error as Error).message}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Keep reviewing
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {mutation.isPending ? "Marking…" : "Mark completed"}
          </button>
        </div>
      </div>
    </div>
  );
}
