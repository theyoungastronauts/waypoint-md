"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFocus } from "./focus-context";

/**
 * The AI sidebar hub (§14). One provider owns everything the agent surfaces
 * touch: the document-scoped chat thread (streaming over SSE), the right-rail
 * tab + mobile-sheet UI state (so "explain this question" can open the agent
 * from a card), and the explain quick action. When {@link AgentApi.enabled} is
 * false — no API key — the provider still supplies UI state but chat and explain
 * are inert, and consumers hide their agent affordances.
 */

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

type Tab = "items" | "agent";

interface AgentApi {
  enabled: boolean;
  tab: Tab;
  setTab: (tab: Tab) => void;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  messages: AgentMessage[];
  streaming: boolean;
  error: string | null;
  /** Send a chat turn; `focusedItemId` scopes server context to that item (§14). */
  send: (text: string, opts?: { focusedItemId?: string | null }) => void;
  /** Cancel an in-flight stream (client cancel; server persists the partial). */
  stop: () => void;
  /** "Explain this question": focus the item, open the agent, and ask about it. */
  explain: (itemId: string) => void;
}

const AgentContext = createContext<AgentApi | null>(null);

const EXPLAIN_PROMPT =
  "Explain this question — what is it asking, and what would a good answer need to cover?";

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function AgentProvider({
  docId,
  enabled,
  initialMessages,
  children,
}: {
  docId: string;
  enabled: boolean;
  initialMessages: AgentMessage[];
  children: React.ReactNode;
}) {
  const { focus } = useFocus();
  const [tab, setTab] = useState<Tab>("items");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const send = useCallback(
    (text: string, opts?: { focusedItemId?: string | null }) => {
      if (!enabled || busyRef.current) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      setError(null);
      const assistantId = uid();
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "user", content: trimmed },
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setStreaming(true);
      busyRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      const appendDelta = (t: string) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + t } : m)));

      void (async () => {
        try {
          const res = await fetch(`/api/documents/${docId}/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: trimmed, focusedItemId: opts?.focusedItemId ?? null }),
            signal: controller.signal,
          });
          if (!res.ok || !res.body) {
            setError(await errorMessage(res));
            return;
          }
          await readSse(res.body, { onDelta: appendDelta, onError: setError });
        } catch (err) {
          // stop() aborts the fetch: keep the partial (the server persisted it too).
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            setError("The assistant response failed. Please try again.");
          }
        } finally {
          setStreaming(false);
          busyRef.current = false;
          abortRef.current = null;
          // Drop an assistant bubble that never received any text (e.g. an early error).
          setMessages((prev) => prev.filter((m) => !(m.id === assistantId && m.content.length === 0)));
        }
      })();
    },
    [enabled, docId],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const explain = useCallback(
    (itemId: string) => {
      if (!enabled) return;
      focus(itemId);
      setTab("agent");
      setSheetOpen(true); // reveals the agent on mobile; the desktop rail is always visible.
      send(EXPLAIN_PROMPT, { focusedItemId: itemId });
    },
    [enabled, focus, send],
  );

  const api = useMemo<AgentApi>(
    () => ({ enabled, tab, setTab, sheetOpen, setSheetOpen, messages, streaming, error, send, stop, explain }),
    [enabled, tab, sheetOpen, messages, streaming, error, send, stop, explain],
  );

  return <AgentContext.Provider value={api}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentApi {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used within an AgentProvider");
  return ctx;
}

/** Read an error message from a non-OK chat response (falls back to a generic line). */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? "The assistant is unavailable.";
  } catch {
    return "The assistant is unavailable.";
  }
}

/** Parse an SSE stream body, dispatching `delta`/`error` frames. */
async function readSse(
  body: ReadableStream<Uint8Array>,
  handlers: { onDelta: (text: string) => void; onError: (message: string) => void },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const parsed = parseFrame(frame);
      if (!parsed) continue;
      if (parsed.event === "delta" && typeof parsed.data?.text === "string") {
        handlers.onDelta(parsed.data.text);
      } else if (parsed.event === "error") {
        handlers.onError(
          typeof parsed.data?.message === "string" ? parsed.data.message : "The assistant response failed.",
        );
      }
    }
  }
}

function parseFrame(frame: string): { event: string; data: { text?: string; message?: string } } | null {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}
