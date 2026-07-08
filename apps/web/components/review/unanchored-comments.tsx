"use client";

import { Button } from "@/components/ui/button";
import { useComments } from "./comments-store";

/**
 * Comments whose anchor no longer matches any prose in the document (§10) — e.g.
 * the text was edited away or the doc was superseded. They are never silently
 * dropped: they surface here at the bottom of the review view, still readable,
 * editable, and deletable, with the quote they were anchored to.
 */
export function UnanchoredComments() {
  const { unanchored, remove } = useComments();
  if (unanchored.length === 0) return null;

  return (
    <section className="mt-8 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <h2 className="text-sm font-semibold">
        Unanchored comments{" "}
        <span className="font-normal text-muted-foreground">({unanchored.length})</span>
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        The text these comments pointed to is no longer in the document. They still export, matched
        by their quote where possible.
      </p>
      <ul className="mt-3 space-y-3">
        {unanchored.map((c) => (
          <li key={c.id} className="rounded-md border border-border bg-card p-3">
            <p className="line-clamp-2 border-l-2 border-primary/40 pl-2 text-xs italic text-muted-foreground">
              “{c.anchor.exact}”
            </p>
            {c.bodyMd.trim().length > 0 && <p className="mt-2 whitespace-pre-wrap text-sm">{c.bodyMd}</p>}
            {c.suggestionMd && (
              <p className="mt-2 whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs">{c.suggestionMd}</p>
            )}
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
