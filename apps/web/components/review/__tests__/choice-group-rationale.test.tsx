// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Item } from "@waypoint/spec";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChoiceGroup } from "@/components/review/choice-group";
import { FocusProvider } from "@/components/review/focus-context";
import { ResponsesProvider } from "@/components/review/responses-store";
import type { ReviewItemInit } from "@/components/review/types";

const ITEM_ID = "item-1";

/** A single-select choice with a pre-checked option carrying an embedded answer draft. */
function makeItem(): Item {
  return {
    wpId: "db",
    type: "choice",
    select: "single",
    promptMd: "Which database?",
    options: [
      { label: "Postgres", checked: false, marker: { start: 0, end: 3 } },
      { label: "SQLite", checked: true, marker: { start: 0, end: 3 } },
    ],
    // Under SPEC 1.1.0 this embedded elaboration must NOT prefill the box.
    response: { selected: ["SQLite"], other: "leftover agent rationale" },
    rationale: "SQLite keeps the single-binary deploy story intact.",
    spans: { block: { start: 0, end: 0 }, questionOpen: { start: 0, end: 0 } },
  };
}

function renderChoice(rationaleHtml?: string) {
  const item = makeItem();
  const init: ReviewItemInit = {
    itemId: ITEM_ID,
    item,
    promptHtml: "Which database?",
    optionLabelsHtml: [],
    rationaleHtml,
    persisted: null,
    warnings: [],
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResponsesProvider inits={[init]}>
        <FocusProvider>
          <ChoiceGroup
            itemId={ITEM_ID}
            item={item}
            optionLabelsHtml={[]}
            rationaleHtml={rationaleHtml}
          />
        </FocusProvider>
      </ResponsesProvider>
    </QueryClientProvider>,
  );
}

describe("ChoiceGroup — rationale + empty elaboration (SPEC 1.1.0)", () => {
  afterEach(() => cleanup());

  it("renders the author rationale read-only, not as an editable field", () => {
    renderChoice("<p>SQLite keeps the single-binary deploy story intact.</p>");
    expect(screen.getByText(/Why I suggested this/i)).toBeTruthy();
    expect(screen.getByText(/single-binary deploy story/i)).toBeTruthy();
    // The only editable control is the elaboration textarea — the rationale is inert.
    const textboxes = screen.getAllByRole("textbox");
    expect(textboxes).toHaveLength(1);
    expect((textboxes[0] as HTMLTextAreaElement).value).not.toContain("single-binary");
  });

  it("defaults the elaboration box empty even when wp:answer had draft content", () => {
    renderChoice();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    // The pre-checked option is still reflected in the selection.
    expect((screen.getByRole("radio", { name: /SQLite/i }) as HTMLInputElement).checked).toBe(true);
  });

  it("omits the rationale note when no rationale is present", () => {
    renderChoice(undefined);
    expect(screen.queryByText(/Why I suggested this/i)).toBeNull();
  });
});
