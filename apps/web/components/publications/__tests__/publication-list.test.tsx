// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicationList } from "@/components/publications/publication-list";
import type { PublicationSummary } from "@/lib/publications";

beforeEach(() => {
  // jsdom has no IntersectionObserver; the list observes a sentinel for
  // scroll-loading. A no-op stub lets the component mount; the "Load more"
  // button drives pagination deterministically in tests.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function urls(id: string, name: string) {
  const base = `https://dropzone.tylersavery.com/smitty/shares/${id}/${name}`;
  return { html: `${base}.html`, pdf: `${base}.pdf`, md: `${base}.md` };
}

function makePub(overrides: Partial<PublicationSummary> = {}): PublicationSummary {
  const id = overrides.id ?? "id-1";
  return {
    id,
    title: "Alpha Doc",
    sanitizedName: "alpha-doc",
    origin: "cli",
    sourceHost: null,
    createdAt: "2026-07-08T00:00:00.000Z",
    revokedAt: null,
    revoked: false,
    urls: urls(id, "alpha-doc"),
    ...overrides,
  };
}

function renderList(initial: PublicationSummary[], initialNextOffset: number | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PublicationList initialPublications={initial} initialNextOffset={initialNextOffset} />
    </QueryClientProvider>,
  );
}

describe("PublicationList", () => {
  it("renders the server-seeded list in order with live artifact links", () => {
    renderList([
      makePub({ id: "a", title: "Alpha Doc" }),
      makePub({ id: "b", title: "Beta Doc" }),
    ]);

    const headings = screen.getAllByRole("link", { name: /Doc$/ }).map((el) => el.textContent);
    expect(headings).toEqual(["Alpha Doc", "Beta Doc"]);

    // A live row's HTML artifact is a real link opening R2 in a new tab.
    const html = screen.getAllByRole("link", { name: "HTML" })[0] as HTMLAnchorElement;
    expect(html.getAttribute("href")).toContain("/smitty/shares/a/alpha-doc.html");
    expect(html.getAttribute("target")).toBe("_blank");
  });

  it("marks a revoked row visually and drops its artifact links", () => {
    renderList([
      makePub({ id: "r", title: "Gone Doc", revoked: true, revokedAt: "2026-07-08T01:00:00.000Z" }),
    ]);

    expect(screen.getByText("revoked")).toBeTruthy();
    // The HTML artifact renders as muted text, not a clickable link, post-revoke.
    expect(screen.queryByRole("link", { name: "HTML" })).toBeNull();
    expect(screen.getByText("HTML").tagName).toBe("SPAN");
  });

  it("debounces the search box into GET ?q= and shows the filtered results", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const q = new URL(url, "http://localhost").searchParams.get("q") ?? "";
      const rows = q.includes("beta") ? [makePub({ id: "b", title: "Beta Doc" })] : [];
      return new Response(JSON.stringify({ publications: rows }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderList([
      makePub({ id: "a", title: "Alpha Doc" }),
      makePub({ id: "b", title: "Beta Doc" }),
    ]);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "beta" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      const called = fetchMock.mock.calls.some(([u]) => String(u).includes("q=beta"));
      expect(called).toBe(true);
    });

    // Results narrow to the match; the non-match drops out.
    await screen.findByRole("link", { name: "Beta Doc" });
    expect(screen.queryByRole("link", { name: "Alpha Doc" })).toBeNull();
  });

  it("shows a search-specific empty state when nothing matches", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ publications: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderList([makePub({ id: "a", title: "Alpha Doc" })]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

    await screen.findByText(/no matches/i);
  });

  it("shows the first-run empty state when there are no publications", () => {
    renderList([]);
    expect(screen.getByText(/no publications yet/i)).toBeTruthy();
    // Sanity: an empty row list still renders the search box (feature is live).
    expect(within(document.body).getByRole("searchbox")).toBeTruthy();
  });

  it("loads the next page and appends rows when there is more", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const offset = new URL(String(input), "http://localhost").searchParams.get("offset");
      // Page two (offset from the seeded first page); no more after it.
      const rows = offset === "25" ? [makePub({ id: "p2", title: "Page Two Doc" })] : [];
      return new Response(JSON.stringify({ publications: rows, nextOffset: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // A full first page (nextOffset=25) means "Load more" is offered.
    renderList([makePub({ id: "p1", title: "Page One Doc" })], 25);

    expect(screen.getByRole("link", { name: "Page One Doc" })).toBeTruthy();
    const loadMore = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(loadMore);

    // Page two appends; page one stays; the button disappears (nextOffset=null).
    await screen.findByRole("link", { name: "Page Two Doc" });
    expect(screen.getByRole("link", { name: "Page One Doc" })).toBeTruthy();
    const calledPage2 = fetchMock.mock.calls.some(([u]) => String(u).includes("offset=25"));
    expect(calledPage2).toBe(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: /load more/i })).toBeNull());
  });

  it("offers no 'Load more' when the first page is the last", () => {
    // A short first page (nextOffset=null) → no pagination control.
    renderList([makePub({ id: "only", title: "Only Doc" })], null);
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });
});
