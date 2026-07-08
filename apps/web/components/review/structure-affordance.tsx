"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Structure this document" (§5.7): the adoptive-import affordance shown on a
 * convention-less document when the AI capability is on (the parent gates this
 * server-side, so no key means it never renders — consistent with Phase 7).
 *
 * One pass, accept-all: it POSTs to the structure route, which proposes items,
 * validates every anchor against the source, and persists the accepted ones.
 * On success it refreshes so the new synthetic cards render; on a no-op or error
 * it explains what happened.
 */
export function StructureAffordance({ docId }: { docId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setState("working");
    setMessage(null);
    try {
      const res = await fetch(`/api/documents/${docId}/structure`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setState("error");
        setMessage(body?.error?.message ?? "Structuring failed. Please try again.");
        return;
      }
      if (!body || body.accepted === 0) {
        setState("error");
        setMessage(
          body?.skipped?.length
            ? "No proposed questions could be anchored to this document. Nothing was added."
            : "No structure was proposed for this document.",
        );
        return;
      }
      // Synthetic items now exist; re-render server-side to show the cards (and
      // this affordance disappears).
      router.refresh();
    } catch {
      setState("error");
      setMessage("Structuring failed. Please try again.");
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-5">
      <h2 className="text-base font-semibold tracking-tight">Structure this document</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This document has no Waypoint questions. Let Claude propose a few decision points and
        questions — each anchored to a quote from the text — so you can review it here. Your source
        is never changed.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={state === "working"}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {state === "working" ? "Structuring…" : "Structure this document"}
        </button>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}
