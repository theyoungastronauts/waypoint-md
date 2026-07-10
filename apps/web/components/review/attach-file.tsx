"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getHomeDir, normalizeToHome } from "@/lib/attach-path";

const inputClass =
  "w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * "Attach file" affordance for an answer/elaboration field (§14, decision B-5).
 *
 * Reality check baked into the design: a browser `<input type="file">` exposes
 * only the base filename, never the absolute path (a security boundary), so a
 * real OS picker cannot produce a usable `~/prj/foo.ts`. The honest, working
 * affordance is therefore a small inline input — pre-seeded with `~/` — where
 * the path is typed or pasted. On submit the path is normalized to `~/…` against
 * the server's home dir and handed to `onInsert`, which splices it at the
 * field's caret. Nothing is read or uploaded: the path is literally inserted
 * text so the reviewer's answer can point the agent at a file.
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

export function AttachFile({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("~/");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Warm the home-dir cache the moment the field opens so the first submit
  // doesn't wait on the round-trip.
  useEffect(() => {
    if (open) void getHomeDir();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setPath("~/");
  }, []);

  const submit = useCallback(async () => {
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/75 transition-colors hover:text-foreground"
      >
        <UploadIcon />
        <span className="underline underline-offset-2">Attach file</span>
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
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
      <button
        type="submit"
        className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
      >
        Insert
      </button>
      <button
        type="button"
        onClick={close}
        className="shrink-0 text-xs font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
      >
        Cancel
      </button>
    </form>
  );
}
