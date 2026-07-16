// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Item } from "@waypoint/spec";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChoiceGroup } from "@/components/review/choice-group";
import { FocusProvider } from "@/components/review/focus-context";
import { QuestionCard } from "@/components/review/question-card";
import { ResponsesProvider } from "@/components/review/responses-store";
import type { PersistedResponse, ReviewItemInit } from "@/components/review/types";

const ITEM_ID = "item-1";
const ZERO_SPANS = { block: { start: 0, end: 0 }, questionOpen: { start: 0, end: 0 } };

function textInit(persisted: PersistedResponse | null): ReviewItemInit {
  const item: Item = { wpId: "q1", type: "text", promptMd: "Your answer?", spans: ZERO_SPANS };
  return { itemId: ITEM_ID, item, promptHtml: "Your answer?", optionLabelsHtml: [], persisted, warnings: [] };
}

function choiceInit(persisted: PersistedResponse | null): ReviewItemInit {
  const item: Item = {
    wpId: "q1",
    type: "choice",
    select: "single",
    promptMd: "Pick one",
    options: [{ label: "Option A", checked: false, marker: { start: 0, end: 3 } }],
    spans: ZERO_SPANS,
  };
  return { itemId: ITEM_ID, item, promptHtml: "Pick one", optionLabelsHtml: [], persisted, warnings: [] };
}

function renderWith(node: ReactNode, init: ReviewItemInit) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResponsesProvider inits={[init]}>
        <FocusProvider>{node}</FocusProvider>
      </ResponsesProvider>
    </QueryClientProvider>,
  );
}

/** The parsed body of the most recent autosave PUT. */
function lastPutBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = [...fetchMock.mock.calls].reverse().find(([url]) => String(url).includes("/api/items/"));
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe("ClearText — one-tap clear on the answer/elaboration fields", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("is hidden while the answer field is empty", () => {
    renderWith(<QuestionCard itemId={ITEM_ID} />, textInit(null));
    expect(screen.queryByRole("button", { name: /clear text/i })).toBeNull();
  });

  it("clears the answer, persists the empty value immediately, and refocuses the field", async () => {
    renderWith(<QuestionCard itemId={ITEM_ID} />, textInit({ value: { text: "old draft" }, status: "answered" }));

    const textarea = screen.getByPlaceholderText(/type your answer/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("old draft");

    fireEvent.click(screen.getByRole("button", { name: /clear text/i }));

    expect(textarea.value).toBe("");
    // Immediate save (applyValue path), not the 800 ms keystroke debounce. On
    // the wire a cleared field is *absent* (draftToBody sends text only when
    // non-empty), and clearing the only content reverts the item to untouched.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastPutBody(fetchMock);
    expect(body.value).not.toHaveProperty("text");
    expect(body.status).toBeNull();
    // Refocused so a replacement can be typed/dictated right away…
    expect(document.activeElement).toBe(textarea);
    // …and the affordance is gone until there is text to clear again.
    expect(screen.queryByRole("button", { name: /clear text/i })).toBeNull();
  });

  it("appears once the reviewer types, without waiting for a save", () => {
    renderWith(<QuestionCard itemId={ITEM_ID} />, textInit(null));

    const textarea = screen.getByPlaceholderText(/type your answer/i);
    fireEvent.change(textarea, { target: { value: "started typing" } });

    expect(screen.getByRole("button", { name: /clear text/i })).toBeTruthy();
  });

  it("clears the elaboration but leaves the selection intact (mirror of Clear selection)", async () => {
    const init = choiceInit({ value: { selected: ["Option A"], other: "my notes" }, status: "answered" });
    renderWith(<ChoiceGroup itemId={ITEM_ID} item={init.item} optionLabelsHtml={[]} />, init);

    fireEvent.click(screen.getByRole("button", { name: /clear text/i }));

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("radio", { name: /Option A/i }) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastPutBody(fetchMock);
    // Cleared elaboration is absent on the wire (draftToBody); the selection rides along.
    expect(body.value).not.toHaveProperty("other");
    expect(body.value.selected).toEqual(["Option A"]);
    // The selection is still real content, so the item stays answered.
    expect(body.status).toBe("answered");
  });
});
