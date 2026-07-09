"use client";

import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

/**
 * Caret-aware text insertion for the answer/elaboration textareas (§14,
 * decision B-5). The existing store-level insert (`insertIntoAnswer` /
 * `applyInsert`) is field-level replace/append only — it has no notion of the
 * caret. "Attach file" needs to splice a path exactly where the reviewer is
 * typing, so this adds the missing caret-offset path: a pure splice plus a tiny
 * hook that reads the live selection off the textarea and restores the caret
 * after React re-renders the controlled value.
 */

/**
 * Splice `insert` into `value` at a textarea's selection, replacing the range
 * `[start, end)` (a collapsed caret when `start === end`). Returns the new
 * string and the caret offset to land just after the inserted text. Offsets are
 * clamped into `value`'s bounds and normalized so `start <= end`; a non-finite
 * offset falls back to the end of the value (append). Pure — no DOM.
 */
export function spliceAtCaret(
  value: string,
  start: number,
  end: number,
  insert: string,
): { value: string; caret: number } {
  const len = value.length;
  let s = Number.isFinite(start) ? Math.max(0, Math.min(start, len)) : len;
  let e = Number.isFinite(end) ? Math.max(0, Math.min(end, len)) : len;
  if (s > e) [s, e] = [e, s];
  return { value: value.slice(0, s) + insert + value.slice(e), caret: s + insert.length };
}

/**
 * Wire caret-aware insertion to a controlled textarea. Returns a ref to attach
 * to the textarea and an `insertAtCaret(text)` that reads the element's current
 * value and selection, splices `text` in, and hands the new value to
 * `applyValue` (which the card uses to update its local state and persist).
 * After the controlled value re-renders, a layout effect refocuses the textarea
 * and places the caret right after the inserted text so typing continues
 * naturally.
 */
export function useCaretInsert(applyValue: (next: string) => void): {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  insertAtCaret: (text: string) => void;
} {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el && pendingCaret.current !== null) {
      const caret = pendingCaret.current;
      pendingCaret.current = null;
      el.focus();
      el.setSelectionRange(caret, caret);
    }
  });

  const insertAtCaret = useCallback(
    (text: string) => {
      const el = textareaRef.current;
      const value = el?.value ?? "";
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;
      const spliced = spliceAtCaret(value, start, end, text);
      pendingCaret.current = spliced.caret;
      applyValue(spliced.value);
    },
    [applyValue],
  );

  return { textareaRef, insertAtCaret };
}
