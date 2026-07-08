"use client";

import type { Item } from "@waypoint/spec";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
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
}: {
  itemId: string;
  item: Item;
  optionLabelsHtml: string[];
}) {
  const { getDraft, saveContent, externalRev } = useResponses();
  const { setFocused } = useFocus();
  const multi = item.select === "multi";
  const options = item.options ?? [];

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
                  <span className="wp-prose-inline" dangerouslySetInnerHTML={{ __html: optionLabelsHtml[i] }} />
                ) : (
                  <span>{option.label}</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      <label className="block space-y-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Elaboration {options.length > 0 && <span className="font-normal normal-case">(optional)</span>}
        </span>
        <textarea
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
          onBlur={saveOther.flush}
        />
      </label>
    </div>
  );
}
