"use client";

import { useMutation } from "@tanstack/react-query";
import type { ItemType } from "@waypoint/spec";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  computeProgress,
  effectiveStatus,
  responseHasContent,
  statusAfterContentChange,
  type EffectiveStatus,
  type Progress,
} from "@/lib/review-status";
import {
  draftToBody,
  draftToValue,
  initialDraft,
  type Draft,
  type ReviewItemInit,
} from "./types";

/** Per-item autosave indicator (§9: a subtle saved-tick, never a save button). */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Ordered metadata the right rail renders (§9). */
export interface ItemMeta {
  itemId: string;
  wpId: string;
  index: number;
  type: ItemType;
  label: string;
}

/** The subset of a draft a card edits — status is derived centrally. */
export type ContentPatch = Partial<Pick<Draft, "text" | "selected" | "other">>;

interface ResponsesApi {
  getDraft: (itemId: string) => Draft;
  getSave: (itemId: string) => SaveStatus;
  /**
   * Merge a content change into an item's draft and persist it (optimistic).
   * Status is recomputed here so cards never reimplement the flag/skip rules.
   * The caller owns debouncing (text edits) vs. immediacy (checkbox clicks).
   */
  saveContent: (itemId: string, patch: ContentPatch) => void;
  toggleFlag: (itemId: string) => void;
  toggleSkip: (itemId: string) => void;
  statusOf: (itemId: string) => EffectiveStatus;
  progress: Progress;
  order: ItemMeta[];
}

const ResponsesContext = createContext<ResponsesApi | null>(null);

interface StoreState {
  drafts: Record<string, Draft>;
  save: Record<string, SaveStatus>;
}

type Action =
  | { kind: "commit"; itemId: string; draft: Draft }
  | { kind: "save"; itemId: string; status: SaveStatus };

function reducer(state: StoreState, action: Action): StoreState {
  switch (action.kind) {
    case "commit":
      return {
        drafts: { ...state.drafts, [action.itemId]: action.draft },
        save: { ...state.save, [action.itemId]: "saving" },
      };
    case "save":
      return { ...state, save: { ...state.save, [action.itemId]: action.status } };
  }
}

/** First non-empty line of a prompt, stripped of light markdown, for rail labels. */
function plainLabel(md: string): string {
  const firstLine = md.split("\n").find((line) => line.trim().length > 0) ?? "";
  const stripped = firstLine
    .replace(/[*_`~]/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
  return stripped.length > 64 ? `${stripped.slice(0, 63)}…` : stripped;
}

export function ResponsesProvider({
  inits,
  children,
}: {
  inits: ReviewItemInit[];
  children: React.ReactNode;
}) {
  const [order, typeById, initialDrafts] = useMemo(() => {
    const meta: ItemMeta[] = [];
    const types: Record<string, ItemType> = {};
    const drafts: Record<string, Draft> = {};
    inits.forEach((init, i) => {
      meta.push({
        itemId: init.itemId,
        wpId: init.item.wpId,
        index: i + 1,
        type: init.item.type,
        label: plainLabel(init.item.promptMd) || `Question ${i + 1}`,
      });
      types[init.itemId] = init.item.type;
      drafts[init.itemId] = initialDraft(init);
    });
    return [meta, types, drafts] as const;
  }, [inits]);

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    drafts: initialDrafts,
    save: {} as Record<string, SaveStatus>,
  }));

  // Timers that fade a "saved" tick back to idle; cleared on unmount.
  const fadeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const mutation = useMutation({
    mutationFn: async (vars: { itemId: string; body: unknown }) => {
      const res = await fetch(`/api/items/${vars.itemId}/response`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(vars.body),
      });
      if (!res.ok) throw new Error(`autosave failed (HTTP ${res.status})`);
      return res.json();
    },
  });

  const saveResponse = useCallback(
    (itemId: string, draft: Draft) => {
      // Optimistic: reflect the draft immediately (progress ring, status dots).
      dispatch({ kind: "commit", itemId, draft });
      const body = draftToBody(typeById[itemId], draft);
      mutation.mutate(
        { itemId, body },
        {
          onSuccess: () => {
            dispatch({ kind: "save", itemId, status: "saved" });
            const existing = fadeTimers.current.get(itemId);
            if (existing) clearTimeout(existing);
            fadeTimers.current.set(
              itemId,
              setTimeout(() => dispatch({ kind: "save", itemId, status: "idle" }), 1500),
            );
          },
          // Keep the draft (never lose the answer) but do not claim it saved.
          onError: () => dispatch({ kind: "save", itemId, status: "error" }),
        },
      );
    },
    [mutation, typeById],
  );

  const getDraft = useCallback(
    (itemId: string): Draft =>
      state.drafts[itemId] ?? { text: "", selected: [], other: "", status: null },
    [state.drafts],
  );

  const saveContent = useCallback(
    (itemId: string, patch: ContentPatch) => {
      const current = getDraft(itemId);
      const merged: Draft = { ...current, ...patch };
      merged.status = statusAfterContentChange(current.status, responseHasContent(draftToValue(merged)));
      saveResponse(itemId, merged);
    },
    [getDraft, saveResponse],
  );

  const toggleStatus = useCallback(
    (itemId: string, target: "flagged" | "skipped") => {
      const draft = getDraft(itemId);
      const isActive = draft.status === target;
      const nextStatus = isActive
        ? statusAfterContentChange(null, responseHasContent(draftToValue(draft)))
        : target;
      saveResponse(itemId, { ...draft, status: nextStatus });
    },
    [getDraft, saveResponse],
  );

  const api = useMemo<ResponsesApi>(() => {
    const statusOf = (itemId: string): EffectiveStatus =>
      effectiveStatus(draftToValue(state.drafts[itemId] ?? { text: "", selected: [], other: "", status: null }));
    return {
      getDraft,
      getSave: (itemId) => state.save[itemId] ?? "idle",
      saveContent,
      toggleFlag: (itemId) => toggleStatus(itemId, "flagged"),
      toggleSkip: (itemId) => toggleStatus(itemId, "skipped"),
      statusOf,
      progress: computeProgress(order.map((m) => statusOf(m.itemId))),
      order,
    };
  }, [state.drafts, state.save, getDraft, saveContent, toggleStatus, order]);

  return <ResponsesContext.Provider value={api}>{children}</ResponsesContext.Provider>;
}

export function useResponses(): ResponsesApi {
  const ctx = useContext(ResponsesContext);
  if (!ctx) throw new Error("useResponses must be used within a ResponsesProvider");
  return ctx;
}
