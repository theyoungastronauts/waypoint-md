/**
 * Pure keyboard-navigation logic for the review view (§9). Kept free of React
 * and the DOM so the binding rules — especially the input-guard and the
 * `⌘⏎`-from-a-textarea exception — are unit-testable. {@link KeyboardNav} wires
 * these decisions to the focus + responses + agent stores.
 */

/** The abstract action a keystroke maps to, or `null` for "do nothing / pass through". */
export type KeyAction =
  | { type: "focusNext" }
  | { type: "focusPrev" }
  | { type: "flag" }
  | { type: "skip" }
  | { type: "markAnswered" }
  | { type: "focusAgent" }
  | { type: "toggleHelp" }
  | null;

/** The minimal keystroke shape {@link resolveKeyAction} needs (a subset of KeyboardEvent). */
export interface KeyContext {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** Whether the event target is a text-editing surface (input/textarea/contenteditable). */
  editable: boolean;
  /**
   * Whether the editable target is a question's answer field (inside an item
   * card). `⌘⏎` marks answered from an answer field but not from other editable
   * surfaces (e.g. the agent chat, which owns its own Enter behavior).
   */
  answerField: boolean;
  /** Whether the AI sidebar is available (§14) — gates the `a` binding. */
  aiEnabled: boolean;
}

/**
 * Map a keystroke to a review action (§9 bindings: `j`/`k` nav, `f` flag,
 * `x` skip, `⌘⏎` mark answered, `a` focus agent, `?` toggle the legend).
 *
 * Two rules matter most:
 *   1. **`⌘⏎` / `Ctrl+⏎` marks the focused item answered — even from inside an
 *      answer textarea.** This is the one deliberate exception to the guard, so a
 *      reviewer can commit an answer without leaving the field. It is scoped to
 *      answer fields: in another editable surface (the agent chat), which owns
 *      its own Enter handling, `⌘⏎` is left alone.
 *   2. **Every other binding is inert while typing** (`editable`) and never
 *      fires with a Cmd/Ctrl/Alt modifier held, so it can't shadow browser
 *      shortcuts (⌘A select-all, etc.) or corrupt text entry.
 */
export function resolveKeyAction(ctx: KeyContext): KeyAction {
  // (1) The answer-field exception: Cmd/Ctrl+Enter marks answered from anywhere
  // that isn't a *non-answer* editable surface (e.g. the agent chat input).
  if (ctx.key === "Enter" && (ctx.metaKey || ctx.ctrlKey)) {
    if (ctx.editable && !ctx.answerField) return null;
    return { type: "markAnswered" };
  }

  // (2) All plain bindings are suppressed while typing or with a chord modifier.
  if (ctx.editable) return null;
  if (ctx.metaKey || ctx.ctrlKey || ctx.altKey) return null;

  switch (ctx.key) {
    case "j":
      return { type: "focusNext" };
    case "k":
      return { type: "focusPrev" };
    case "f":
      return { type: "flag" };
    case "x":
      return { type: "skip" };
    case "a":
      return ctx.aiEnabled ? { type: "focusAgent" } : null;
    case "?":
      return { type: "toggleHelp" };
    default:
      return null;
  }
}

/**
 * The item id `j`/`k` should move focus to. Movement clamps at the ends (no
 * wraparound). With nothing focused, `j` picks the first item and `k` the last;
 * an unknown current id behaves the same, so focus is never left stranded.
 */
export function nextFocusId(
  order: string[],
  currentId: string | null,
  direction: 1 | -1,
): string | null {
  if (order.length === 0) return null;
  if (currentId === null) return direction === 1 ? order[0] : order[order.length - 1];

  const idx = order.indexOf(currentId);
  if (idx === -1) return direction === 1 ? order[0] : order[order.length - 1];

  const next = idx + direction;
  if (next < 0 || next >= order.length) return currentId; // clamp at the boundary
  return order[next];
}

/** Whether a DOM target is a text-editing surface that must swallow plain bindings. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true
  );
}
