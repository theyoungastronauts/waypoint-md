"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

import { mediaCategory } from "@/lib/publish/media-types";
import type { PublicComment } from "@/lib/review/public-view";
import {
  isRegionVisible,
  pointInBox,
  regionFromDrag,
  regionStyle,
  type FractionPoint,
  type Region,
} from "@/lib/review/region";
import { cn } from "@/lib/utils";

/**
 * The stage: the render itself, plus the transparent overlay a reviewer drags a
 * region mark on (decision C-3).
 *
 * The overlay is exactly the media box, so a drag measured against its own
 * bounding rect is already in the fractions a region is stored as — no scaling
 * step to get wrong between a phone and a desktop. It only takes pointer events
 * while region mode is on; the rest of the time the player owns every touch, so
 * scrubbing and fullscreen behave exactly as the native controls do.
 *
 * Seeking is imperative rather than a `currentTime` prop: a controlled playhead
 * would fight the reviewer's own scrubbing on every frame.
 */

export interface MediaStageHandle {
  /** Jump to a position, in milliseconds. No-op when the media cannot seek. */
  seek(ms: number): void;
  pause(): void;
}

export interface MediaStageProps {
  fileUrl: string;
  contentType: string | null;
  title: string;
  comments: PublicComment[];
  selectedId: string | null;
  currentMs: number;
  regionMode: boolean;
  onTimeUpdate: (ms: number) => void;
  onRegionDrawn: (region: Region) => void;
}

export const MediaStage = forwardRef<MediaStageHandle, MediaStageProps>(function MediaStage(
  { fileUrl, contentType, title, comments, selectedId, currentMs, regionMode, onTimeUpdate, onRegionDrawn },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<FractionPoint | null>(null);
  const [drag, setDrag] = useState<Region | null>(null);

  useImperativeHandle(ref, () => ({
    seek(ms: number) {
      const video = videoRef.current;
      if (!video) return;
      // A media element rejects a seek before metadata arrives; a failed seek is
      // not worth an error surface, so it is swallowed and the playhead stays.
      try {
        video.currentTime = Math.max(0, ms) / 1000;
      } catch {
        /* media not seekable yet */
      }
    },
    pause() {
      const video = videoRef.current;
      if (video && !video.paused) video.pause();
    },
  }));

  const category = mediaCategory(contentType);

  const media =
    category === "video" ? (
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        src={fileUrl}
        title={title}
        className="w-full rounded-lg bg-black"
        onTimeUpdate={(event) => onTimeUpdate(Math.round(event.currentTarget.currentTime * 1000))}
      />
    ) : category === "image" ? (
      // Served straight from R2 at its published dimensions; next/image would
      // route it back through a server the publish path exists to bypass.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={fileUrl} alt={title} className="w-full rounded-lg bg-black object-contain" />
    ) : category === "pdf" ? (
      <iframe src={fileUrl} title={title} className="h-[60vh] w-full rounded-lg bg-card" />
    ) : (
      <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No preview for this file type.
      </p>
    );

  const pointFromEvent = (clientX: number, clientY: number): FractionPoint | null => {
    const box = overlayRef.current?.getBoundingClientRect();
    if (!box) return null;
    return pointInBox(clientX, clientY, box);
  };

  return (
    <div className="relative">
      {media}

      {/* The mark layer. Non-interactive unless a region is being drawn, so the
          player keeps every gesture the rest of the time. */}
      <div
        ref={overlayRef}
        data-testid="region-overlay"
        className={cn(
          "absolute inset-0 rounded-lg",
          regionMode ? "cursor-crosshair touch-none bg-black/10" : "pointer-events-none",
        )}
        onPointerDown={(event) => {
          if (!regionMode) return;
          const point = pointFromEvent(event.clientX, event.clientY);
          if (!point) return;
          startRef.current = point;
          setDrag(null);
          // Keep receiving moves when the finger leaves the frame mid-drag.
          if (typeof event.currentTarget.setPointerCapture === "function") {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerMove={(event) => {
          const start = startRef.current;
          if (!regionMode || !start) return;
          const point = pointFromEvent(event.clientX, event.clientY);
          if (!point) return;
          setDrag(regionFromDrag(start, point));
        }}
        onPointerUp={(event) => {
          const start = startRef.current;
          startRef.current = null;
          if (!regionMode || !start) return;
          const point = pointFromEvent(event.clientX, event.clientY);
          const region = point ? regionFromDrag(start, point) : null;
          setDrag(null);
          if (region) onRegionDrawn(region);
        }}
      >
        {comments.map((comment) =>
          comment.region &&
          isRegionVisible({
            commentId: comment.id,
            timecodeMs: comment.timecodeMs,
            selectedId,
            currentMs,
          }) ? (
            <div
              key={comment.id}
              data-testid="region-mark"
              data-comment={comment.id}
              className="absolute rounded border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.15)]"
              style={regionStyle(comment.region)}
            />
          ) : null,
        )}

        {drag && (
          <div
            data-testid="region-draft"
            className="absolute rounded border-2 border-dashed border-primary bg-primary/10"
            style={regionStyle(drag)}
          />
        )}
      </div>
    </div>
  );
});
