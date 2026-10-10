import type { VoiceSessionRow } from "@/lib/voice/sessions";
import type { TranscriptEntry } from "@/lib/voice/transcript";
import { cn } from "@/lib/utils";

/**
 * The transcripts of a document's voice calls (Waypoint Voice), so a misheard
 * answer can be checked against what was said and what was written. Each tool
 * call is shown with its result: that is the exact record of what the call put
 * into the review. Rendered only when the document has had a call.
 */

const STATUS_LABEL: Record<VoiceSessionRow["status"], string> = {
  active: "in progress or dropped",
  ended: "ended without submitting",
  submitted: "submitted",
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** A tool call in a reader's terms: name, arguments, and what came back. */
function toolLine(entry: Extract<TranscriptEntry, { role: "tool" }>): string {
  let result = entry.result;
  try {
    const parsed = JSON.parse(entry.result) as Record<string, unknown>;
    if (typeof parsed.error === "string") result = `error: ${parsed.error}`;
    else if (typeof parsed.recorded === "string") result = `recorded: ${parsed.recorded}`;
    else if (typeof parsed.status === "string") result = parsed.status;
    else if (parsed.ok === true) result = "ok";
  } catch {
    // Not JSON: show it as stored.
  }
  const args = entry.args && entry.args !== "{}" ? ` ${entry.args}` : "";
  return `${entry.name}${args} → ${result}`;
}

export function VoiceTranscripts({ sessions }: { sessions: VoiceSessionRow[] }) {
  if (sessions.length === 0) return null;

  return (
    <section className="mt-10 space-y-3" aria-labelledby="voice-calls-heading">
      <h2 id="voice-calls-heading" className="text-lg font-semibold tracking-tight">
        Voice calls
      </h2>
      {sessions.map((session) => (
        <details key={session.id} className="rounded-lg border border-border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm">
            <span className="font-medium">{formatWhen(session.startedAt)}</span>
            <span className="text-muted-foreground">
              {session.mode ? ` · ${session.mode}` : ""} · {STATUS_LABEL[session.status]} ·{" "}
              {session.transcript.length} {session.transcript.length === 1 ? "entry" : "entries"}
            </span>
          </summary>
          <ol className="mt-3 space-y-1.5 text-sm">
            {session.transcript.map((entry, i) => (
              <li key={i} className={cn(entry.role === "tool" && "font-mono text-xs text-muted-foreground")}>
                {entry.role === "tool" ? (
                  toolLine(entry)
                ) : (
                  <>
                    <span className="font-medium">{entry.role === "reviewer" ? "You" : "Waypoint"}:</span>{" "}
                    {entry.text}
                  </>
                )}
              </li>
            ))}
            {session.transcript.length === 0 && <li className="text-muted-foreground">Nothing was said.</li>}
          </ol>
        </details>
      ))}
    </section>
  );
}
