// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaCommentsPanel } from "@/components/publications/media-comments-panel";
import { ReviewLinksPanel, type ReviewLinkRowView } from "@/components/publications/review-links-panel";
import { SiteHeader } from "@/components/site-header";
import type { MediaCommentView } from "@/lib/review/comments";

/**
 * The authoring side of the review loop (decision C-4) and the one piece of
 * chrome the public surface must not carry.
 */

const pathname = vi.hoisted(() => ({ value: "/publications/pub-1" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

/** The shape `fetch` is called with, so a mock's recorded calls stay typed. */
type FetchSignature = (url: string, init: RequestInit) => Promise<Response>;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  pathname.value = "/publications/pub-1";
});

function link(overrides: Partial<ReviewLinkRowView> = {}): ReviewLinkRowView {
  return {
    id: "link-1",
    reviewerName: "Jay",
    token: "abc123",
    createdAt: "2026-09-15T00:00:00.000Z",
    revokedAt: null,
    lastSeenAt: null,
    revoked: false,
    url: "https://review.tylersavery.com/r/pub-1?k=abc123",
    ...overrides,
  };
}

function note(overrides: Partial<MediaCommentView> = {}): MediaCommentView {
  return {
    id: "c-1",
    ordinal: 1,
    authorName: "Jay",
    timecodeMs: 12_400,
    region: null,
    body: "the wordmark lands too late here",
    createdAt: "2026-09-15T00:00:00.000Z",
    resolved: false,
    resolvedAt: null,
    viaLink: true,
    ...overrides,
  };
}

describe("ReviewLinksPanel", () => {
  it("shows each link's reviewer and full URL", () => {
    render(
      <ReviewLinksPanel
        publicationId="pub-1"
        initialLinks={[link()]}
        publicBase="https://review.tylersavery.com"
      />,
    );
    expect(screen.getByText("Jay")).toBeTruthy();
    expect(screen.getByText("https://review.tylersavery.com/r/pub-1?k=abc123")).toBeTruthy();
    expect(screen.getByText(/never opened/)).toBeTruthy();
  });

  it("says so when no public host is configured", () => {
    render(<ReviewLinksPanel publicationId="pub-1" initialLinks={[]} publicBase={null} />);
    expect(screen.getByText(/WAYPOINT_REVIEW_PUBLIC_URL is not set/)).toBeTruthy();
  });

  it("creates a link for a named reviewer", async () => {
    const created = link({ id: "link-2", reviewerName: "Aaron", token: "def456" });
    const fetchMock = vi.fn<FetchSignature>(async () =>
      new Response(JSON.stringify({ link: created }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewLinksPanel publicationId="pub-1" initialLinks={[]} publicBase={null} />);
    fireEvent.change(screen.getByLabelText("Reviewer name"), { target: { value: "Aaron" } });
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/publications/pub-1/review-links");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Aaron" });
    await waitFor(() => expect(screen.getByText("Aaron")).toBeTruthy());
  });

  it("revokes a link in place, leaving the row visible as revoked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ link: link({ revoked: true, revokedAt: "2026-09-15T01:00:00.000Z" }) }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(<ReviewLinksPanel publicationId="pub-1" initialLinks={[link()]} publicBase={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(screen.getByTestId("review-link").dataset.revoked).toBe("true"),
    );
    // A revoked link offers no copy or revoke action any more.
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });
});

describe("MediaCommentsPanel", () => {
  it("numbers notes the way the digest does and counts what is open", () => {
    render(
      <MediaCommentsPanel
        publicationId="pub-1"
        initialComments={[note(), note({ id: "c-2", ordinal: 2, resolved: true, body: "done" })]}
      />,
    );
    expect(screen.getByText("c1")).toBeTruthy();
    expect(screen.getByText("c2")).toBeTruthy();
    expect(screen.getAllByText("00:12.4")).toHaveLength(2);
    expect(screen.getByText("1 unresolved of 2")).toBeTruthy();
    expect(screen.getAllByTestId("media-comment")[1].dataset.resolved).toBe("true");
  });

  it("resolves a note and flips the control to reopen it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ comment: note({ resolved: true, resolvedAt: "2026-09-15T01:00:00.000Z" }) }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(<MediaCommentsPanel publicationId="pub-1" initialComments={[note()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy());
    expect(screen.getByText("0 unresolved of 1")).toBeTruthy();
  });

  it("renders a note body as text, never as markup", () => {
    const { container } = render(
      <MediaCommentsPanel
        publicationId="pub-1"
        initialComments={[note({ body: "<b>bold</b>" })]}
      />,
    );
    expect(screen.getByText("<b>bold</b>")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("SiteHeader", () => {
  it("renders the authoring nav on authoring pages", () => {
    render(<SiteHeader publish />);
    expect(screen.getByRole("link", { name: "Publications" })).toBeTruthy();
  });

  it("hides the Publications link when publishing is not configured", () => {
    render(<SiteHeader publish={false} />);
    expect(screen.queryByRole("link", { name: "Publications" })).toBeNull();
  });

  it("disappears entirely on the public review surface", () => {
    pathname.value = "/r/pub-1";
    const { container } = render(<SiteHeader publish />);
    expect(container.innerHTML).toBe("");
  });
});
