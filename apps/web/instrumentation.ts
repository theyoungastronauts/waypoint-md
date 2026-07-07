/**
 * Next.js runs `register()` once when the server boots (not during build).
 * We run drizzle migrations here so the SQLite schema exists before any request.
 * Guarded to the Node.js runtime so it never runs on the edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./lib/db/migrate");
    runMigrations();
  }
}
