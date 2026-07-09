// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Item } from "@waypoint/spec";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChoiceGroup } from "@/components/review/choice-group";
import { QuestionCard } from "@/components/review/question-card";
import { FocusProvider } from "@/components/review/focus-context";
import { ResponsesProvider } from "@/components/review/responses-store";
import type { AttachmentMeta } from "@/lib/attachments-client";
import type { PersistedResponse, ReviewItemInit } from "@/components/review/types";

const ITEM_ID = "item-1";
const ZERO_SPANS = { block: { start: 0, end: 0 }, questionOpen: { start: 0, end: 0 } };

function textInit(attachments: AttachmentMeta[], persisted: PersistedResponse | null = null): ReviewItemInit {
  const item: Item = { wpId: "q1", type: "text", promptMd: "Your answer?", spans: ZERO_SPANS };
  return { itemId: ITEM_ID, item, promptHtml: "Your answer?", optionLabelsHtml: [], persisted, warnings: [], attachments };
}

function choiceInit(attachments: AttachmentMeta[]): ReviewItemInit {
  const item: Item = {
    wpId: "q1",
    type: "choice",
    select: "single",
    promptMd: "Pick one",
    options: [{ label: "Option A", checked: false, marker: { start: 0, end: 3 } }],
    spans: ZERO_SPANS,
  };
  return { itemId: ITEM_ID, item, promptHtml: "Pick one", optionLabelsHtml: [], persisted: null, warnings: [], attachments };
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

const oneAttachment: AttachmentMeta[] = [{ id: "att-1", filename: "shot.png", mime: "image/png" }];

describe("AttachmentRow — removable thumbnails under the box", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders an initial attachment as a thumbnail chip under a text answer", () => {
    renderWith(<QuestionCard itemId={ITEM_ID} attachments={oneAttachment} />, textInit(oneAttachment));
    const img = screen.getByAltText("shot.png") as HTMLImageElement;
    expect(img.src).toContain("/api/attachments/att-1");
    expect(screen.getByRole("button", { name: /remove shot.png/i })).toBeTruthy();
  });

  it("renders chips on a choice elaboration too", () => {
    renderWith(<ChoiceGroup itemId={ITEM_ID} item={choiceInit(oneAttachment).item} optionLabelsHtml={[]} attachments={oneAttachment} />, choiceInit(oneAttachment));
    expect(screen.getByAltText("shot.png")).toBeTruthy();
  });

  it("clicking × deletes the attachment (DELETE) and removes the chip", async () => {
    renderWith(<QuestionCard itemId={ITEM_ID} attachments={oneAttachment} />, textInit(oneAttachment));

    fireEvent.click(screen.getByRole("button", { name: /remove shot.png/i }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url).includes("/api/attachments/att-1") && (init as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByAltText("shot.png")).toBeNull());
  });

  it("renders nothing when there are no attachments", () => {
    renderWith(<QuestionCard itemId={ITEM_ID} attachments={[]} />, textInit([]));
    expect(screen.queryByRole("img")).toBeNull();
  });
});
