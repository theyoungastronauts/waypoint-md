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
import { __resetHomeCacheForTest } from "@/lib/attach-path";

const ITEM_ID = "item-1";
const HOME = "/Users/tester";
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

/** The parsed body of the most recent autosave PUT (ignores the /env/home GET). */
function lastPutBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = [...fetchMock.mock.calls].reverse().find(([url]) => String(url).includes("/api/items/"));
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe("Attach file — normalized path at the caret (decision B-5)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetHomeCacheForTest();
    fetchMock = vi.fn((url: string) =>
      String(url).includes("/api/env/home")
        ? Promise.resolve({ ok: true, json: async () => ({ home: HOME }) })
        : Promise.resolve({ ok: true, json: async () => ({}) }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("inserts a normalized ~/ path into an empty text answer and autosaves", async () => {
    renderWith(<QuestionCard itemId={ITEM_ID} />, textInit(null));

    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));
    fireEvent.click(screen.getByRole("button", { name: /type a path instead/i }));
    fireEvent.change(screen.getByLabelText(/file path to attach/i), {
      target: { value: "/Users/tester/prj/foo.ts" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^insert$/i }));

    const textarea = screen.getByPlaceholderText(/type your answer/i) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe("~/prj/foo.ts"));

    await waitFor(() => expect(lastPutBody(fetchMock).value.text).toBe("~/prj/foo.ts"));
  });

  it("splices the path at the caret inside existing text", async () => {
    renderWith(<QuestionCard itemId={ITEM_ID} />, textInit({ value: { text: "AB" }, status: "answered" }));

    const textarea = screen.getByPlaceholderText(/type your answer/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("AB");

    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));
    fireEvent.click(screen.getByRole("button", { name: /type a path instead/i }));
    // Caret between "A" and "B"; the retained selection is read at insert time.
    textarea.focus();
    textarea.setSelectionRange(1, 1);

    fireEvent.change(screen.getByLabelText(/file path to attach/i), {
      target: { value: "/Users/tester/x.ts" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^insert$/i }));

    await waitFor(() => expect(textarea.value).toBe("A~/x.tsB"));
  });

  it("leaves a path outside home absolute", async () => {
    renderWith(<QuestionCard itemId={ITEM_ID} />, textInit(null));

    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));
    fireEvent.click(screen.getByRole("button", { name: /type a path instead/i }));
    fireEvent.change(screen.getByLabelText(/file path to attach/i), {
      target: { value: "/etc/hosts" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^insert$/i }));

    const textarea = screen.getByPlaceholderText(/type your answer/i) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe("/etc/hosts"));
  });

  it("inserts into the choice elaboration field, never the selection", async () => {
    renderWith(
      <ChoiceGroup itemId={ITEM_ID} item={choiceInit(null).item} optionLabelsHtml={[]} />,
      choiceInit(null),
    );

    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));
    fireEvent.click(screen.getByRole("button", { name: /type a path instead/i }));
    fireEvent.change(screen.getByLabelText(/file path to attach/i), {
      target: { value: "/Users/tester/notes.md" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^insert$/i }));

    const elaboration = screen.getByPlaceholderText(/answer in your own words/i) as HTMLTextAreaElement;
    await waitFor(() => expect(elaboration.value).toBe("~/notes.md"));
    await waitFor(() => {
      const body = lastPutBody(fetchMock);
      expect(body.value.other).toBe("~/notes.md");
      expect(body.value.selected).toEqual([]);
    });
  });

  it("dismisses without inserting when nothing beyond the ~/ seed is entered", () => {
    renderWith(<QuestionCard itemId={ITEM_ID} />, textInit(null));

    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));
    fireEvent.click(screen.getByRole("button", { name: /type a path instead/i }));
    fireEvent.click(screen.getByRole("button", { name: /^insert$/i }));

    // Back to the collapsed affordance; the answer stays empty and nothing saved.
    expect(screen.getByRole("button", { name: /^add file\/folder$/i })).toBeTruthy();
    expect((screen.getByPlaceholderText(/type your answer/i) as HTMLTextAreaElement).value).toBe("");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/items/"))).toBe(false);
  });
});
