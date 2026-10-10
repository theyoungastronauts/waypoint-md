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
  applyInsert,
  draftToBody,
  draftToValue,
  initialDraft,
  type Draft,
  type InsertMode,
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
  /**
   * Insert assistant text into the focused item's answer field and autosave
   * (§14). Bumps the item's external revision so the card re-seeds its local
   * textarea from the store rather than clobbering the insert on next keystroke.
   */
  insertIntoAnswer: (itemId: string, text: string, mode: InsertMode) => void;
  /**
   * Replace an item's whole draft, status included, and autosave it (Waypoint
   * Voice). Unlike {@link saveContent}, the status is taken as given — a spoken
   * answer to a flagged question is a decision, not an edit under a sticky flag.
   * Bumps the external revision so the card re-seeds its fields from the store.
   */
  writeDraft: (itemId: string, draft: Draft) => void;
  /** A monotonically-increasing counter bumped on each external edit of an item. */
  externalRev: (itemId: string) => number;
  toggleFlag: (itemId: string) => void;
  toggleSkip: (itemId: string) => void;
  /** Mark an item answered (⌘⏎ keyboard action, §9), preserving its content. */
  markAnswered: (itemId: string) => void;
  statusOf: (itemId: string) => EffectiveStatus;
  progress: Progress;
  order: ItemMeta[];
}

const ResponsesContext = createContext<ResponsesApi | null>(null);

interface StoreState {
  drafts: Record<string, Draft>;
  save: Record<string, SaveStatus>;
  /** Per-item external-edit counter — cards re-seed local state when it changes. */
  rev: Record<string, number>;
}

type Action =
  | { kind: "commit"; itemId: string; draft: Draft }
  | { kind: "save"; itemId: string; status: SaveStatus }
  | { kind: "bumpRev"; itemId: string };

function reducer(state: StoreState, action: Action): StoreState {
  switch (action.kind) {
    case "commit":
      return {
        ...state,
        drafts: { ...state.drafts, [action.itemId]: action.draft },
        save: { ...state.save, [action.itemId]: "saving" },
      };
    case "save":
      return { ...state, save: { ...state.save, [action.itemId]: action.status } };
    case "bumpRev":
      return {
        ...state,
        rev: { ...state.rev, [action.itemId]: (state.rev[action.itemId] ?? 0) + 1 },
      };
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
    rev: {} as Record<string, number>,
  }));

  // Timers that fade a "saved" tick back to idle; cleared on unmount.
  const fadeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Per-item save serialization (W3): a promise chain so the same item's PUTs are
  // sent in issue order (the server never ends up behind a newer local value),
  // and a monotonic sequence so only the latest save's result drives the tick —
  // a stale in-flight response can't flip the tick to "Saved" over newer state.
  const chainRef = useRef(new Map<string, Promise<unknown>>());
  const seqRef = useRef(new Map<string, number>());

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

      const mySeq = (seqRef.current.get(itemId) ?? 0) + 1;
      seqRef.current.set(itemId, mySeq);
      const isLatest = () => seqRef.current.get(itemId) === mySeq;

      const prev = chainRef.current.get(itemId) ?? Promise.resolve();
      const next = prev
        .catch(() => {}) // a prior failure must not stall later saves for this item
        .then(() => mutation.mutateAsync({ itemId, body }))
        .then(() => {
          if (!isLatest()) return; // a newer save is already in flight — ignore this result
          dispatch({ kind: "save", itemId, status: "saved" });
          const existing = fadeTimers.current.get(itemId);
          if (existing) clearTimeout(existing);
          fadeTimers.current.set(
            itemId,
            setTimeout(() => dispatch({ kind: "save", itemId, status: "idle" }), 1500),
          );
        })
        .catch(() => {
          // Keep the draft (never lose the answer) but do not claim it saved.
          if (isLatest()) dispatch({ kind: "save", itemId, status: "error" });
        });
      chainRef.current.set(itemId, next);
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

  const insertIntoAnswer = useCallback(
    (itemId: string, text: string, mode: InsertMode) => {
      const current = getDraft(itemId);
      const merged = applyInsert(current, typeById[itemId], text, mode);
      merged.status = statusAfterContentChange(current.status, responseHasContent(draftToValue(merged)));
      saveResponse(itemId, merged);
      // Signal the card to re-seed its uncontrolled textarea from the new draft.
      dispatch({ kind: "bumpRev", itemId });
    },
    [getDraft, typeById, saveResponse],
  );

  const writeDraft = useCallback(
    (itemId: string, draft: Draft) => {
      saveResponse(itemId, draft);
      dispatch({ kind: "bumpRev", itemId });
    },
    [saveResponse],
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

  const markAnswered = useCallback(
    (itemId: string) => {
      const draft = getDraft(itemId);
      if (draft.status === "answered") return; // already answered — no redundant save
      saveResponse(itemId, { ...draft, status: "answered" });
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
      insertIntoAnswer,
      writeDraft,
      externalRev: (itemId) => state.rev[itemId] ?? 0,
      toggleFlag: (itemId) => toggleStatus(itemId, "flagged"),
      toggleSkip: (itemId) => toggleStatus(itemId, "skipped"),
      markAnswered,
      statusOf,
      progress: computeProgress(order.map((m) => statusOf(m.itemId))),
      order,
    };
  }, [
    state.drafts,
    state.save,
    state.rev,
    getDraft,
    saveContent,
    insertIntoAnswer,
    writeDraft,
    toggleStatus,
    markAnswered,
    order,
  ]);

  return <ResponsesContext.Provider value={api}>{children}</ResponsesContext.Provider>;
}

export function useResponses(): ResponsesApi {
  const ctx = useContext(ResponsesContext);
  if (!ctx) throw new Error("useResponses must be used within a ResponsesProvider");
  return ctx;
}
