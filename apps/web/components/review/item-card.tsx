"use client";

import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/review-status";
import { ChoiceGroup } from "./choice-group";
import { useFocus } from "./focus-context";
import { Prose } from "./prose";
import { QuestionCard } from "./question-card";
import { useResponses } from "./responses-store";
import { SavedTick } from "./saved-tick";
import type { ReviewItemInit } from "./types";

/**
 * The interactive replacement for Phase 3's inert card: a `wp:` question
 * rendered live and in-place (§9). It owns the chrome — number, id, status,
 * saved-tick, flag/skip controls, and per-item parse warnings — and delegates
 * the answer surface to {@link QuestionCard} (text) or {@link ChoiceGroup}
 * (choice). The card registers itself with the focused-item model so the right
 * rail and later keyboard nav can scroll to and highlight it.
 */
export function ItemCard({ init, index }: { init: ReviewItemInit; index: number }) {
  const { item, itemId, promptHtml, optionLabelsHtml, warnings } = init;
  const { focusedId, setFocused, register } = useFocus();
  const { getSave, statusOf, toggleFlag, toggleSkip } = useResponses();

  const status = statusOf(itemId);
  const draft = getSave(itemId);
  const focused = focusedId === itemId;

  const registerRef = useCallback(
    (el: HTMLDivElement | null) => register(itemId, el),
    [register, itemId],
  );

  const flagged = status === "flagged";
  const skipped = status === "skipped";

  return (
    <div
      ref={registerRef}
      id={`item-${itemId}`}
      onFocus={() => setFocused(itemId)}
      className={cn(
        "my-6 scroll-mt-24 rounded-lg border bg-card p-5 shadow-xs transition-colors",
        focused ? "border-ring ring-1 ring-ring/40" : "border-border",
      )}
    >
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Question {index}</span>
        {item.wpId && <span className="font-mono">#{item.wpId}</span>}
        <span className="ml-auto flex items-center gap-2">
          <SavedTick status={draft} />
          <span className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", STATUS_DOT[status])} aria-hidden />
            {STATUS_LABEL[status]}
          </span>
          <Badge variant="outline">
            {item.type === "choice"
              ? `Choice · ${item.select === "multi" ? "select many" : "select one"}`
              : "Text"}
          </Badge>
        </span>
      </div>

      <Prose html={promptHtml} />

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {warnings.map((w, i) => (
            <li key={i}>{w.message}</li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {item.type === "choice" ? (
          <ChoiceGroup itemId={itemId} item={item} optionLabelsHtml={optionLabelsHtml} />
        ) : (
          <QuestionCard itemId={itemId} />
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => toggleFlag(itemId)}
          aria-pressed={flagged}
          className={cn(
            "rounded-md border px-2.5 py-1 font-medium transition-colors",
            flagged
              ? "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "border-border text-muted-foreground hover:bg-accent",
          )}
        >
          {flagged ? "Flagged" : "Flag"}
        </button>
        <button
          type="button"
          onClick={() => toggleSkip(itemId)}
          aria-pressed={skipped}
          className={cn(
            "rounded-md border px-2.5 py-1 font-medium transition-colors",
            skipped
              ? "border-slate-400/60 bg-slate-400/15 text-slate-600 dark:text-slate-300"
              : "border-border text-muted-foreground hover:bg-accent",
          )}
        >
          {skipped ? "Skipped" : "Skip"}
        </button>
        <span className="text-muted-foreground/70">
          {flagged ? "Marked to revisit later." : skipped ? "Skipped for now." : "Flag to revisit, or skip."}
        </span>
      </div>
    </div>
  );
}
