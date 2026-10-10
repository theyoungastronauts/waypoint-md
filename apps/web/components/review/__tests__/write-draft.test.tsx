// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Item } from "@waypoint/spec";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChoiceGroup } from "@/components/review/choice-group";
import { FocusProvider } from "@/components/review/focus-context";
import { ResponsesProvider, useResponses } from "@/components/review/responses-store";
import type { PersistedResponse, ReviewItemInit } from "@/components/review/types";

/**
 * `writeDraft` is the path Waypoint Voice writes spoken answers through: it must
 * autosave through the normal PUT, keep the status it is given (a spoken answer
 * clears a flag), and update the on-screen card — selection included.
 */

const ITEM_ID = "item-1";

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
  return { itemId: ITEM_ID, item, promptHtml: "Pick one", optionLabelsHtml: [], persisted, warnings: [] };
}

let api: ReturnType<typeof useResponses> | null = null;
function Probe() {
  api = useResponses();
  return null;
}

function renderWithProbe(persisted: PersistedResponse | null) {
  const init = makeInit(persisted);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResponsesProvider inits={[init]}>
        <FocusProvider>
          <ChoiceGroup itemId={ITEM_ID} item={init.item} optionLabelsHtml={[]} />
          <Probe />
        </FocusProvider>
      </ResponsesProvider>
    </QueryClientProvider>,
  );
}

describe("ResponsesProvider.writeDraft", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    api = null;
  });

  it("updates the on-screen selection and note, and autosaves with the given status", async () => {
    renderWithProbe({ value: { selected: ["Option A"] }, status: "flagged" });
    expect((screen.getByRole("radio", { name: /Option A/i }) as HTMLInputElement).checked).toBe(true);

    act(() => {
      api!.writeDraft(ITEM_ID, { text: "", selected: ["Option B"], other: "said on a call", status: "answered" });
    });

    expect((screen.getByRole("radio", { name: /Option B/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /Option A/i }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("said on a call");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(`/api/items/${ITEM_ID}/response`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      value: { selected: ["Option B"], other: "said on a call" },
      status: "answered",
    });
    expect(api!.statusOf(ITEM_ID)).toBe("answered");
  });
});
