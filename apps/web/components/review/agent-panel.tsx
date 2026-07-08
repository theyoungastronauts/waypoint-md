"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAgent, type AgentMessage } from "./agent-store";
import { useFocus } from "./focus-context";
import { useResponses } from "./responses-store";

/**
 * The document-scoped chat surface in the right rail (§14). Streams assistant
 * replies, offers a per-message "insert into answer" that targets the focused
 * item, and takes new turns. Model output is rendered as plain text (never
 * HTML) so a reply can't inject markup into the review view.
 */
export function AgentPanel() {
  const { messages, streaming, error, send, stop } = useAgent();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as it streams. `scrollTo` is guarded because
  // jsdom (test env) doesn't implement it on elements.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    send(text);
    setInput("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Ask about this document</p>
            <p className="mt-1">
              Chat is scoped to this document and your answers. Use{" "}
              <span className="font-medium">Explain</span> on a card, or ask a question below. Insert
              any reply into the focused answer.
            </p>
          </div>
        ) : (
          messages.map((m, i) => {
            const isStreamingMsg = streaming && i === messages.length - 1 && m.role === "assistant";
            return <MessageBubble key={m.id} message={m} streaming={isStreamingMsg} />;
          })
        )}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          className="min-h-16 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          placeholder="Ask about this document…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex justify-end gap-2">
          {streaming && (
            <button
              type="button"
              onClick={stop}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              Stop
            </button>
          )}
          <button
            type="submit"
            disabled={streaming || input.trim().length === 0}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message, streaming }: { message: AgentMessage; streaming: boolean }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "border border-border bg-card",
        )}
      >
        <p className="whitespace-pre-wrap break-words">
          {message.content}
          {streaming && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
        </p>
        {!isUser && !streaming && message.content.length > 0 && <InsertControls text={message.content} />}
      </div>
    </div>
  );
}

/** Per-message "insert into answer" targeting the focused item (§14). */
function InsertControls({ text }: { text: string }) {
  const { focusedId } = useFocus();
  const { insertIntoAnswer } = useResponses();

  if (!focusedId) {
    return (
      <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
        Focus a question to insert this into its answer.
      </p>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-xs">
      <span className="text-muted-foreground">Insert into answer:</span>
      <button
        type="button"
        onClick={() => insertIntoAnswer(focusedId, text, "append")}
        className="rounded border border-border px-2 py-0.5 font-medium transition-colors hover:bg-accent"
      >
        Append
      </button>
      <button
        type="button"
        onClick={() => insertIntoAnswer(focusedId, text, "replace")}
        className="rounded border border-border px-2 py-0.5 font-medium transition-colors hover:bg-accent"
      >
        Replace
      </button>
    </div>
  );
}
