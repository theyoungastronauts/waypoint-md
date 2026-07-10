"use client";

import type { Item } from "@waypoint/spec";
import { useCallback, useEffect, useState } from "react";
import type { AttachmentMeta } from "@/lib/attachments-client";
import { cn } from "@/lib/utils";
import { AttachFile } from "./attach-file";
import { AttachmentRow, useImageAttachments } from "./attachment-row";
import { useCaretInsert } from "./caret-insert";
import { useFocus } from "./focus-context";
import { useResponses } from "./responses-store";
import { useDebouncedCallback } from "./use-debounced-callback";

const AUTOSAVE_DELAY_MS = 800;

const textareaClass =
  "min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * A choice question (§5.3, ratified semantics): `select="single"` renders as a
 * radio group, `select="multi"` as checkboxes. Every card carries an
 * always-visible elaboration field mapping to the `wp:answer` block, so a
 * text-only response with no box checked is valid and answerable. Selections
 * save immediately (a discrete click); elaboration autosaves on a debounce.
 */
export function ChoiceGroup({
  itemId,
  item,
  optionLabelsHtml,
  rationaleHtml,
  attachments = [],
}: {
  itemId: string;
  item: Item;
  optionLabelsHtml: string[];
  rationaleHtml?: string;
  attachments?: AttachmentMeta[];
}) {
  const { getDraft, saveContent, externalRev } = useResponses();
  const { setFocused } = useFocus();
  const multi = item.select === "multi";
  const options = item.options ?? [];
  const images = useImageAttachments(itemId, attachments);

  const [selected, setSelected] = useState<string[]>(() => getDraft(itemId).selected);
  const [other, setOther] = useState(() => getDraft(itemId).other);

  // Re-seed the elaboration field when it is edited externally (§14 insert).
  const rev = externalRev(itemId);
  useEffect(() => {
    if (rev > 0) setOther(getDraft(itemId).other);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  const saveOther = useDebouncedCallback(
    (next: string) => saveContent(itemId, { other: next }),
    AUTOSAVE_DELAY_MS,
  );

  // Caret insert (Attach file, §14): cancel the queued keystroke save so its
  // older value can't clobber the splice, then persist the new value now.
  const applyOther = useCallback(
    (next: string) => {
      saveOther.cancel();
      setOther(next);
      saveContent(itemId, { other: next });
    },
    [saveOther, saveContent, itemId],
  );
  const { textareaRef, insertAtCaret } = useCaretInsert(applyOther);

  const commitSelection = (next: string[]) => {
    setSelected(next);
    saveContent(itemId, { selected: next });
  };

  const onToggle = (label: string) => {
    setFocused(itemId);
    if (multi) {
      commitSelection(selected.includes(label) ? selected.filter((l) => l !== label) : [...selected, label]);
    } else {
      commitSelection([label]);
    }
  };

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5" role={multi ? "group" : "radiogroup"}>
        {options.map((option, i) => {
          const checked = selected.includes(option.label);
          return (
            <li key={i}>
              <label
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors",
                  checked ? "border-primary/60 bg-primary/5" : "border-transparent hover:bg-accent/50",
                )}
              >
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={multi ? undefined : `choice-${itemId}`}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={checked}
                  onFocus={() => setFocused(itemId)}
                  onChange={() => onToggle(option.label)}
                />
                {optionLabelsHtml[i] !== undefined ? (
                  // Inline markdown, sanitized server-side (W2): restores bold/code/
                  // links in labels. The label source string stays the value key.
                  // min-w-0 lets this flex item shrink so a long label wraps
                  // instead of overflowing the card and being clipped to one line.
                  <span
                    className="wp-prose-inline min-w-0 flex-1"
                    dangerouslySetInnerHTML={{ __html: optionLabelsHtml[i] }}
                  />
                ) : (
                  <span className="min-w-0 flex-1">{option.label}</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      {selected.length > 0 && (
        <div className="-mt-2 flex items-baseline gap-2">
          <button
            type="button"
            onClick={() => commitSelection([])}
            className="text-xs font-medium text-foreground/75 underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Clear selection
          </button>
          <span className="text-xs text-muted-foreground">— none of these, answer below instead.</span>
        </div>
      )}

      {rationaleHtml && (
        // Author's "why this option" note (SPEC 1.1.0), read-only. It is context
        // the doc producer supplied for the pre-checked option — never the
        // reviewer's answer, which lives in the editable elaboration box below.
        <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Why I suggested this
          </span>
          <div
            className="wp-prose text-sm text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: rationaleHtml }}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Elaboration {options.length > 0 && <span className="font-normal normal-case">(optional)</span>}
          </span>
          <textarea
            ref={textareaRef}
            className={textareaClass}
            placeholder={
              options.length > 0
                ? "Add context, or answer in your own words instead of choosing…"
                : "Type your answer…"
            }
            value={other}
            onFocus={() => setFocused(itemId)}
            onChange={(e) => {
              setOther(e.target.value);
              saveOther.call(e.target.value);
            }}
            onPaste={images.onPaste}
            onBlur={saveOther.flush}
          />
        </label>
        <AttachmentRow attachments={images.attachments} onRemove={images.remove} error={images.error} />
        <AttachFile onInsert={insertAtCaret} />
      </div>
    </div>
  );
}
