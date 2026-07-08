import type { Warning } from "@waypoint/spec";

/**
 * Surfaces parse warnings for a document (§7: warnings are shown, never fatal).
 * A malformed doc still renders and is still readable — this just tells the
 * reviewer what the parser could not make sense of.
 */
export function WarningsBanner({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
        {warnings.length} parse warning{warnings.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {warnings.map((w, i) => (
          <li key={i} className="flex gap-2">
            <code className="shrink-0 font-mono text-xs text-amber-600/80 dark:text-amber-400/80">
              {w.code}
            </code>
            <span>{w.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
