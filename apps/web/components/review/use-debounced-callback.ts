"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a debounced version of `fn` plus a `flush` that fires any pending
 * call immediately. Used for autosave (§9): text edits coalesce into one
 * request per {@link delay} window, so a burst of keystrokes never spams the
 * `PUT` endpoint. The latest arguments win. The timer is cleared on unmount.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delay: number,
): { call: (...args: Args) => void; flush: () => void } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Args | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const flush = useCallback(() => {
    clear();
    if (pending.current) {
      const args = pending.current;
      pending.current = null;
      fnRef.current(...args);
    }
  }, []);

  const call = useCallback(
    (...args: Args) => {
      pending.current = args;
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        if (pending.current) {
          const next = pending.current;
          pending.current = null;
          fnRef.current(...next);
        }
      }, delay);
    },
    [delay],
  );

  useEffect(() => clear, []);

  return { call, flush };
}
