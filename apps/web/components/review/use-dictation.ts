"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser-native speech-to-text for the answer/elaboration fields (voice input,
 * adapted from Liminal Shift's `useDictation`). Uses the Web Speech API
 * (`SpeechRecognition` / `webkitSpeechRecognition`) directly in the browser —
 * **no server, no API key, no upload**. Chrome routes audio through Google and
 * Safari through Apple; that tradeoff is accepted for this affordance.
 *
 * UX adaptation: Liminal's three-state machine had an explicit `ready` review
 * step (transcribe → review transcript → send / re-record / cancel) because it
 * fed a chat composer. Here the transcript lands in an already-editable textarea
 * that the reviewer can immediately fix, so the review step is redundant. This
 * hook collapses to **idle → listening → (stop) insert**: pressing stop splices
 * the accumulated transcript straight into the field via the caller's
 * `onTranscript`, then returns to idle. The reviewer edits in place as usual.
 *
 * Degradation (required): `isSupported` feature-detects the API. Where it is
 * absent (Firefox, locked-down browsers) the caller must not render the mic —
 * the field works exactly as before. Runtime failures (permission denied,
 * recognition error) revert quietly to idle with a subtle `error` hint rather
 * than throwing or console-spamming. All mic tracks + the AudioContext are torn
 * down on stop/cancel/unmount so no OS mic indicator is left hanging.
 */

export type DictationState = "idle" | "listening";

interface UseDictationOptions {
  /** Called once, on stop or auto-end, with the trimmed final transcript. */
  onTranscript: (text: string) => void;
}

interface UseDictationReturn {
  state: DictationState;
  /** Live (final + interim) transcript, shown while listening. */
  liveText: string;
  /** True only where the Web Speech API exists (drives the degradation gate). */
  isSupported: boolean;
  /** Waveform source; null in environments without getUserMedia/AudioContext. */
  analyser: AnalyserNode | null;
  /** Subtle inline hint after a runtime failure (e.g. mic permission denied). */
  error: string | null;
  start: () => void;
  stop: () => void;
  cancel: () => void;
}

// --- Minimal Web Speech API typings (not in the standard lib.dom.d.ts). -------

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    webkitAudioContext?: typeof AudioContext;
  }
}

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/** A human hint for the errors worth surfacing; the rest stay silent. */
function hintForError(error: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone access was blocked.";
  }
  if (error === "audio-capture") return "No microphone was found.";
  return "Voice input stopped unexpectedly.";
}

export function useDictation({ onTranscript }: UseDictationOptions): UseDictationReturn {
  const [state, setState] = useState<DictationState>("idle");
  const [liveText, setLiveText] = useState("");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Detect support after mount so SSR and the first client render agree (no mic
  // on either), then reveal it on the client — avoids a hydration mismatch.
  const [isSupported, setIsSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const finalRef = useRef("");
  const combinedRef = useRef("");
  // True while a dictation session is live; guards finalize() from running twice
  // when both our stop() and the API's onend/onerror fire for the same session.
  const activeRef = useRef(false);
  // Bumped on every start(): a setupAnalyser awaiting getUserMedia checks it
  // after the await so a session that was stopped-and-restarted during the
  // permission grant releases its now-stale stream instead of orphaning a track.
  const generationRef = useRef(0);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    setIsSupported(getSpeechRecognition() !== null);
  }, []);

  const teardown = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      // Drop handlers before abort() so its onend/onerror can't re-enter here.
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // Some engines throw if already stopped — nothing left to clean here.
      }
      recognitionRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAnalyser(null);
  }, []);

  /** End the session: tear down the mic, reset to idle, and (if committing and
   * there is text) hand the transcript to the caller for caret insertion. */
  const finalize = useCallback(
    (commit: boolean) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      const text = combinedRef.current.trim();
      teardown();
      finalRef.current = "";
      combinedRef.current = "";
      setLiveText("");
      setState("idle");
      if (commit && text) onTranscriptRef.current(text);
    },
    [teardown],
  );

  /** Best-effort mic tap for the waveform only. Recognition works without it, so
   * any failure here (jsdom, no AudioContext, denied) is swallowed silently. */
  const setupAnalyser = useCallback(async (gen: number) => {
    try {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) return;
      const stream = await media.getUserMedia({ audio: true });
      if (!activeRef.current || gen !== generationRef.current) {
        // Session ended — or was stopped and restarted — while awaiting
        // permission. Release this now-stale mic immediately so a restart race
        // can't orphan the first session's track.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const node = ctx.createAnalyser();
      node.fftSize = 128;
      node.smoothingTimeConstant = 0.8;
      ctx.createMediaStreamSource(stream).connect(node);
      audioContextRef.current = ctx;
      setAnalyser(node);
    } catch {
      // No waveform; dictation continues without it.
    }
  }, []);

  const start = useCallback(() => {
    if (state !== "idle") return;
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";

      finalRef.current = "";
      combinedRef.current = "";

      rec.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) finalRef.current += result[0].transcript + " ";
          else interim += result[0].transcript;
        }
        combinedRef.current = finalRef.current + interim;
        setLiveText(combinedRef.current.trim());
      };

      rec.onerror = (event) => {
        // 'no-speech' is transient (keep listening); 'aborted' is our own
        // teardown. Everything else is a real failure: hint + revert to idle.
        if (event.error === "no-speech" || event.error === "aborted") return;
        setError(hintForError(event.error));
        finalize(false);
      };

      // Fires on manual stop() and on the engine auto-ending (silence). Guarded
      // by activeRef so it no-ops when our own stop() already finalized.
      rec.onend = () => finalize(true);

      recognitionRef.current = rec;
      activeRef.current = true;
      const gen = ++generationRef.current;
      rec.start();
      setError(null);
      setLiveText("");
      setState("listening");
      void setupAnalyser(gen);
    } catch {
      activeRef.current = false;
      teardown();
      setError("Couldn't start voice input.");
      setState("idle");
    }
  }, [state, finalize, setupAnalyser, teardown]);

  // stop → insert the accumulated transcript; cancel → discard it.
  const stop = useCallback(() => finalize(true), [finalize]);
  const cancel = useCallback(() => finalize(false), [finalize]);

  // Release the mic on unmount so no OS recording indicator is left hanging.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      teardown();
    };
  }, [teardown]);

  return { state, liveText, isSupported, analyser, error, start, stop, cancel };
}
