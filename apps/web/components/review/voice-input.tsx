"use client";

import { useEffect } from "react";
import { DictationWaveform } from "./dictation-waveform";
import { useDictation } from "./use-dictation";

/**
 * Voice (speech-to-text) affordance for an answer/elaboration field, placed
 * beside {@link AttachFile} so the action row reads `[Add file/folder] [Voice]`.
 * Shares the same shape as Attach file: it takes an `onInsert(text)` and splices
 * the dictated transcript at the field's caret (the caller passes the card's
 * `insertAtCaret`), after which the existing autosave fires.
 *
 * Degradation (required): where the Web Speech API is absent the mic is not
 * rendered at all — the field behaves exactly as before. Runtime failures show a
 * subtle inline hint and revert to idle. See {@link useDictation} for the state
 * machine and mic teardown.
 */

/** Microphone glyph, sized to match {@link AttachFile}'s 12px action icon. */
function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 1a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

export function VoiceInput({ onInsert }: { onInsert: (text: string) => void }) {
  const { state, liveText, isSupported, analyser, error, start, stop, cancel } = useDictation({
    onTranscript: onInsert,
  });

  // While listening, Escape discards the take (mirrors the modal-dismiss habit
  // elsewhere). Scoped to the listening state so it never swallows Escape while
  // the reviewer is just typing.
  useEffect(() => {
    if (state !== "listening") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, cancel]);

  // Degradation contract: no Web Speech API ⇒ no mic affordance whatsoever.
  if (!isSupported) return null;

  if (state === "listening") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={stop}
            aria-label="Stop voice input and insert"
            title="Stop and insert · Esc to cancel"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            <MicIcon className="animate-pulse" />
            <span>Listening…</span>
          </button>
          {analyser && <DictationWaveform analyser={analyser} />}
          <button
            type="button"
            onClick={cancel}
            aria-label="Cancel voice input"
            className="text-xs font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        </div>
        {liveText && (
          <p aria-live="polite" className="truncate text-xs italic text-muted-foreground">
            {liveText}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={start}
        aria-label="Voice input"
        title="Voice input"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/75 transition-colors hover:text-foreground"
      >
        <MicIcon />
        <span className="underline underline-offset-2">Voice</span>
      </button>
      {error && <span className="text-xs text-muted-foreground">{error}</span>}
    </div>
  );
}
