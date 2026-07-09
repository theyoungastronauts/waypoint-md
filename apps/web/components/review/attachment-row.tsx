"use client";

import { useCallback, useState } from "react";
import {
  attachmentUrl,
  deleteAttachmentRequest,
  extractImageFiles,
  uploadAttachment,
  type AttachmentMeta,
} from "@/lib/attachments-client";

/**
 * Image attachments on an answer/elaboration field (§6, decision B-3). The
 * reviewer pastes a screenshot while the box is focused; the image uploads and
 * shows as a **removable thumbnail chip UNDER the box** — never inline in the
 * text. This hook owns the list + the paste handler; {@link AttachmentRow}
 * renders the chips. Non-image pastes fall through to the browser's normal text
 * paste (the handler only intercepts when it finds image blobs).
 */
export function useImageAttachments(itemId: string, initial: AttachmentMeta[]) {
  const [attachments, setAttachments] = useState<AttachmentMeta[]>(initial);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        try {
          const meta = await uploadAttachment(itemId, file);
          setAttachments((prev) => [...prev, meta]);
          setError(null);
        } catch {
          setError("Could not attach that image.");
        }
      }
    },
    [itemId],
  );

  const remove = useCallback(async (id: string) => {
    try {
      await deleteAttachmentRequest(id);
      setAttachments((prev) => prev.filter((a) => a.id !== id));
      setError(null);
    } catch {
      setError("Could not remove that attachment.");
    }
  }, []);

  /**
   * Paste handler for the textarea: if the clipboard holds image blobs, upload
   * them and stop the default (so image bytes never land as garbled text);
   * otherwise do nothing and let the normal text paste proceed.
   */
  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = extractImageFiles(event.clipboardData?.items);
      if (files.length === 0) return; // plain text/other paste — leave it alone
      event.preventDefault();
      void addFiles(files);
    },
    [addFiles],
  );

  return { attachments, addFiles, remove, onPaste, error };
}

/** The removable-thumbnail chip row rendered under an answer/elaboration box. */
export function AttachmentRow({
  attachments,
  onRemove,
  error,
}: {
  attachments: AttachmentMeta[];
  onRemove: (id: string) => void;
  error?: string | null;
}) {
  if (attachments.length === 0 && !error) return null;
  return (
    <div className="space-y-1.5">
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="group relative overflow-hidden rounded-md border border-border bg-muted/40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served bytes, not a static asset */}
              <img
                src={attachmentUrl(a.id)}
                alt={a.filename}
                className="h-16 w-16 object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${a.filename}`}
                onClick={() => onRemove(a.id)}
                className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-background/80 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:bg-background hover:text-foreground"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
