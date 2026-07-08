"use client";

import { cn } from "@/lib/utils";
import { STATUS_DOT } from "@/lib/review-status";
import { AgentPanel } from "./agent-panel";
import { useAgent } from "./agent-store";
import { useFocus } from "./focus-context";
import { ProgressRing } from "./progress-ring";
import { useResponses } from "./responses-store";

/**
 * The review right rail (§9). Progress ring, an item-nav list with status dots
 * that focuses/scrolls the corresponding card, and — when AI is enabled (§14) —
 * an "Agent" tab holding the document-scoped chat. With no API key the agent tab
 * and its chat simply don't render; the items panel is all there is. Rendered
 * both as the desktop sidebar and inside the mobile bottom sheet.
 */
export function ReviewRail({
  docId,
  onFinish,
  onNavigate,
}: {
  docId: string;
  onFinish: () => void;
  onNavigate?: () => void;
}) {
  const { enabled, tab, setTab } = useAgent();

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      {enabled && (
        <div className="flex gap-1 rounded-lg border border-border p-1" role="tablist">
          {(["items", "agent"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {enabled && tab === "agent" ? (
        <AgentPanel />
      ) : (
        <ItemsPanel docId={docId} onFinish={onFinish} onNavigate={onNavigate} />
      )}
    </div>
  );
}

/** The item-nav + progress + export panel (the rail's non-agent content). */
function ItemsPanel({
  docId,
  onFinish,
  onNavigate,
}: {
  docId: string;
  onFinish: () => void;
  onNavigate?: () => void;
}) {
  const { order, progress, statusOf } = useResponses();
  const { focusedId, focus } = useFocus();

  const jump = (itemId: string) => {
    focus(itemId);
    onNavigate?.();
  };

  return (
    <>
      <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
        <ProgressRing value={progress.answered} total={progress.total} />
        <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <SummaryRow label="Answered" value={progress.answered} status="answered" />
          <SummaryRow label="Flagged" value={progress.flagged} status="flagged" />
          <SummaryRow label="Skipped" value={progress.skipped} status="skipped" />
          <SummaryRow label="Untouched" value={progress.untouched} status="untouched" />
        </dl>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto" aria-label="Items">
        {order.map((meta) => {
          const status = statusOf(meta.itemId);
          return (
            <button
              key={meta.itemId}
              type="button"
              onClick={() => jump(meta.itemId)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                focusedId === meta.itemId ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", STATUS_DOT[status])} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="text-xs font-medium text-muted-foreground">{meta.index}.</span>{" "}
                <span className="text-foreground">{meta.label}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-border pt-4">
        <a
          href={`/api/documents/${docId}/export?format=annotated`}
          className="flex w-full items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
        >
          Download annotated .md
        </a>
        <a
          href={`/api/documents/${docId}/export?format=digest`}
          className="flex w-full items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          title="Compact Q→A summary for agents (SPEC §9)"
        >
          Download digest .md
        </a>
        <button
          type="button"
          onClick={onFinish}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Finish review
        </button>
      </div>
    </>
  );
}

function SummaryRow({
  label,
  value,
  status,
}: {
  label: string;
  value: number;
  status: "answered" | "flagged" | "skipped" | "untouched";
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} aria-hidden />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto font-medium tabular-nums">{value}</dd>
    </div>
  );
}
