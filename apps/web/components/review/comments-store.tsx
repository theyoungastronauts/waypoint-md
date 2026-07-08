"use client";

import type { CommentAnchor } from "@waypoint/spec";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { type BuiltAnchor, locateAnchorInSource } from "@/lib/anchor/source-map";

/** A comment as the review UI holds it (mirrors the API's `comment` shape). */
export interface CommentView {
  id: string;
  anchor: CommentAnchor;
  bodyMd: string;
  suggestionMd: string | null;
  createdAt: string;
}

/** A prose run's source slice + offset — the inputs anchor mapping needs (§10). */
export interface ProseSource {
  source: string;
  sourceStart: number;
}

/** A comment resolved to a highlight range within one prose segment. */
export interface SegmentHighlight {
  commentId: string;
  /** Offsets into the segment's source slice. */
  localStart: number;
  localEnd: number;
}

/** A small viewport rectangle used to position the floating overlay. */
export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The single floating overlay: a "Comment" button, a composer, or a viewer. */
export type Overlay =
  | { kind: "button"; anchor: BuiltAnchor; rect: Rect }
  | { kind: "compose"; anchor: BuiltAnchor; rect: Rect }
  | { kind: "view"; commentId: string; rect: Rect }
  | null;

interface CommentsApi {
  comments: CommentView[];
  /** Comments whose anchor no longer matches any prose (§10 degradation). */
  unanchored: CommentView[];
  overlay: Overlay;
  /** Highlight ranges for the prose segment starting at `sourceStart`. */
  highlightsFor: (sourceStart: number) => SegmentHighlight[];
  showButton: (anchor: BuiltAnchor, rect: Rect) => void;
  compose: () => void;
  viewComment: (commentId: string, rect: Rect) => void;
  closeOverlay: () => void;
  create: (input: { anchor: CommentAnchor; bodyMd: string; suggestionMd?: string | null }) => Promise<boolean>;
  update: (id: string, patch: { bodyMd?: string; suggestionMd?: string | null }) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

const CommentsContext = createContext<CommentsApi | null>(null);

export function CommentsProvider({
  docId,
  initialComments,
  proseSources,
  children,
}: {
  docId: string;
  initialComments: CommentView[];
  proseSources: ProseSource[];
  children: React.ReactNode;
}) {
  const [comments, setComments] = useState<CommentView[]>(initialComments);
  const [overlay, setOverlay] = useState<Overlay>(null);

  // Resolve each comment to the earliest prose segment its anchor matches, so a
  // highlight lands on the same block the splice writer would target (§11). A
  // comment that matches nowhere is "unanchored" and shown in the bottom list.
  const resolved = useMemo(() => {
    return comments.map((comment) => {
      let best: { sourceStart: number; localStart: number; localEnd: number; abs: number } | null = null;
      for (const seg of proseSources) {
        const range = locateAnchorInSource(seg.source, comment.anchor);
        if (!range) continue;
        const abs = seg.sourceStart + range.start;
        if (!best || abs < best.abs) {
          best = { sourceStart: seg.sourceStart, localStart: range.start, localEnd: range.end, abs };
        }
      }
      return { comment, hit: best };
    });
  }, [comments, proseSources]);

  const highlightsBySegment = useMemo(() => {
    const map = new Map<number, SegmentHighlight[]>();
    for (const { comment, hit } of resolved) {
      if (!hit) continue;
      const list = map.get(hit.sourceStart) ?? [];
      list.push({ commentId: comment.id, localStart: hit.localStart, localEnd: hit.localEnd });
      map.set(hit.sourceStart, list);
    }
    return map;
  }, [resolved]);

  const unanchored = useMemo(() => resolved.filter((r) => !r.hit).map((r) => r.comment), [resolved]);

  const highlightsFor = useCallback(
    (sourceStart: number) => highlightsBySegment.get(sourceStart) ?? [],
    [highlightsBySegment],
  );

  const showButton = useCallback((anchor: BuiltAnchor, rect: Rect) => {
    setOverlay({ kind: "button", anchor, rect });
  }, []);

  const compose = useCallback(() => {
    setOverlay((cur) => (cur?.kind === "button" ? { kind: "compose", anchor: cur.anchor, rect: cur.rect } : cur));
  }, []);

  const viewComment = useCallback((commentId: string, rect: Rect) => {
    setOverlay({ kind: "view", commentId, rect });
  }, []);

  const closeOverlay = useCallback(() => setOverlay(null), []);

  const create = useCallback<CommentsApi["create"]>(
    async (input) => {
      const res = await fetch(`/api/documents/${docId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return false;
      const { comment } = (await res.json()) as { comment: CommentView };
      setComments((prev) => [...prev, comment]);
      return true;
    },
    [docId],
  );

  const update = useCallback<CommentsApi["update"]>(async (id, patch) => {
    const res = await fetch(`/api/comments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return false;
    const { comment } = (await res.json()) as { comment: CommentView };
    setComments((prev) => prev.map((c) => (c.id === id ? comment : c)));
    return true;
  }, []);

  const remove = useCallback<CommentsApi["remove"]>(async (id) => {
    const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
    if (!res.ok) return false;
    setComments((prev) => prev.filter((c) => c.id !== id));
    setOverlay((cur) => (cur?.kind === "view" && cur.commentId === id ? null : cur));
    return true;
  }, []);

  const api = useMemo<CommentsApi>(
    () => ({
      comments,
      unanchored,
      overlay,
      highlightsFor,
      showButton,
      compose,
      viewComment,
      closeOverlay,
      create,
      update,
      remove,
    }),
    [comments, unanchored, overlay, highlightsFor, showButton, compose, viewComment, closeOverlay, create, update, remove],
  );

  return <CommentsContext.Provider value={api}>{children}</CommentsContext.Provider>;
}

export function useComments(): CommentsApi {
  const ctx = useContext(CommentsContext);
  if (!ctx) throw new Error("useComments must be used within a CommentsProvider");
  return ctx;
}
