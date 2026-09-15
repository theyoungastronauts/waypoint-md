"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";
import type { MediaCommentView } from "@/lib/review/comments";
import { formatTimecode } from "@/lib/review/timecode";
import { cn } from "@/lib/utils";

/**
 * The author's side of the review loop (decision C-4): every note left on a
 * render, with the resolve toggle that says "acted on".
 *
 * `c1`, `c2`, … are the same ordinals the digest and `waypoint resolve` use, so
 * a note can be found here by the number an agent just reported. Bodies render
 * as plain text — the same rule as the public page, since the text came from
 * there.
 */
export function MediaCommentsPanel({
  publicationId,
  initialComments,
}: {
  publicationId: string;
  initialComments: MediaCommentView[];
}) {
  const [comments, setComments] = useState(initialComments);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unresolved = comments.filter((c) => !c.resolved).length;

  const toggle = async (comment: MediaCommentView) => {
    setBusyId(comment.id);
    setError(null);
    const action = comment.resolved ? "unresolve" : "resolve";
    try {
      const res = await fetch(
        `/api/publications/${publicationId}/comments/${comment.id}/${action}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { comment: updated } = (await res.json()) as { comment: MediaCommentView };
      setComments((current) =>
        current.map((c) => (c.id === updated.id ? { ...updated, ordinal: c.ordinal } : c)),
      );
    } catch {
      setError("Couldn’t update that note. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card px-5 py-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Review notes</h2>
        <span className="text-xs text-muted-foreground">
          {unresolved} unresolved of {comments.length}
        </span>
      </div>

      {comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No notes on this publication yet.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((comment) => (
            <li
              key={comment.id}
              data-testid="media-comment"
              data-resolved={comment.resolved ? "true" : "false"}
              className={cn(
                "space-y-1 rounded-md border border-border px-3 py-2",
                comment.resolved && "opacity-50",
              )}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground">c{comment.ordinal}</span>
                <span className="rounded bg-secondary px-2 py-0.5 font-mono text-secondary-foreground">
                  {comment.timecodeMs === null ? "general" : formatTimecode(comment.timecodeMs)}
                </span>
                <span className="font-medium">{comment.authorName}</span>
                {comment.region && <span className="text-muted-foreground">region</span>}
                <span className="text-muted-foreground">{relativeTime(comment.createdAt)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => toggle(comment)}
                  disabled={busyId === comment.id}
                >
                  {comment.resolved ? "Reopen" : "Resolve"}
                </Button>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
