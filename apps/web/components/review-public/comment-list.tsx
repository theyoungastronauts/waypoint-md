"use client";

import type { PublicComment } from "@/lib/review/public-view";
import { formatTimecode } from "@/lib/review/timecode";
import { cn } from "@/lib/utils";

/**
 * The notes already on this cut (decision C-3). Ordered as the server sends
 * them: general notes first, then up the timeline — the order the digest uses,
 * so what a reviewer sees and what an agent acts on are the same list.
 *
 * Every row is a full-width button: tapping a timecoded note seeks the player to
 * it and shows its region mark, which is the one interaction that has to work
 * one-handed on a phone. Bodies are plain text rendered as text nodes — React
 * escapes them, and nothing here ever interprets markdown or HTML.
 */
export function CommentList({
  comments,
  selectedId,
  onSelect,
}: {
  comments: PublicComment[];
  selectedId: string | null;
  onSelect: (comment: PublicComment) => void;
}) {
  if (comments.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No notes yet. Pause anywhere and leave the first one.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {comments.map((comment) => (
        <li key={comment.id}>
          <button
            type="button"
            data-testid="comment-row"
            data-comment={comment.id}
            data-resolved={comment.resolved ? "true" : "false"}
            aria-current={selectedId === comment.id}
            onClick={() => onSelect(comment)}
            className={cn(
              "flex w-full flex-col gap-1.5 rounded-lg border px-4 py-3 text-left transition-colors",
              selectedId === comment.id
                ? "border-primary bg-accent/40"
                : "border-border hover:bg-accent/20",
              comment.resolved && "opacity-50",
            )}
          >
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-secondary px-2 py-1 font-mono text-secondary-foreground">
                {comment.timecodeMs === null ? "general" : formatTimecode(comment.timecodeMs)}
              </span>
              <span className="font-medium">{comment.authorName}</span>
              {comment.region && <span className="text-muted-foreground">region</span>}
              {comment.resolved && <span className="text-muted-foreground">· resolved</span>}
            </span>
            <span className="whitespace-pre-wrap break-words text-sm">{comment.body}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
