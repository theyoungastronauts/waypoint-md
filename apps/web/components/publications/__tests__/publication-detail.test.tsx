// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicationDetailView } from "@/components/publications/publication-detail-view";
import type { PublicationDetail } from "@/lib/publications";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Detail view calls useQueryClient (to invalidate the list on revoke), so it
 *  needs a provider in tests. */
function renderDetail(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function makeDetail(overrides: Partial<PublicationDetail> = {}): PublicationDetail {
  const id = overrides.id ?? "pub-1";
  const base = `https://dropzone.tylersavery.com/smitty/shares/${id}/plan`;
  return {
    id,
    title: "The Plan",
    sanitizedName: "plan",
    origin: "cli",
    sourceHost: "mini.local",
    createdAt: "2026-07-08T00:00:00.000Z",
    revokedAt: null,
    revoked: false,
    urls: { html: `${base}.html`, pdf: `${base}.pdf`, md: `${base}.md` },
    sourceMd: "# The Plan\n\nbody",
    r2Folder: `smitty/shares/${id}`,
    publicBase: "dropzone.tylersavery.com",
    ...overrides,
  };
}

describe("PublicationDetailView", () => {
  it("renders metadata, artifact links, and the rendered source body", () => {
    renderDetail(<PublicationDetailView detail={makeDetail()} bodyHtml="<p>rendered body content</p>" />);

    expect(screen.getByRole("heading", { level: 1, name: "The Plan" })).toBeTruthy();
    expect(screen.getByText("CLI")).toBeTruthy();
    expect(screen.getByText("mini.local")).toBeTruthy();
    const html = screen.getByRole("link", { name: "HTML" }) as HTMLAnchorElement;
    expect(html.getAttribute("href")).toContain("/plan.html");
    // The pre-rendered body HTML is injected.
    expect(screen.getByText("rendered body content")).toBeTruthy();
  });

  it("revokes behind a two-click confirm and reflects the revoked state in place", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ publication: { revoked: true, revokedAt: "2026-07-09T00:00:00.000Z" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderDetail(<PublicationDetailView detail={makeDetail()} bodyHtml="<p>body</p>" />);

    // First click surfaces the inline confirm — no request yet.
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(screen.getByText(/revoke this publication\?/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    // Confirm click fires the POST to the revoke endpoint.
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/publications/pub-1/revoke");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");

    // The view reflects revoked without a reload: note shown, links dead, no button.
    await screen.findByText(/were deleted from R2/i);
    expect(screen.getByText("revoked")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "HTML" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("cancels the confirm without revoking", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderDetail(<PublicationDetailView detail={makeDetail()} bodyHtml="<p>body</p>" />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/revoke this publication\?/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("presents an already-revoked publication as revoked with no revoke control", () => {
    renderDetail(
      <PublicationDetailView
        detail={makeDetail({ revoked: true, revokedAt: "2026-07-08T01:00:00.000Z" })}
        bodyHtml="<p>body</p>"
      />,
    );

    expect(screen.getByText("revoked")).toBeTruthy();
    expect(screen.getByText(/were deleted from R2/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
    expect(screen.queryByRole("link", { name: "HTML" })).toBeNull();
  });
});
