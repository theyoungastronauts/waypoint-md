// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Item } from "@waypoint/spec";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChoiceGroup } from "@/components/review/choice-group";
import { FocusProvider } from "@/components/review/focus-context";
import { ResponsesProvider } from "@/components/review/responses-store";
import type { PersistedResponse, ReviewItemInit } from "@/components/review/types";

const ITEM_ID = "item-1";

/** A minimal single-select choice item with two options. */
function makeInit(persisted: PersistedResponse | null): ReviewItemInit {
  const item: Item = {
    wpId: "q1",
    type: "choice",
    select: "single",
    promptMd: "Pick one",
    options: [
      { label: "Option A", checked: false, marker: { start: 0, end: 3 } },
      { label: "Option B", checked: false, marker: { start: 0, end: 3 } },
    ],
    spans: { block: { start: 0, end: 0 }, questionOpen: { start: 0, end: 0 } },
  };
  return {
    itemId: ITEM_ID,
    item,
    promptHtml: "Pick one",
    optionLabelsHtml: [],
    persisted,
    warnings: [],
  };
}

function renderChoice(persisted: PersistedResponse | null) {
  const init = makeInit(persisted);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResponsesProvider inits={[init]}>
        <FocusProvider>
          <ChoiceGroup itemId={ITEM_ID} item={init.item} optionLabelsHtml={[]} />
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

describe("ChoiceGroup — clear selection (#3)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("clears the selection but leaves the elaboration text intact", () => {
    renderChoice({ value: { selected: ["Option A"], other: "my notes" }, status: "answered" });

    const radioA = screen.getByRole("radio", { name: /Option A/i }) as HTMLInputElement;
    expect(radioA.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));

    // Selection is emptied…
    expect((screen.getByRole("radio", { name: /Option A/i }) as HTMLInputElement).checked).toBe(false);
    // …and the "Clear selection" affordance disappears once nothing is picked.
    expect(screen.queryByRole("button", { name: /clear selection/i })).toBeNull();
    // …while the elaboration text is untouched (clearing must not wipe it).
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("my notes");
  });

  it("keeps status answered on clear when the elaboration still has content", async () => {
    renderChoice({ value: { selected: ["Option A"], other: "my notes" }, status: "answered" });

    fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastPutBody(fetchMock);
    expect(body.value.selected).toEqual([]);
    expect(body.value.other).toBe("my notes");
    // The elaboration is real content, so the item stays answered.
    expect(body.status).toBe("answered");
  });

  it("reverts to untouched (status null) when a selection-only item is cleared", async () => {
    renderChoice({ value: { selected: ["Option A"] }, status: "answered" });

    fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = lastPutBody(fetchMock);
    expect(body.value.selected).toEqual([]);
    // No selection and no elaboration ⇒ untouched (Phase 4 status derivation).
    expect(body.status).toBeNull();
  });
});
