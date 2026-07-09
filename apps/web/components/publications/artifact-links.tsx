import type { PublicationUrls } from "@/lib/publish/paths";
import { cn } from "@/lib/utils";

const ARTIFACTS: Array<{ key: keyof PublicationUrls; label: string }> = [
  { key: "html", label: "HTML" },
  { key: "pdf", label: "PDF" },
  { key: "md", label: "Markdown" },
];

/**
 * The three published artifact URLs (HTML / PDF / Markdown). A live publication
 * links out to its R2 objects in a new tab; a revoked one renders the same
 * labels as muted, non-clickable text — the R2 objects were deleted on revoke,
 * so the URLs would 404 (spec Q4, "the registry remembers").
 */
export function ArtifactLinks({
  urls,
  revoked,
  className,
}: {
  urls: PublicationUrls;
  revoked: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)}>
      {ARTIFACTS.map(({ key, label }) =>
        revoked ? (
          <span
            key={key}
            title="Revoked — this file was deleted from R2"
            className="rounded-md border border-border px-2 py-0.5 text-muted-foreground/60 line-through"
          >
            {label}
          </span>
        ) : (
          <a
            key={key}
            href={urls[key]}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-2 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {label}
          </a>
        ),
      )}
    </div>
  );
}
