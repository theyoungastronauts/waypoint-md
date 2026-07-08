"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useFocus } from "./focus-context";
import { useResponses } from "./responses-store";
import { useDebouncedCallback } from "./use-debounced-callback";

const AUTOSAVE_DELAY_MS = 800;

const textareaClass =
  "min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * A free-text question's answer field (§5.2). Seeds from the item's current
 * draft (persisted response, else the pre-filled draft embedded in `raw_md`),
 * autosaves on an 800 ms debounce, and flushes on blur so leaving the field
 * never drops the last keystroke.
 */
export function QuestionCard({ itemId }: { itemId: string }) {
  const { getDraft, saveContent, externalRev } = useResponses();
  const { setFocused } = useFocus();
  const [text, setText] = useState(() => getDraft(itemId).text);

  // Re-seed from the store when the answer is edited externally (§14 insert).
  const rev = externalRev(itemId);
  useEffect(() => {
    if (rev > 0) setText(getDraft(itemId).text);
    // getDraft is stable; re-run only when the external revision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  const save = useDebouncedCallback((next: string) => saveContent(itemId, { text: next }), AUTOSAVE_DELAY_MS);

  return (
    <textarea
      className={cn(textareaClass, "font-sans")}
      placeholder="Type your answer…"
      value={text}
      onFocus={() => setFocused(itemId)}
      onChange={(e) => {
        setText(e.target.value);
        save.call(e.target.value);
      }}
      onBlur={save.flush}
    />
  );
}
