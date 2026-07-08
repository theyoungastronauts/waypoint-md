"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useComments } from "./comments-store";

/**
 * The single floating layer for selection comments (§10): a "Comment" button
 * over a fresh selection, a composer popover, and a viewer/editor for an existing
 * comment. Positioned `fixed` at the selection/highlight rectangle. Rendered once
 * by the review view; every prose run drives it through the comments store.
 */
export function CommentLayer() {
  const { overlay, compose, closeOverlay, create, update, remove, comments } = useComments();
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;

  // Dismiss the transient "Comment" button once the selection is cleared.
  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if ((!sel || sel.isCollapsed) && overlayRef.current?.kind === "button") closeOverlay();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [closeOverlay]);

  if (!overlay) return null;

  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(overlay.rect.top + overlay.rect.height + 6, window.innerHeight - 8),
    left: Math.max(8, Math.min(overlay.rect.left, window.innerWidth - 340)),
    zIndex: 50,
  };

  if (overlay.kind === "button") {
    return (
      <div style={style}>
        <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={compose}>
          Comment
        </Button>
      </div>
    );
  }

  if (overlay.kind === "compose") {
    return (
      <div style={style}>
        <CommentComposer
          quoted={overlay.anchor.anchor.exact}
          onCancel={closeOverlay}
          onSubmit={async (bodyMd, suggestionMd) => {
            const ok = await create({ anchor: overlay.anchor.anchor, bodyMd, suggestionMd });
            if (ok) {
              window.getSelection()?.removeAllRanges();
              closeOverlay();
            }
            return ok;
          }}
        />
      </div>
    );
  }

  // kind === "view"
  const comment = comments.find((c) => c.id === overlay.commentId);
  if (!comment) return null;
  return (
    <div style={style}>
      <CommentViewer
        quoted={comment.anchor.exact}
        bodyMd={comment.bodyMd}
        suggestionMd={comment.suggestionMd}
        onClose={closeOverlay}
        onDelete={async () => {
          await remove(comment.id);
        }}
        onSave={async (bodyMd, suggestionMd) => update(comment.id, { bodyMd, suggestionMd })}
      />
    </div>
  );
}

const cardClass =
  "w-80 max-w-[90vw] space-y-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg";
const textareaClass =
  "w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Quote({ text }: { text: string }) {
  return (
    <p className="line-clamp-2 border-l-2 border-primary/50 pl-2 text-xs italic text-muted-foreground">“{text}”</p>
  );
}

function CommentComposer({
  quoted,
  onSubmit,
  onCancel,
  initialBody = "",
  initialSuggestion = "",
}: {
  quoted: string;
  onSubmit: (bodyMd: string, suggestionMd: string | null) => Promise<boolean>;
  onCancel: () => void;
  initialBody?: string;
  initialSuggestion?: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [suggestion, setSuggestion] = useState(initialSuggestion);
  const [showSuggestion, setShowSuggestion] = useState(initialSuggestion.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = body.trim().length > 0 || suggestion.trim().length > 0;

  const submit = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    const ok = await onSubmit(body, showSuggestion && suggestion.trim().length > 0 ? suggestion : null);
    setBusy(false);
    if (!ok) setError("Could not save. Try again.");
  };

  return (
    <div className={cardClass}>
      <Quote text={quoted} />
      <textarea
        autoFocus
        className={textareaClass}
        rows={3}
        placeholder="Add a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {showSuggestion ? (
        <textarea
          className={`${textareaClass} font-mono`}
          rows={2}
          placeholder="Suggested replacement text…"
          value={suggestion}
          onChange={(e) => setSuggestion(e.target.value)}
        />
      ) : (
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => setShowSuggestion(true)}
        >
          + Suggest an edit
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={!canSave || busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function CommentViewer({
  quoted,
  bodyMd,
  suggestionMd,
  onClose,
  onDelete,
  onSave,
}: {
  quoted: string;
  bodyMd: string;
  suggestionMd: string | null;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onSave: (bodyMd: string, suggestionMd: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <CommentComposer
        quoted={quoted}
        initialBody={bodyMd}
        initialSuggestion={suggestionMd ?? ""}
        onCancel={() => setEditing(false)}
        onSubmit={async (b, s) => {
          const ok = await onSave(b, s);
          if (ok) setEditing(false);
          return ok;
        }}
      />
    );
  }

  return (
    <div className={cardClass}>
      <Quote text={quoted} />
      {bodyMd.trim().length > 0 && <p className="whitespace-pre-wrap text-sm">{bodyMd}</p>}
      {suggestionMd && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Suggested edit
          </p>
          <p className="whitespace-pre-wrap font-mono text-xs">{suggestionMd}</p>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button size="sm" variant="destructive" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
