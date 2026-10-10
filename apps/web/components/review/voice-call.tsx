"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { VoiceBrief } from "@/lib/voice/brief";
import { Interview, type InterviewStore } from "@/lib/voice/interview";
import { RealtimeCall, type CallEndReason } from "@/lib/voice/realtime-client";
import { TranscriptSync } from "@/lib/voice/transcript-sync";
import { useFocus } from "./focus-context";
import { useResponses } from "./responses-store";

/**
 * Waypoint Voice: answer the review by talking. The Talk button prepares the
 * document's voice brief (Claude, cached per version), asks the server for a
 * short-lived Realtime key, and opens a WebRTC call. The voice model interviews
 * the reviewer; its tool calls run here through {@link Interview}, writing into
 * the normal draft via the response store. The call ends with a read-back and,
 * once the reviewer confirms, submits the review.
 *
 * Degradation: rendered only when the server says voice is configured (both
 * keys) and, after mount, only in a browser with a microphone API and WebRTC —
 * the first client render matches the server's (no button), so no hydration
 * mismatch.
 */

type Phase = "idle" | "preparing" | "connecting" | "live" | "ended" | "error";

interface SessionResponse {
  sessionId: string;
  clientSecret: string;
  callsUrl: string;
  brief: VoiceBrief;
}

interface ApiError {
  error?: { message?: string };
}

const END_MESSAGE: Record<CallEndReason, string> = {
  submitted: "Review submitted. The transcript is saved with the review.",
  stopped: "Call ended. Your answers are saved as a draft.",
  hangup: "Call ended. Your answers are saved as a draft.",
  dropped: "The call dropped. Your answers so far are saved as a draft.",
  error: "The call could not continue.",
};

async function postJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) throw new Error(body.error?.message ?? `Request failed (HTTP ${res.status}).`);
  return body;
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
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
    </svg>
  );
}

export function VoiceCall({ docId, onSubmitted }: { docId: string; onSubmitted: () => void }) {
  const responses = useResponses();
  const { focus } = useFocus();
  const router = useRouter();

  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [question, setQuestion] = useState<{ number: number; of: number } | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const callRef = useRef<RealtimeCall | null>(null);
  const syncRef = useRef<TranscriptSync | null>(null);
  // Set by Hang up or unmount while the call is still being prepared, so start()
  // stops at its next step instead of opening a mic nobody can close.
  const abortedRef = useRef(false);
  // Tool calls read the store at call time, not at the render that started the call.
  const responsesRef = useRef(responses);
  responsesRef.current = responses;
  const onSubmittedRef = useRef(onSubmitted);
  onSubmittedRef.current = onSubmitted;

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        typeof window.RTCPeerConnection === "function" &&
        typeof navigator.mediaDevices?.getUserMedia === "function",
    );
  }, []);

  // Unmount (navigating away mid-call): release the mic and save the tail.
  useEffect(
    () => () => {
      abortedRef.current = true;
      callRef.current?.dispose();
      void syncRef.current?.close("ended");
    },
    [],
  );

  const hangUp = useCallback(() => {
    if (callRef.current) {
      callRef.current.hangup();
      return;
    }
    // Still preparing: nothing is open yet; make start() stand down.
    abortedRef.current = true;
    setPhase("ended");
    setMessage("Call cancelled.");
  }, []);

  const start = useCallback(async () => {
    setMessage(null);
    setCaption("");
    setLastHeard("");
    setQuestion(null);
    abortedRef.current = false;

    const audio = audioRef.current;
    if (!audio) {
      setPhase("error");
      setMessage("The audio output is not ready. Reload the page and try again.");
      return;
    }

    let session: SessionResponse;
    try {
      setPhase("preparing");
      await postJson(`/api/documents/${docId}/voice/brief`);
      if (abortedRef.current) return;
      setPhase("connecting");
      session = await postJson<SessionResponse>(`/api/documents/${docId}/voice/session`);
    } catch (err) {
      if (abortedRef.current) return;
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Could not start the call.");
      return;
    }

    const sync = new TranscriptSync(session.sessionId, fetch.bind(window));
    if (abortedRef.current) {
      // Cancelled while the key was being minted: close the record, open nothing.
      void sync.close("ended");
      return;
    }
    syncRef.current = sync;
    sync.start();
    const now = () => new Date().toISOString();

    // Answered or skipped before the call: the interview moves past these.
    const answeredBefore = responses.order
      .filter((m) => {
        const status = responses.getDraft(m.itemId).status;
        return status === "answered" || status === "skipped";
      })
      .map((m) => m.itemId);

    const store: InterviewStore = {
      // latestDraft, not getDraft: several tool calls can land before React renders.
      getDraft: (itemId) => responsesRef.current.latestDraft(itemId),
      writeDraft: (itemId, draft) => responsesRef.current.writeDraft(itemId, draft),
      submit: async () => {
        // Every spoken answer must be saved before the review is marked done.
        await responsesRef.current.flushPending();
        const res = await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "completed" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        onSubmittedRef.current();
      },
      setStyle: (style) => void sync.setMode(style),
      endCall: (reason) => callRef.current?.endAfterGoodbye(reason),
      showQuestion: (itemId, number) => {
        focus(itemId);
        setQuestion({ number, of: session.brief.questions.length });
      },
    };
    const interview = new Interview(session.brief, store, answeredBefore);

    const call = new RealtimeCall(
      {
        getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
        createPeerConnection: () => new RTCPeerConnection(),
        fetch: fetch.bind(window),
        audioElement: audio,
        setTimeout: window.setTimeout.bind(window) as typeof setTimeout,
        clearTimeout: window.clearTimeout.bind(window) as typeof clearTimeout,
      },
      {
        onToolCall: (name, args) => interview.execute(name, args),
        onReviewerTurn: () => interview.noteReviewerTurn(),
        onToolRecord: (r) => sync.push({ role: "tool", at: now(), name: r.name, args: r.args, result: r.result }),
        onUtterance: (role, text) => {
          sync.push({ role, at: now(), text });
          if (role === "reviewer") setLastHeard(text);
        },
        onCaption: setCaption,
        onPhase: (p) => {
          if (p === "live") setPhase("live");
        },
        onEnded: (reason, detail) => {
          callRef.current = null;
          setCaption("");
          // A hang-up can land while the submit is in flight: wait for it, so the
          // record and the message reflect what actually happened.
          void interview.settled().then(async () => {
            const submitted = interview.isSubmitted;
            setPhase(reason === "error" ? "error" : "ended");
            setMessage(
              reason === "error" ? (detail ?? END_MESSAGE.error) : END_MESSAGE[submitted ? "submitted" : reason],
            );
            // Once the transcript has landed, refresh so the "Voice calls" panel shows it.
            await sync.close(submitted ? "submitted" : "ended");
            router.refresh();
          });
        },
      },
    );
    if (abortedRef.current) {
      void sync.close("ended");
      return;
    }
    callRef.current = call;
    await call.start({ clientSecret: session.clientSecret, callsUrl: session.callsUrl });
  }, [docId, focus, responses, router]);

  if (!supported) return null;

  const busy = phase === "preparing" || phase === "connecting" || phase === "live";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3",
        busy && "sticky top-2 z-30 shadow-md",
      )}
      aria-live="polite"
    >
      <audio ref={audioRef} autoPlay hidden />
      <div className="flex flex-wrap items-center gap-3">
        {!busy ? (
          <button
            type="button"
            onClick={() => void start()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <MicIcon className="size-4" />
            Talk
          </button>
        ) : (
          <button
            type="button"
            onClick={hangUp}
            className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
          >
            Hang up
          </button>
        )}

        <div className="min-w-0 flex-1 text-sm">
          {phase === "idle" && (
            <span className="text-muted-foreground">Answer this review by talking instead of reading.</span>
          )}
          {phase === "preparing" && <span className="text-muted-foreground">Preparing the voice brief…</span>}
          {phase === "connecting" && <span className="text-muted-foreground">Connecting…</span>}
          {phase === "live" && (
            <span className="flex items-center gap-2">
              <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
              <span className="font-medium">On the call</span>
              {question && (
                <span className="text-muted-foreground">
                  · question {question.number} of {question.of}
                </span>
              )}
            </span>
          )}
          {(phase === "ended" || phase === "error") && message && (
            <span className={phase === "error" ? "text-destructive" : "text-muted-foreground"}>{message}</span>
          )}
        </div>
      </div>

      {phase === "live" && (caption || lastHeard) && (
        <div className="mt-2 space-y-1 text-sm">
          {caption && <p className="text-foreground">{caption}</p>}
          {lastHeard && <p className="text-muted-foreground">You: {lastHeard}</p>}
        </div>
      )}
    </div>
  );
}
