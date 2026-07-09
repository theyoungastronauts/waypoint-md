/**
 * The "publishing not configured" state (spec: capability gating mirrors the AI
 * degradation contract). Shown when {@link publishEnabled} is false so a direct
 * visit to /publications explains the missing R2 credentials instead of failing.
 */
export function PublishDisabled() {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <h2 className="text-lg font-medium">Publishing isn’t configured</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        The Publications registry needs Cloudflare R2 credentials —{" "}
        <code className="font-mono">R2_ACCOUNT_ID</code>,{" "}
        <code className="font-mono">R2_ACCESS_KEY_ID</code>, and{" "}
        <code className="font-mono">R2_SECRET_ACCESS_KEY</code>. Set them in the server
        environment to enable publishing.
      </p>
    </div>
  );
}
