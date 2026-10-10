"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AgentProvider, type AgentMessage } from "./agent-store";
import { CommentableProse } from "./commentable-prose";
import { CommentLayer } from "./comment-layer";
import { CommentsProvider, type CommentView, type ProseSource } from "./comments-store";
import { CompletionSummary } from "./completion-summary";
import { FocusProvider } from "./focus-context";
import { ItemCard } from "./item-card";
import { KeyboardNav } from "./keyboard-nav";
import { MobileSheet } from "./mobile-sheet";
import { ResponsesProvider } from "./responses-store";
import type { VoiceSessionRow } from "@/lib/voice/sessions";
import { VoiceCall } from "./voice-call";
import { VoiceTranscripts } from "./voice-transcripts";
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
  syntheticInits = [],
  comments,
  aiEnabled,
  voiceEnabled = false,
  voiceSessions = [],
  initialChat,
}: {
  docId: string;
  segments: ReviewSegment[];
  /** Synthetic (adoptive-import) item cards, rendered in a dedicated section (§5.7). */
  syntheticInits?: ReviewItemInit[];
  comments: CommentView[];
  /** Server-driven capability flag (§14): whether the AI sidebar renders. */
  aiEnabled: boolean;
  /** Server-driven capability flag (Waypoint Voice): whether the Talk button renders. */
  voiceEnabled?: boolean;
  /** Past voice calls on this document, newest first, with transcripts. */
  voiceSessions?: VoiceSessionRow[];
  /** The persisted chat thread for this document (empty when AI is off). */
  initialChat: AgentMessage[];
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

  // Synthetic cards share the same responses store (autosave, focus, progress,
  // right-rail nav) as in-place items — they are appended to the item order.
  const allInits = useMemo<ReviewItemInit[]>(
    () => [...inits, ...syntheticInits],
    [inits, syntheticInits],
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
      <ResponsesProvider inits={allInits}>
        <FocusProvider>
          <AgentProvider docId={docId} enabled={aiEnabled} initialMessages={initialChat}>
          {completed && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              Review marked completed. You can keep editing and download the annotated file anytime.
            </div>
          )}

          {voiceEnabled && allInits.length > 0 && (
            <div className="mt-4">
              <VoiceCall docId={docId} onSubmitted={onCompleted} />
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

              <SyntheticSection inits={syntheticInits} startIndex={inits.length} />

              <UnanchoredComments />

              <VoiceTranscripts sessions={voiceSessions} />
            </article>

            {/* flex-col + overflow-hidden give the rail a real height bound, so the
                chat/items panels can scroll internally instead of clipping at the
                viewport; without them h-full never resolves against max-h. */}
            <aside className="hidden lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100vh-6rem)] lg:flex-col lg:overflow-hidden">
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
          <KeyboardNav />
          </AgentProvider>
        </FocusProvider>
      </ResponsesProvider>
    </CommentsProvider>
  );
}

/**
 * Synthetic (adoptive-import) items in a dedicated section below the prose (§5.7).
 * In-place insertion would mean splitting rendered prose at an arbitrary byte
 * offset — disproportionate and fragile — so they collect here in document order
 * (by anchor offset), each card showing the source quote it refers to. They
 * answer and autosave exactly like in-place cards. Renders nothing when empty.
 */
function SyntheticSection({ inits, startIndex }: { inits: ReviewItemInit[]; startIndex: number }) {
  if (inits.length === 0) return null;
  return (
    <section className="mt-10 border-t border-border pt-6">
      <div className="mb-1">
        <h2 className="text-lg font-semibold tracking-tight">Structured review</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Questions proposed by adoptive import, each anchored to a quote from this document. Your
          answers export into a “Waypoint responses” section and never change the source.
        </p>
      </div>
      {inits.map((init, i) => (
        <ItemCard key={init.itemId} init={init} index={startIndex + i + 1} />
      ))}
    </section>
  );
}
