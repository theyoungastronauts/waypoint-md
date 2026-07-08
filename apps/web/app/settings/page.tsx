import type { Metadata } from "next";

import { SettingsForm } from "@/components/settings/settings-form";
import { aiEnabled } from "@/lib/ai/config";
import { MODEL_CHOICES, resolveModelDetail } from "@/lib/ai/models";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

/**
 * Runtime settings (§14). The one setting in v1 is the AI sidebar model —
 * switchable between the latest Sonnet, Opus, and Fable. The stored choice wins
 * over the `WAYPOINT_MODEL` env default, which wins over the built-in default.
 */
export default function SettingsPage() {
  const { model, source } = resolveModelDetail();
  const ai = aiEnabled();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Runtime preferences for this Waypoint instance.</p>
      </div>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">AI sidebar model</h2>
          <p className="text-sm text-muted-foreground">
            The model that powers the document chat and quick actions.
          </p>
        </div>

        {!ai && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            AI features are off — no <code className="font-mono">ANTHROPIC_API_KEY</code> is set. The
            sidebar and quick actions stay hidden until a key is present. You can still choose the model
            it will use.
          </p>
        )}

        <SettingsForm choices={MODEL_CHOICES} current={model} source={source} />
      </section>
    </div>
  );
}
