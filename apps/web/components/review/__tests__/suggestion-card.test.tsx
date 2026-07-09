// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Item } from "@waypoint/spec";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPanel } from "@/components/review/agent-panel";
import { AgentProvider, type AgentMessage } from "@/components/review/agent-store";
import { FocusProvider, useFocus } from "@/components/review/focus-context";
import { ResponsesProvider } from "@/components/review/responses-store";
import type { ReviewItemInit } from "@/components/review/types";

const ITEM_ID = "item-1";

const SUGGESTION = "Yes — adopt option A.";
const MESSAGE = ["Some reasoning first.", "", "```wpsuggest", SUGGESTION, "```"].join("\n");

/** A minimal text item so the store can route a `replace` into its answer. */
function textInit(): ReviewItemInit {
  const item: Item = {
    wpId: "q1",
    type: "text",
    promptMd: "Describe the approach",
    spans: { block: { start: 0, end: 0 }, questionOpen: { start: 0, end: 0 } },
  };
  return { itemId: ITEM_ID, item, promptHtml: "", optionLabelsHtml: [], persisted: null, warnings: [] };
}

/** Focuses a fixed item on mount so the suggestion card targets it. */
function Focuser({ id }: { id: string }) {
  const { setFocused } = useFocus();
  useEffect(() => setFocused(id), [id, setFocused]);
  return null;
}

function renderPanel({ focused }: { focused: boolean }) {
  const messages: AgentMessage[] = [{ id: "m1", role: "assistant", content: MESSAGE }];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResponsesProvider inits={[textInit()]}>
        <FocusProvider>
          {focused && <Focuser id={ITEM_ID} />}
          <AgentProvider docId="doc-1" enabled initialMessages={messages}>
            <AgentPanel />
          </AgentProvider>
        </FocusProvider>
      </ResponsesProvider>
    </QueryClientProvider>,
  );
}

/** The parsed body of the most recent autosave PUT. */
function lastPutBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe("SuggestionCard — Use this answer (§14, B-1)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a suggestion card alongside the surrounding prose", () => {
    renderPanel({ focused: true });
    // The prose outside the fence still renders…
    expect(screen.getByText(/some reasoning first/i)).toBeTruthy();
    // …and the fence becomes a distinct "Use this answer" card.
    expect(screen.getByRole("button", { name: /use this answer/i })).toBeTruthy();
    // The fence body is not double-rendered as a bare code block.
    expect(screen.queryByText("```wpsuggest")).toBeNull();
  });

  it("replaces the focused item's answer with the raw fence contents", async () => {
    renderPanel({ focused: true });

    fireEvent.click(screen.getByRole("button", { name: /use this answer/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe(`/api/items/${ITEM_ID}/response`);
    expect(init.method).toBe("PUT");
    // Replace semantics on a text item: the answer becomes exactly the raw
    // suggestion markdown — not the whole chat message, not HTML.
    expect(lastPutBody(fetchMock).value.text).toBe(SUGGESTION);

    // A brief confirmation flashes after the insert.
    expect(screen.getByRole("button", { name: /inserted/i })).toBeTruthy();
  });

  it("shows the focus-first hint and no active button when nothing is focused", () => {
    renderPanel({ focused: false });
    expect(screen.queryByRole("button", { name: /use this answer/i })).toBeNull();
    expect(screen.getAllByText(/focus a question to insert this into its answer/i).length).toBeGreaterThan(0);
  });

  it("leaves a message with no fence unaffected (no suggestion card)", () => {
    const messages: AgentMessage[] = [
      { id: "m1", role: "assistant", content: "Just a plain reply with no suggestion." },
    ];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ResponsesProvider inits={[textInit()]}>
          <FocusProvider>
            <Focuser id={ITEM_ID} />
            <AgentProvider docId="doc-1" enabled initialMessages={messages}>
              <AgentPanel />
            </AgentProvider>
          </FocusProvider>
        </ResponsesProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/just a plain reply/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /use this answer/i })).toBeNull();
  });
});
