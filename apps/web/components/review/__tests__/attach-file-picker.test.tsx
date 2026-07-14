// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttachFile } from "@/components/review/attach-file";
import { __resetHomeCacheForTest } from "@/lib/attach-path";

const HOME = "/Users/tester";

const homeListing = {
  cwd: "~",
  parent: null,
  entries: [
    { name: "prj", type: "dir", path: "~/prj" },
    { name: "notes.md", type: "file", path: "~/notes.md" },
  ],
};

const prjListing = {
  cwd: "~/prj",
  parent: "~",
  entries: [{ name: "a.ts", type: "file", path: "~/prj/a.ts" }],
};

function ok(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => data });
}

describe("Attach file — server-side picker (decision B-5)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetHomeCacheForTest();
    fetchMock = vi.fn((url: string) => {
      const u = new URL(String(url), "http://localhost");
      if (u.pathname === "/api/env/home") return ok({ home: HOME });
      if (u.pathname === "/api/fs/list") {
        return ok(u.searchParams.get("path") === "~/prj" ? prjListing : homeListing);
      }
      return ok({});
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** All `/api/fs/list` request paths seen so far, in call order. */
  function listedPaths() {
    return fetchMock.mock.calls
      .map(([url]) => new URL(String(url), "http://localhost"))
      .filter((u) => u.pathname === "/api/fs/list")
      .map((u) => u.searchParams.get("path"));
  }

  it("opens the browser and lists folders (first) then files", async () => {
    render(<AttachFile onInsert={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));

    await waitFor(() => screen.getByRole("button", { name: /^prj$/ }));
    expect(screen.getByRole("button", { name: /notes\.md/ })).toBeTruthy();
    // The initial load requested the home root (empty path).
    expect(listedPaths()).toContain("");
  });

  it("navigates into a folder on name click without selecting it", async () => {
    const onInsert = vi.fn();
    render(<AttachFile onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));

    fireEvent.click(await screen.findByRole("button", { name: /^prj$/ }));

    // The subdir listing loads and its file appears.
    await waitFor(() => screen.getByRole("button", { name: /a\.ts/ }));
    expect(listedPaths()).toContain("~/prj");
    // A ".. (up)" entry is offered once below the home root.
    expect(screen.getByRole("button", { name: /up to parent folder/i })).toBeTruthy();
    // Navigation is not selection — nothing was inserted by opening the folder.
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("selects a folder via its trailing check affordance: inserts that folder's ~/ path", async () => {
    const onInsert = vi.fn();
    render(<AttachFile onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));

    fireEvent.click(await screen.findByRole("button", { name: /select folder prj/i }));

    expect(onInsert).toHaveBeenCalledWith("~/prj");
    // Modal dismissed; we never navigated into ~/prj (only the root was listed).
    await waitFor(() => expect(screen.queryByRole("button", { name: /select folder prj/i })).toBeNull());
    expect(listedPaths()).not.toContain("~/prj");
  });

  it("'Use this folder' inserts the current directory's ~/ path", async () => {
    const onInsert = vi.fn();
    render(<AttachFile onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));

    // Navigate into ~/prj, then use the directory currently being browsed.
    fireEvent.click(await screen.findByRole("button", { name: /^prj$/ }));
    await screen.findByRole("button", { name: /a\.ts/ });
    fireEvent.click(screen.getByRole("button", { name: /use this folder/i }));

    expect(onInsert).toHaveBeenCalledWith("~/prj");
    await waitFor(() => expect(screen.queryByRole("button", { name: /use this folder/i })).toBeNull());
  });

  it("navigates back up to the parent folder", async () => {
    render(<AttachFile onInsert={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));

    fireEvent.click(await screen.findByRole("button", { name: /^prj$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /up to parent folder/i }));

    // Back at home: the folder is listed again and the last request was "~".
    await waitFor(() => screen.getByRole("button", { name: /notes\.md/ }));
    expect(listedPaths()).toContain("~");
  });

  it("picks a file: calls onInsert with its ~/ path and closes", async () => {
    const onInsert = vi.fn();
    render(<AttachFile onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));

    fireEvent.click(await screen.findByRole("button", { name: /notes\.md/ }));

    expect(onInsert).toHaveBeenCalledWith("~/notes.md");
    // Modal dismissed — the file entry is gone, only the trigger remains.
    await waitFor(() => expect(screen.queryByRole("button", { name: /notes\.md/ })).toBeNull());
  });

  it("manual fallback: typing a path still inserts a normalized ~/ path", async () => {
    const onInsert = vi.fn();
    render(<AttachFile onInsert={onInsert} />);
    fireEvent.click(screen.getByRole("button", { name: /^add file\/folder$/i }));

    fireEvent.click(await screen.findByRole("button", { name: /type a path instead/i }));
    fireEvent.change(screen.getByLabelText(/file path to attach/i), {
      target: { value: "/Users/tester/x.ts" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^insert$/i }));

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith("~/x.ts"));
  });
});
