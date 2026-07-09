"use client";

import { useEffect, useRef, useState } from "react";
import { renderMarkdownToSafeHtml } from "@/lib/render/pipeline";
import { cn } from "@/lib/utils";
import { useAgent, type AgentMessage } from "./agent-store";
import { useFocus } from "./focus-context";
import { useResponses } from "./responses-store";
import { isPinnedToBottom } from "./scroll";
import { splitSuggestions } from "./suggestions";

/**
 * The document-scoped chat surface in the right rail (§14). Streams assistant
 * replies, offers a per-message "insert into answer" that targets the focused
 * item, and takes new turns. Assistant markdown renders through the same
 * rehype-sanitize pipeline as document prose — model output is untrusted, so
 * it gets the identical allowlist, never raw HTML. Insert-into-answer keeps
 * the raw markdown text (answers are markdown).
 */
export function AgentPanel() {
  const { messages, streaming, error, send, stop } = useAgent();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether the chat is currently pinned to the bottom. We only auto-follow new
  // and streaming messages while pinned, so a reader who scrolls up to re-read
  // is not yanked back down; scrolling back to the bottom re-arms the follow.
  // Starts true so a fresh conversation follows from the first turn.
  const pinnedRef = useRef(true);

  // Keep the newest turn in view as it streams, but only while pinned to the
  // bottom. `scrollTo` is guarded because jsdom (test env) doesn't implement it.
  useEffect(() => {
    if (!pinnedRef.current) return;
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) pinnedRef.current = isPinnedToBottom(el);
  };

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    send(text);
    setInput("");
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto">
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
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <div className="space-y-2">
            {/* Prose renders through the shared rehype-sanitize pipeline (same
                allowlist as document prose, so a model reply can't inject live
                markup); each ```wpsuggest fence is lifted out into a card and
                never double-rendered as a prose code block. */}
            {splitSuggestions(message.content).map((seg, idx) =>
              seg.kind === "suggestion" ? (
                <SuggestionCard key={idx} contents={seg.text} />
              ) : (
                <div
                  key={idx}
                  className="wp-prose break-words text-sm"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(seg.text) }}
                />
              ),
            )}
          </div>
        )}
        {streaming && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
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

/**
 * A ```wpsuggest block (§14, decision B-1): the agent's proposed answer as a
 * distinct card with a one-click **Use this answer** that replaces the focused
 * item's answer with the *raw* fence contents (answers are markdown — the insert
 * uses the verbatim text, never the rendered HTML). The preview is rendered
 * through the same sanitizing pipeline as all model output. With nothing focused
 * it shows the same focus-first hint as {@link InsertControls}, so the action can
 * never silently no-op.
 */
function SuggestionCard({ contents }: { contents: string }) {
  const { focusedId } = useFocus();
  const { insertIntoAnswer } = useResponses();
  const [inserted, setInserted] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const use = () => {
    if (!focusedId) return;
    insertIntoAnswer(focusedId, contents, "replace");
    setInserted(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setInserted(false), 1500);
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Suggested answer</p>
      <div
        className="wp-prose break-words text-sm"
        // Preview only — sanitized like all model output. The insert uses the raw
        // markdown `contents`, never this rendered HTML.
        dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(contents) }}
      />
      {focusedId ? (
        <button
          type="button"
          onClick={use}
          className="mt-2.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {inserted ? "Inserted ✓" : "Use this answer"}
        </button>
      ) : (
        <p className="mt-2.5 border-t border-border pt-2 text-xs text-muted-foreground">
          Focus a question to insert this into its answer.
        </p>
      )}
    </div>
  );
}
