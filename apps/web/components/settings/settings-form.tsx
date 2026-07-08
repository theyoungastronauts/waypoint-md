"use client";

import { useState } from "react";
import type { ModelChoice, ModelSource } from "@/lib/ai/models";
import { cn } from "@/lib/utils";

const SOURCE_NOTE: Record<ModelSource, string> = {
  settings: "Saved here — this wins over the WAYPOINT_MODEL default.",
  env: "From the WAYPOINT_MODEL environment default. Pick one below to override it.",
  default: "The built-in default. Pick one below to change it.",
};

/**
 * The `/settings` model picker (§14). Writes the choice to the settings table
 * via `POST /api/settings`; a saved value always wins over the `WAYPOINT_MODEL`
 * env default. The chat route reads the resolved model on the next request, so
 * a change takes effect without a restart.
 */
export function SettingsForm({
  choices,
  current,
  source,
}: {
  choices: ModelChoice[];
  current: string;
  source: ModelSource;
}) {
  const [selected, setSelected] = useState(current);
  const [activeSource, setActiveSource] = useState<ModelSource>(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (model: string) => {
    if (model === selected || saving) return;
    const previous = selected;
    setSelected(model); // optimistic
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSelected(data.model);
      setActiveSource(data.source);
    } catch {
      setSelected(previous); // revert
      setError("Couldn't save the model. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{SOURCE_NOTE[activeSource]}</p>
      <fieldset className="space-y-2" disabled={saving}>
        {choices.map((choice) => {
          const active = choice.id === selected;
          return (
            <label
              key={choice.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors",
                active ? "border-primary/60 bg-primary/5" : "border-border hover:bg-accent/50",
              )}
            >
              <input
                type="radio"
                name="model"
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={active}
                onChange={() => choose(choice.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{choice.label}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {choice.family}
                  </span>
                </span>
                <span className="mt-0.5 block text-muted-foreground">{choice.blurb}</span>
                <span className="mt-1 block font-mono text-xs text-muted-foreground/70">{choice.id}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
