// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaReview } from "@/components/review-public/media-review";
import type { PublicComment, PublicReviewPayload } from "@/lib/review/public-view";

/**
 * How the public review page behaves for the person holding the link (decision
 * C-3): the reviewer's name is shown and not editable, notes render as plain
 * text, tapping a timecoded note seeks the player, a region mark appears when
 * its note is selected, and posting sends the token — never a name.
 */

/** The shape `fetch` is called with, so a mock's recorded calls stay typed. */
type FetchSignature = (url: string, init: RequestInit) => Promise<Response>;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TOKEN = "deadbeef".repeat(8);

function payload(overrides: Partial<PublicReviewPayload> = {}): PublicReviewPayload {
  return {
    reviewer: { name: "Jay" },
    publication: {
      id: "pub-1",
      title: "vBTC Unwrapped",
      contentType: "video/mp4",
      group: "vbtc-unwrapped",
      label: "v2",
      fileUrl: "https://dropzone.tylersavery.com/smitty/shares/pub-1/vbtc-unwrapped-v2.mp4",
      createdAt: "2026-09-14T00:00:00.000Z",
    },
    versions: [
      { id: "pub-0", label: "v1", title: "vBTC Unwrapped", createdAt: "2026-09-10T00:00:00.000Z", current: false },
      { id: "pub-1", label: "v2", title: "vBTC Unwrapped", createdAt: "2026-09-14T00:00:00.000Z", current: true },
    ],
    ...overrides,
  };
}

let seq = 0;
function comment(overrides: Partial<PublicComment> = {}): PublicComment {
  seq += 1;
  return {
    id: `c-${seq}`,
    ordinal: seq,
    authorName: "Jay",
    timecodeMs: null,
    region: null,
    body: "overall pace is right",
    createdAt: `2026-09-15T00:0${seq}:00.000Z`,
    resolved: false,
    ...overrides,
  };
}

function setup(comments: PublicComment[] = [], overrides: Partial<PublicReviewPayload> = {}) {
  return render(
    <MediaReview payload={payload(overrides)} initialComments={comments} token={TOKEN} />,
  );
}

describe("MediaReview", () => {
  it("names the reviewer from the link and offers no way to change it", () => {
    setup();
    expect(screen.getByText("Jay")).toBeTruthy();
    expect(screen.queryByLabelText(/your name/i)).toBeNull();
    expect(document.querySelector('input[name="name"]')).toBeNull();
  });

  it("renders note bodies as text — markup in a body is never interpreted", () => {
    const hostile = '<img src=x onerror=alert(1)> **not bold**';
    const { container } = setup([comment({ body: hostile })]);
    expect(screen.getByText(hostile)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  it("shows each note's anchor, and dims the resolved ones", () => {
    seq = 0;
    setup([
      comment({ timecodeMs: null }),
      comment({ timecodeMs: 12_400, body: "the wordmark lands too late here" }),
      comment({ timecodeMs: 31_050, body: "handled", resolved: true }),
    ]);
    expect(screen.getByText("general")).toBeTruthy();
    expect(screen.getByText("00:12.4")).toBeTruthy();

    const rows = screen.getAllByTestId("comment-row");
    expect(rows.map((r) => r.dataset.resolved)).toEqual(["false", "false", "true"]);
  });

  it("seeks the player when a timecoded note is tapped", () => {
    seq = 0;
    const { container } = setup([comment({ timecodeMs: 12_400 })]);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.currentTime).toBe(0);

    fireEvent.click(screen.getAllByTestId("comment-row")[0]);
    expect(video.currentTime).toBeCloseTo(12.4, 3);
  });

  it("shows a note's region mark when it is selected or the playhead reaches it", () => {
    seq = 0;
    const { container } = setup([
      comment({ timecodeMs: 12_400, region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }),
    ]);
    expect(screen.queryByTestId("region-mark")).toBeNull();

    // Selecting the note both seeks to it and draws its box.
    fireEvent.click(screen.getAllByTestId("comment-row")[0]);
    const mark = screen.getByTestId("region-mark");
    expect(mark.style.left).toBe("10%");
    expect(mark.style.width).toBe("30%");

    // Deselected, the box stays while the playhead is still parked on the note…
    fireEvent.click(screen.getAllByTestId("comment-row")[0]);
    expect(screen.getByTestId("region-mark")).toBeTruthy();

    // …and goes once the playhead moves out of the half-second window.
    const video = container.querySelector("video") as HTMLVideoElement;
    video.currentTime = 30;
    fireEvent.timeUpdate(video);
    expect(screen.queryByTestId("region-mark")).toBeNull();
  });

  it("links every version of the material, carrying the same token", () => {
    setup();
    const v1 = screen.getByRole("link", { name: "v1" }) as HTMLAnchorElement;
    expect(v1.getAttribute("href")).toBe(`/r/pub-0?k=${TOKEN}`);
    expect(screen.getByRole("link", { name: "v2" }).getAttribute("aria-current")).toBe("true");
  });

  it("posts a general note with the token and no name field", async () => {
    seq = 0;
    const posted = comment({ body: "overall pace is right" });
    const fetchMock = vi.fn<FetchSignature>(async () =>
      new Response(JSON.stringify({ comment: posted }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    setup();
    fireEvent.click(screen.getByRole("button", { name: "General note" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "overall pace is right" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post note" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/r/pub-1/comments");
    expect(JSON.parse(String(init.body))).toEqual({
      k: TOKEN,
      timecodeMs: null,
      region: null,
      body: "overall pace is right",
    });

    // The posted note joins the list without a refetch.
    await waitFor(() => expect(screen.getAllByTestId("comment-row")).toHaveLength(1));
  });

  it("anchors a timed note to the current playhead", async () => {
    seq = 0;
    const fetchMock = vi.fn<FetchSignature>(async () =>
      new Response(JSON.stringify({ comment: comment({ timecodeMs: 8_000 }) }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = setup();
    const video = container.querySelector("video") as HTMLVideoElement;
    video.currentTime = 8;
    fireEvent.timeUpdate(video);

    fireEvent.click(screen.getByRole("button", { name: "Note at 00:08.0" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tighten this" } });
    fireEvent.click(screen.getByRole("button", { name: "Post note" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body)).timecodeMs).toBe(8_000);
  });

  it("surfaces a refusal from the server instead of silently dropping the note", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: "rate_limited", message: "Too many comments." } }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    setup();
    fireEvent.click(screen.getByRole("button", { name: "General note" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "one more" } });
    fireEvent.click(screen.getByRole("button", { name: "Post note" }));

    await waitFor(() => expect(screen.getByText("Too many comments.")).toBeTruthy());
  });

  it("offers no timecode composer for a still — there is no playhead to anchor to", () => {
    setup([], {
      publication: {
        ...payload().publication,
        contentType: "image/png",
        fileUrl: "https://dropzone.tylersavery.com/smitty/shares/pub-1/still.png",
      },
    });
    expect(screen.queryByRole("button", { name: /^Note at/ })).toBeNull();
    expect(screen.getByRole("button", { name: "General note" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark region" })).toBeTruthy();
  });

  it("arms region mode on demand and tells the reviewer what to do", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Mark region" }));
    expect(screen.getByText(/Drag a box over the paused frame/)).toBeTruthy();
    expect(screen.getByTestId("region-overlay").className).toContain("cursor-crosshair");
  });
});
