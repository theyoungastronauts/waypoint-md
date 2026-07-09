/** Human labels for a publication's recorded origin (§ publish spec: cli/api/backfill). */
const ORIGIN_LABELS: Record<string, string> = {
  cli: "CLI",
  api: "API",
  backfill: "Backfill",
};

export function originLabel(origin: string): string {
  return ORIGIN_LABELS[origin] ?? origin;
}
