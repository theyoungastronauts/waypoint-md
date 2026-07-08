// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AgentProvider } from "@/components/review/agent-store";
import { FocusProvider } from "@/components/review/focus-context";
import { ResponsesProvider } from "@/components/review/responses-store";
import { ReviewRail } from "@/components/review/review-rail";

afterEach(cleanup);

/** Mount the rail with the minimal provider tree, toggling the AI capability. */
function renderRail(aiEnabled: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResponsesProvider inits={[]}>
        <FocusProvider>
          <AgentProvider docId="doc-1" enabled={aiEnabled} initialMessages={[]}>
            <ReviewRail docId="doc-1" onFinish={() => {}} />
          </AgentProvider>
        </FocusProvider>
      </ResponsesProvider>
    </QueryClientProvider>,
  );
}

describe("AI sidebar degradation rendering (§14)", () => {
  it("renders the Agent tab when AI is enabled", () => {
    renderRail(true);
    expect(screen.getByRole("tab", { name: /agent/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /items/i })).toBeTruthy();
  });

  it("shows the chat panel when the Agent tab is selected", () => {
    renderRail(true);
    fireEvent.click(screen.getByRole("tab", { name: /agent/i }));
    expect(screen.getByText(/ask about this document/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/ask about this document/i)).toBeTruthy();
  });

  it("hides the Agent tab entirely when AI is disabled", () => {
    renderRail(false);
    expect(screen.queryByRole("tab", { name: /agent/i })).toBeNull();
    // With no key there is no tab bar at all — just the items panel.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText(/download annotated/i)).toBeTruthy();
  });
});
