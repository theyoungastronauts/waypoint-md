"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/**
 * The focused-item model (§9) — a first-class primitive, not just right-rail
 * plumbing. One item is "focused" at a time; the right rail drives it now, and
 * keyboard nav (Phase 9) and the AI sidebar's context (Phase 7) build on the
 * same state. Cards register their scroll target and mark themselves focused on
 * interaction; consumers call {@link FocusApi.focus} to move focus + scroll.
 */
interface FocusApi {
  focusedId: string | null;
  /** Focus an item and scroll its card into view. */
  focus: (id: string) => void;
  /** Set the focused item without scrolling (e.g. from a card's own focus event). */
  setFocused: (id: string) => void;
  /** Register (or clear, with null) a card's scroll target. */
  register: (id: string, el: HTMLElement | null) => void;
}

const FocusContext = createContext<FocusApi | null>(null);

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const targets = useRef(new Map<string, HTMLElement>());

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) targets.current.set(id, el);
    else targets.current.delete(id);
  }, []);

  const focus = useCallback((id: string) => {
    setFocusedId(id);
    const el = targets.current.get(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const setFocused = useCallback((id: string) => setFocusedId(id), []);

  const api = useMemo<FocusApi>(
    () => ({ focusedId, focus, setFocused, register }),
    [focusedId, focus, setFocused, register],
  );

  return <FocusContext.Provider value={api}>{children}</FocusContext.Provider>;
}

export function useFocus(): FocusApi {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error("useFocus must be used within a FocusProvider");
  return ctx;
}
