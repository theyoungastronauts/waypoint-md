/**
 * Next.js runs `register()` once when the server boots (not during build).
 * We run drizzle migrations here so the SQLite schema exists before any request,
 * and print the loud open-mode auth warning (§15) when no token is configured.
 * Guarded to the Node.js runtime so it never runs on the edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./lib/db/migrate");
    runMigrations();

    const { authEnabled } = await import("./lib/auth");
    if (!authEnabled()) {
      warnAuthOpen();
    }
  }
}

/**
 * A hard-to-miss warning that the server is running with authentication waived
 * (§15). Loud on purpose: open mode is fine for a laptop or a Tailscale-only
 * box, but should never be a surprise on an exposed host.
 */
function warnAuthOpen() {
  const line = "!".repeat(72);
  console.warn(
    [
      "",
      line,
      "!! WAYPOINT IS RUNNING WITH NO AUTH — WAYPOINT_TOKEN is not set.",
      "!! Every request is accepted. Anyone who can reach this server can read",
      "!! and modify every document. This is fine on localhost or behind",
      "!! Tailscale; set WAYPOINT_TOKEN to require a token on an exposed host.",
      line,
      "",
    ].join("\n"),
  );
}
