"use client";

import { cn } from "@/lib/utils";
import { useAgent } from "./agent-store";
import { ProgressRing } from "./progress-ring";
import { ReviewRail } from "./review-rail";
import { useResponses } from "./responses-store";

/**
 * The mobile counterpart to the desktop rail (§9): a fixed bottom bar showing
 * progress, tapping which opens a bottom sheet holding the full rail. Tapping an
 * item scrolls/focuses its card and closes the sheet. Sized for couch use —
 * large tap targets, one-thumb reach (§2 goal 4). Hidden at `lg` and up, where
 * the sticky sidebar takes over.
 */
export function MobileSheet({ docId, onFinish }: { docId: string; onFinish: () => void }) {
  const { progress } = useResponses();
  // Sheet-open lives in the agent store so "explain this question" can open the
  // sheet (and switch to the agent tab) from a card on mobile (§14).
  const { sheetOpen: open, setSheetOpen: setOpen } = useAgent();

  return (
    <div className="lg:hidden">
      {/* Fixed bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
        >
          <ProgressRing value={progress.answered} total={progress.total} size={40} />
          <span className="flex-1">
            <span className="block text-sm font-medium">
              {progress.answered}/{progress.total} answered
            </span>
            <span className="block text-xs text-muted-foreground">
              Tap for items, progress, and export
            </span>
          </span>
          <span className="text-sm text-muted-foreground">Open</span>
        </button>
      </div>

      {/* Sheet + backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setOpen(false)}
        aria-hidden={!open}
      />
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background p-4 pb-8 shadow-lg transition-transform duration-200",
          open ? "translate-y-0" : "translate-y-full",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Review navigation"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border" aria-hidden />
        <ReviewRail docId={docId} onFinish={onFinish} onNavigate={() => setOpen(false)} />
      </div>
    </div>
  );
}
