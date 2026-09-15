// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PublicationDetailView } from "@/components/publications/publication-detail-view";
import { PublicationRow } from "@/components/publications/publication-row";
import type { MediaPublicationDetail, MediaPublicationSummary } from "@/lib/publications";

/**
 * How a media publication reads in the registry UI (decision B-4): a kind badge
 * that says what the file actually is, `group · label` for a version stack, the
 * file and manifest links, and a player on the detail page.
 */

afterEach(cleanup);

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const BASE = "https://dropzone.tylersavery.com/smitty/shares/med-1";

function makeMediaSummary(
  overrides: Partial<MediaPublicationSummary> = {},
): MediaPublicationSummary {
  return {
    id: "med-1",
    kind: "media",
    title: "vBTC Unwrapped",
    sanitizedName: "vbtc-unwrapped",
    origin: "cli",
    sourceHost: "studio.local",
    createdAt: "2026-09-14T00:00:00.000Z",
    revokedAt: null,
    revoked: false,
    contentType: "video/mp4",
    bytes: 262_144_000,
    group: "vbtc-unwrapped",
    label: "v2",
    finalizedAt: "2026-09-14T00:05:00.000Z",
    urls: { file: `${BASE}/vbtc-unwrapped.mp4`, manifest: `${BASE}/vbtc-unwrapped.manifest.json` },
    ...overrides,
  };
}

function makeMediaDetail(overrides: Partial<MediaPublicationDetail> = {}): MediaPublicationDetail {
  return {
    ...makeMediaSummary(),
    manifest: { composition: "wordmark-reveal", profile: "prores" },
    r2Folder: "smitty/shares/med-1",
    publicBase: "dropzone.tylersavery.com",
    ...overrides,
  };
}

describe("PublicationRow — media", () => {
  it("badges the kind, shows group · label, and links the file and manifest", () => {
    render(<PublicationRow pub={makeMediaSummary()} />);

    expect(screen.getByText("Video")).toBeTruthy();
    expect(screen.getByText("vbtc-unwrapped · v2")).toBeTruthy();

    const file = screen.getByRole("link", { name: "File" }) as HTMLAnchorElement;
    expect(file.getAttribute("href")).toBe(`${BASE}/vbtc-unwrapped.mp4`);
    const manifest = screen.getByRole("link", { name: "Manifest" }) as HTMLAnchorElement;
    expect(manifest.getAttribute("href")).toBe(`${BASE}/vbtc-unwrapped.manifest.json`);

    // The markdown artifact links belong to the other kind.
    expect(screen.queryByRole("link", { name: "HTML" })).toBeNull();
  });

  it("names the kind after the content type", () => {
    const { rerender } = render(
      <PublicationRow pub={makeMediaSummary({ contentType: "image/png" })} />,
    );
    expect(screen.getByText("Image")).toBeTruthy();

    rerender(<PublicationRow pub={makeMediaSummary({ contentType: "application/pdf" })} />);
    expect(screen.getByText("PDF")).toBeTruthy();
  });

  it("omits the manifest link when there is no manifest", () => {
    render(
      <PublicationRow
        pub={makeMediaSummary({ urls: { file: `${BASE}/x.mp4`, manifest: null } })}
      />,
    );
    expect(screen.queryByRole("link", { name: "Manifest" })).toBeNull();
  });

  it("strikes the links through on a revoked row", () => {
    render(<PublicationRow pub={makeMediaSummary({ revoked: true, revokedAt: "2026-09-14T01:00:00.000Z" })} />);
    expect(screen.queryByRole("link", { name: "File" })).toBeNull();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("revoked")).toBeTruthy();
  });
});

describe("PublicationDetailView — media", () => {
  it("plays the video, shows the size, and puts the manifest in a details block", () => {
    const { container } = renderWithQuery(<PublicationDetailView detail={makeMediaDetail()} />);

    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.getAttribute("src")).toBe(`${BASE}/vbtc-unwrapped.mp4`);
    expect(video?.hasAttribute("controls")).toBe(true);

    expect(screen.getByText("250.0 MB")).toBeTruthy();
    expect(screen.getByText("Render manifest")).toBeTruthy();
    expect(screen.getByText(/wordmark-reveal/)).toBeTruthy();
  });

  it("renders an image kind as an image and a pdf kind in a frame", () => {
    const { container, rerender } = renderWithQuery(
      <PublicationDetailView detail={makeMediaDetail({ contentType: "image/png", manifest: null })} />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(`${BASE}/vbtc-unwrapped.mp4`);
    expect(img?.getAttribute("alt")).toBe("vBTC Unwrapped");
    expect(screen.queryByText("Render manifest")).toBeNull();

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <PublicationDetailView detail={makeMediaDetail({ contentType: "application/pdf" })} />
      </QueryClientProvider>,
    );
    expect(container.querySelector("iframe")).toBeTruthy();
  });

  it("says so rather than showing a broken player when the upload never finalized", () => {
    const { container } = renderWithQuery(
      <PublicationDetailView detail={makeMediaDetail({ finalizedAt: null })} />,
    );
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText(/has not been finalized/)).toBeTruthy();
  });

  it("says so when the objects were deleted by a revoke", () => {
    const { container } = renderWithQuery(
      <PublicationDetailView
        detail={makeMediaDetail({ revoked: true, revokedAt: "2026-09-14T01:00:00.000Z" })}
      />,
    );
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText(/deleted from R2 when this publication was revoked/)).toBeTruthy();
  });

  it("names the media artifacts in the revoke confirmation, not HTML and PDF", () => {
    const { container } = renderWithQuery(<PublicationDetailView detail={makeMediaDetail()} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(container.textContent).toContain("deletes the file and manifest from R2");
  });
});
