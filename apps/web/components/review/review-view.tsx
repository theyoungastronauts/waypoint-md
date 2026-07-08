"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CommentableProse } from "./commentable-prose";
import { CommentLayer } from "./comment-layer";
import { CommentsProvider, type CommentView, type ProseSource } from "./comments-store";
import { CompletionSummary } from "./completion-summary";
import { FocusProvider } from "./focus-context";
import { ItemCard } from "./item-card";
import { MobileSheet } from "./mobile-sheet";
import { ResponsesProvider } from "./responses-store";
import { ReviewRail } from "./review-rail";
import { UnanchoredComments } from "./unanchored-comments";
import type { ReviewItemInit, ReviewSegment } from "./types";

/**
 * The interactive review surface (§9, §10): the document with in-place question
 * cards, selection comments over the prose, a sticky right rail on desktop, and a
 * bottom sheet on mobile. All state (drafts, autosave, focus, comments) lives in
 * the providers here; the server component only supplies the pre-rendered
 * segments, persisted responses, and existing comments.
 */
export function ReviewView({
  docId,
  segments,
  comments,
}: {
  docId: string;
  segments: ReviewSegment[];
  comments: CommentView[];
}) {
  const router = useRouter();
  const [showSummary, setShowSummary] = useState(false);
  const [completed, setCompleted] = useState(false);

  const inits = useMemo<ReviewItemInit[]>(
    () =>
      segments
        .filter((s): s is Extract<ReviewSegment, { kind: "item" }> => s.kind === "item")
        .map(({ itemId, item, promptHtml, optionLabelsHtml, persisted, warnings }) => ({
          itemId,
          item,
          promptHtml,
          optionLabelsHtml,
          persisted,
          warnings,
        })),
    [segments],
  );

  const proseSources = useMemo<ProseSource[]>(
    () =>
      segments
        .filter((s): s is Extract<ReviewSegment, { kind: "prose" }> => s.kind === "prose")
        .map((s) => ({ source: s.source, sourceStart: s.sourceStart })),
    [segments],
  );

  const onCompleted = () => {
    setCompleted(true);
    router.refresh();
  };

  let itemOrdinal = 0;

  return (
    <CommentsProvider docId={docId} initialComments={comments} proseSources={proseSources}>
      <ResponsesProvider inits={inits}>
        <FocusProvider>
          {completed && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              Review marked completed. You can keep editing and download the annotated file anytime.
            </div>
          )}

          <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
            <article className="pb-24 lg:pb-0">
              {segments.map((segment, i) => {
                if (segment.kind === "prose") {
                  return (
                    <CommentableProse
                      key={i}
                      html={segment.html}
                      source={segment.source}
                      sourceStart={segment.sourceStart}
                    />
                  );
                }
                itemOrdinal += 1;
                return <ItemCard key={segment.itemId} init={segment} index={itemOrdinal} />;
              })}

              <UnanchoredComments />
            </article>

            <aside className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)]">
              <ReviewRail docId={docId} onFinish={() => setShowSummary(true)} />
            </aside>
          </div>

          <MobileSheet docId={docId} onFinish={() => setShowSummary(true)} />

          <CompletionSummary
            docId={docId}
            open={showSummary}
            onClose={() => setShowSummary(false)}
            onCompleted={onCompleted}
          />

          <CommentLayer />
        </FocusProvider>
      </ResponsesProvider>
    </CommentsProvider>
  );
}
