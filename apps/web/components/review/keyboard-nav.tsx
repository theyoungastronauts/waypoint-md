"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAgent } from "./agent-store";
import { useFocus } from "./focus-context";
import { isEditableTarget, nextFocusId, resolveKeyAction } from "./keyboard";
import { useResponses } from "./responses-store";

/**
 * Desktop keyboard navigation over the focused-item model (§9). A single
 * document-level listener maps keystrokes to focus moves and status changes:
 * `j`/`k` next/prev, `f` flag, `x` skip, `⌘⏎` mark answered (even from a
 * textarea), `a` focus the agent, `?` toggle the shortcut legend. The decision
 * logic lives in `./keyboard` (pure, unit-tested); this component only wires it
 * to the stores and renders the discoverable legend. Bindings stay inert while
 * typing — see {@link resolveKeyAction}.
 */
export function KeyboardNav() {
  const { focusedId, focus } = useFocus();
  const { order, toggleFlag, toggleSkip, markAnswered } = useResponses();
  const { enabled: aiEnabled, setTab, setSheetOpen } = useAgent();

  const [helpOpen, setHelpOpen] = useState(false);

  // Latest state/handlers in a ref so the listener is attached once and never
  // reads a stale focusedId or item order.
  const latest = useRef({ focusedId, order, aiEnabled, focus, toggleFlag, toggleSkip, markAnswered, setTab, setSheetOpen });
  latest.current = { focusedId, order, aiEnabled, focus, toggleFlag, toggleSkip, markAnswered, setTab, setSheetOpen };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const s = latest.current;
      const target = e.target;
      const action = resolveKeyAction({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        editable: isEditableTarget(target),
        // An answer field lives inside an item card; the agent chat does not, so
        // ⌘⏎ there is left to the chat rather than marking the focused item.
        answerField: target instanceof HTMLElement && target.closest("[data-item-card]") !== null,
        aiEnabled: s.aiEnabled,
      });
      if (!action) return;

      const ids = s.order.map((m) => m.itemId);

      switch (action.type) {
        case "focusNext": {
          const id = nextFocusId(ids, s.focusedId, 1);
          if (id) s.focus(id);
          break;
        }
        case "focusPrev": {
          const id = nextFocusId(ids, s.focusedId, -1);
          if (id) s.focus(id);
          break;
        }
        case "flag":
          if (s.focusedId) s.toggleFlag(s.focusedId);
          break;
        case "skip":
          if (s.focusedId) s.toggleSkip(s.focusedId);
          break;
        case "markAnswered":
          if (s.focusedId) s.markAnswered(s.focusedId);
          break;
        case "focusAgent":
          s.setTab("agent");
          s.setSheetOpen(true); // reveals the agent on mobile; the desktop rail is always visible
          break;
        case "toggleHelp":
          setHelpOpen((open) => !open);
          break;
      }

      e.preventDefault();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = useCallback(() => setHelpOpen(false), []);

  return <KeyboardLegend open={helpOpen} aiEnabled={aiEnabled} onToggle={() => setHelpOpen((o) => !o)} onClose={close} />;
}

/** The bindings shown in the legend, in display order. */
const BINDINGS: Array<{ keys: string; label: string; agentOnly?: boolean }> = [
  { keys: "j / k", label: "Next / previous question" },
  { keys: "f", label: "Flag (revisit later)" },
  { keys: "x", label: "Skip" },
  { keys: "⌘⏎", label: "Mark answered" },
  { keys: "a", label: "Focus the agent", agentOnly: true },
  { keys: "?", label: "Toggle this legend" },
];

/**
 * A small, discoverable shortcut legend (§9). Desktop-only — keyboard nav is a
 * desktop power flow — it sits at the bottom-right as a "?" pill that expands to
 * the binding list. `?` toggles it from anywhere.
 */
function KeyboardLegend({
  open,
  aiEnabled,
  onToggle,
  onClose,
}: {
  open: boolean;
  aiEnabled: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const bindings = BINDINGS.filter((b) => !b.agentOnly || aiEnabled);

  return (
    <div className="fixed bottom-4 right-4 z-30 hidden lg:block">
      {open && (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          className="mb-2 w-64 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Keyboard shortcuts
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close shortcuts"
            >
              ✕
            </button>
          </div>
          <dl className="space-y-1.5">
            {bindings.map((b) => (
              <div key={b.keys} className="flex items-center justify-between gap-3 text-sm">
                <dt className="text-muted-foreground">{b.label}</dt>
                <dd>
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {b.keys}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label="Keyboard shortcuts"
        className={cn(
          "flex size-8 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold shadow-sm transition-colors hover:bg-accent",
          open && "bg-accent",
        )}
      >
        ?
      </button>
    </div>
  );
}
