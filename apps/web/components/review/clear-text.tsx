"use client";

/**
 * "Clear text" affordance for an answer/elaboration field, last in the action
 * row after Add file/folder and Voice. Hand-erasing a filled field is tedious
 * on a phone (hold delete / fiddly select-all), so this empties it in one tap.
 * The caller's `onClear` runs the card's immediate-save path (same as caret
 * insert — cancel the queued keystroke save, persist "" now) and refocuses the
 * textarea so a replacement can be typed or dictated right away. Renders
 * nothing while the field is already empty, mirroring how "Clear selection"
 * only appears once something is picked.
 */

/** X glyph, sized to match the row's 12px action icons. */
function XIcon() {
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function ClearText({ value, onClear }: { value: string; onClear: () => void }) {
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={onClear}
      title="Clear text"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/75 transition-colors hover:text-foreground"
    >
      <XIcon />
      <span className="underline underline-offset-2">Clear text</span>
    </button>
  );
}
