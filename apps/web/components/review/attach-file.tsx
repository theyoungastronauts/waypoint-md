"use client";

import { useCallback, useRef, useState } from "react";
import { getHomeDir, normalizeToHome } from "@/lib/attach-path";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const entryClass =
  "flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";

type EntryType = "dir" | "file";
interface Entry {
  name: string;
  type: EntryType;
  path: string;
}
interface Listing {
  cwd: string;
  parent: string | null;
  entries: Entry[];
}

/**
 * "Add file/folder" affordance for an answer/elaboration field (§14, decision B-5).
 *
 * A browser `<input type="file">` exposes only the base filename, never the
 * absolute path (a security boundary), so a real OS picker can't produce a
 * usable `~/prj/foo.ts`. Since this app is self-hosted, we instead list the
 * filesystem *server-side* (`GET /api/fs/list`, rooted at and confined to the
 * server's home dir) and let the reviewer browse it in a small modal. Picking a
 * file hands its `~/…` path to `onInsert`, which splices it at the field's
 * caret. Folders are selectable too: a folder row still *navigates* into the
 * directory on click, while a trailing check affordance *selects* that folder's
 * path, and a "Use this folder" footer button selects the directory currently
 * being browsed. A manual "type a path instead" fallback is preserved for
 * pasting a path directly. Nothing is read or uploaded — the path is inserted
 * text so the reviewer's answer can point the agent at a file or folder.
 */
/** Small upload glyph (tray with an up-arrow) for the Attach file affordance. */
function UploadIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
    </svg>
  );
}

function UpIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

/** Check glyph marking the "select this folder" affordance on a folder row. */
function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function AttachFile({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [path, setPath] = useState("~/");
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (target: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(target ?? "")}`);
      if (!res.ok) throw new Error(`list failed (HTTP ${res.status})`);
      setListing((await res.json()) as Listing);
    } catch {
      // Fall back to a message; the "type a path instead" option stays available
      // so a reviewer can still attach a path on an unusual setup.
      setError("Couldn't open that folder.");
    } finally {
      setLoading(false);
    }
  }, []);

  const openBrowser = useCallback(() => {
    setOpen(true);
    setManual(false);
    setPath("~/");
    // Warm the home-dir cache so the first manual insert doesn't wait on it.
    void getHomeDir();
    void load(null);
  }, [load]);

  const close = useCallback(() => {
    setOpen(false);
    setManual(false);
    setPath("~/");
    setListing(null);
    setError(null);
    setLoading(false);
  }, []);

  // Insert a `~/…` path (a file, a folder entry, or the current directory) at
  // the caret and dismiss the modal. Files and folders are handled identically
  // — only the affordance that triggers the selection differs.
  const pickPath = useCallback(
    (target: string) => {
      onInsert(target);
      close();
    },
    [onInsert, close],
  );

  // "Use this folder": select the directory currently being browsed. `cwd` is
  // already the home-relative (`~/…`) path the server reported for this listing.
  const useCurrentFolder = useCallback(() => {
    if (!listing) return;
    pickPath(listing.cwd);
  }, [listing, pickPath]);

  // Manual fallback (Phase 3 behavior): normalize a typed/pasted path to `~/…`
  // against the server's home dir, then splice it at the caret.
  const submitManual = useCallback(async () => {
    const raw = path.trim();
    // Nothing meaningful typed beyond the seed — just dismiss.
    if (raw.length === 0 || raw === "~/" || raw === "~") {
      close();
      return;
    }
    const home = await getHomeDir();
    onInsert(normalizeToHome(raw, home));
    close();
  }, [path, onInsert, close]);

  const trigger = (
    <button
      type="button"
      onClick={openBrowser}
      title="Add file/folder"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/75 transition-colors hover:text-foreground"
    >
      <UploadIcon />
      <span className="underline underline-offset-2">Add file/folder</span>
    </button>
  );

  if (!open) return trigger;

  const entries = listing?.entries ?? [];

  return (
    <>
      {trigger}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Add a file or folder"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden />
        <div className="relative z-10 flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Add a file or folder</p>
              {!manual && (
                <p className="truncate text-xs text-muted-foreground" title={listing?.cwd}>
                  {listing?.cwd ?? "…"}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="shrink-0 rounded-md px-1.5 text-lg leading-none text-muted-foreground transition-colors hover:text-foreground"
            >
              ×
            </button>
          </div>

          {manual ? (
            <form
              className="flex flex-col gap-2 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submitManual();
              }}
            >
              <input
                ref={inputRef}
                autoFocus
                aria-label="File path to attach"
                className={inputClass}
                value={path}
                placeholder="~/path/to/file"
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    close();
                  }
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                >
                  Insert
                </button>
                <button
                  type="button"
                  onClick={() => setManual(false)}
                  className="shrink-0 text-xs font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  Browse files instead
                </button>
              </div>
            </form>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {error && <p className="px-4 py-2 text-xs text-destructive">{error}</p>}
              <ul className="min-h-0 flex-1 overflow-y-auto py-1">
                {listing?.parent != null && (
                  <li>
                    <button
                      type="button"
                      onClick={() => void load(listing.parent)}
                      aria-label="Up to parent folder"
                      className={cn(entryClass, "text-muted-foreground")}
                    >
                      <UpIcon />
                      <span>.. (up)</span>
                    </button>
                  </li>
                )}
                {loading && (
                  <li className="px-4 py-2 text-xs text-muted-foreground">Loading…</li>
                )}
                {!loading && !error && entries.length === 0 && (
                  <li className="px-4 py-2 text-xs text-muted-foreground">This folder is empty.</li>
                )}
                {entries.map((entry) =>
                  entry.type === "dir" ? (
                    // Folder: the row navigates *into* the directory; the
                    // trailing check selects that folder's path instead.
                    <li key={entry.path} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => void load(entry.path)}
                        className={cn(entryClass, "min-w-0 flex-1")}
                      >
                        <FolderIcon />
                        <span className="truncate">{entry.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => pickPath(entry.path)}
                        aria-label={`Select folder ${entry.name}`}
                        title="Select this folder"
                        className="mr-2 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <CheckIcon />
                      </button>
                    </li>
                  ) : (
                    // File: the whole row selects the file's path.
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => pickPath(entry.path)}
                        className={entryClass}
                      >
                        <FileIcon />
                        <span className="truncate">{entry.name}</span>
                      </button>
                    </li>
                  ),
                )}
              </ul>
              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
                <button
                  type="button"
                  onClick={() => setManual(true)}
                  className="text-xs font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  Type a path instead
                </button>
                <button
                  type="button"
                  onClick={useCurrentFolder}
                  disabled={!listing}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                >
                  Use this folder
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
