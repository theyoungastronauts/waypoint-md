"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { mediaCategory } from "@/lib/publish/media-types";
import type { PublicComment, PublicReviewPayload } from "@/lib/review/public-view";
import type { Region } from "@/lib/review/region";
import { formatTimecode } from "@/lib/review/timecode";
import { cn } from "@/lib/utils";
import { CommentList } from "./comment-list";
import { MediaStage, type MediaStageHandle } from "./media-stage";

/**
 * The public review page (§ media spec Phase C, decision C-3). Everything a
 * reviewer who is not on the tailnet can do with a render: watch it, leave a
 * note at a moment or on the whole thing, draw a box on a frame, walk the notes
 * already there, and switch between versions of the same material.
 *
 * Built for a phone held in one hand: full-width controls, a composer that
 * appears where the thumb already is, no hover-only affordance, and no keyboard
 * requirement. The reviewer's name is displayed and never editable — it comes
 * from the link (decision Q4), and the POST body has no field for it.
 */

export interface MediaReviewProps {
  payload: PublicReviewPayload;
  initialComments: PublicComment[];
  /** The `?k=` capability, carried into every write and every version link. */
  token: string;
}

interface Anchor {
  timecodeMs: number | null;
  region: Region | null;
}

export function MediaReview({ payload, initialComments, token }: MediaReviewProps) {
  const { publication, reviewer, versions } = payload;
  const [comments, setComments] = useState(initialComments);
  const [currentMs, setCurrentMs] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [regionMode, setRegionMode] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stage = useRef<MediaStageHandle | null>(null);

  const timed = mediaCategory(publication.contentType) === "video";

  const openComposer = (next: Anchor) => {
    setAnchor(next);
    setError(null);
    setRegionMode(false);
  };

  const startTimedNote = () => {
    stage.current?.pause();
    openComposer({ timecodeMs: currentMs, region: anchor?.region ?? null });
  };

  const startGeneralNote = () => openComposer({ timecodeMs: null, region: null });

  const startRegion = () => {
    stage.current?.pause();
    setAnchor(null);
    setError(null);
    setRegionMode((on) => !on);
  };

  const onRegionDrawn = (region: Region) => {
    setRegionMode(false);
    openComposer({ timecodeMs: timed ? currentMs : null, region });
  };

  const selectComment = (comment: PublicComment) => {
    setSelectedId((current) => (current === comment.id ? null : comment.id));
    if (comment.timecodeMs !== null) {
      stage.current?.seek(comment.timecodeMs);
      setCurrentMs(comment.timecodeMs);
    }
  };

  const post = async () => {
    if (!anchor || draft.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/r/${encodeURIComponent(publication.id)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          k: token,
          timecodeMs: anchor.timecodeMs,
          region: anchor.region,
          body: draft,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "That note could not be saved.");
      }
      const { comment } = (await res.json()) as { comment: PublicComment };
      // Re-sort locally on the same rule the server orders by, so a new note
      // lands where it belongs without a refetch.
      setComments((current) => order([...current, comment]));
      setDraft("");
      setAnchor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That note could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const anchorLabel =
    anchor === null
      ? ""
      : [
          anchor.timecodeMs === null ? "General note" : `Note at ${formatTimecode(anchor.timecodeMs)}`,
          anchor.region ? "with a region mark" : null,
        ]
          .filter(Boolean)
          .join(" ");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{publication.title}</h1>
        <p className="text-xs text-muted-foreground">
          {[publication.group, publication.label].filter(Boolean).join(" · ")}
          {publication.group || publication.label ? " · " : ""}
          Reviewing as <span className="font-medium text-foreground">{reviewer.name}</span>
        </p>
      </header>

      <MediaStage
        ref={stage}
        fileUrl={publication.fileUrl}
        contentType={publication.contentType}
        title={publication.title}
        comments={comments}
        selectedId={selectedId}
        currentMs={currentMs}
        regionMode={regionMode}
        onTimeUpdate={setCurrentMs}
        onRegionDrawn={onRegionDrawn}
      />

      {versions.length > 1 && (
        <nav aria-label="Versions" className="flex flex-wrap gap-2">
          {versions.map((version) => (
            <a
              key={version.id}
              href={`/r/${encodeURIComponent(version.id)}?k=${encodeURIComponent(token)}`}
              aria-current={version.current}
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                version.current
                  ? "border-primary bg-accent/40 font-medium"
                  : "border-border text-muted-foreground",
              )}
            >
              {version.label ?? version.title}
            </a>
          ))}
        </nav>
      )}

      <div className="flex flex-wrap gap-2">
        {timed && (
          <Button className="min-h-11 flex-1" onClick={startTimedNote}>
            Note at {formatTimecode(currentMs)}
          </Button>
        )}
        <Button variant="outline" className="min-h-11 flex-1" onClick={startGeneralNote}>
          General note
        </Button>
        <Button
          variant={regionMode ? "default" : "outline"}
          className="min-h-11 flex-1"
          onClick={startRegion}
        >
          {regionMode ? "Drag a box" : "Mark region"}
        </Button>
      </div>

      {regionMode && (
        <p className="text-xs text-muted-foreground">
          Drag a box over the paused frame to mark it, then write the note.
        </p>
      )}

      {anchor && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-medium text-muted-foreground">{anchorLabel}</p>
          <textarea
            aria-label={anchorLabel}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            autoFocus
            placeholder="What should change?"
            className="w-full rounded-md border border-border bg-background p-3 text-base outline-none focus-visible:border-ring"
          />
          <div className="flex gap-2">
            <Button
              className="min-h-11 flex-1"
              onClick={post}
              disabled={busy || draft.trim().length === 0}
            >
              {busy ? "Posting…" : "Post note"}
            </Button>
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setAnchor(null);
                setDraft("");
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Notes ({comments.length})
        </h2>
        <CommentList comments={comments} selectedId={selectedId} onSelect={selectComment} />
      </section>
    </div>
  );
}

/**
 * The server's ordering, applied client-side so an optimistic insert lands in
 * the right place: general notes first, then up the timeline, ties by creation.
 */
function order(comments: PublicComment[]): PublicComment[] {
  return [...comments].sort((a, b) => {
    if (a.timecodeMs === null && b.timecodeMs !== null) return -1;
    if (a.timecodeMs !== null && b.timecodeMs === null) return 1;
    if (a.timecodeMs !== null && b.timecodeMs !== null && a.timecodeMs !== b.timecodeMs) {
      return a.timecodeMs - b.timecodeMs;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}
