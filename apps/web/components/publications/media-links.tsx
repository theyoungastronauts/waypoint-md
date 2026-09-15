import type { MediaUrls } from "@/lib/publish/paths";
import { cn } from "@/lib/utils";

/**
 * A media publication's artifact links: the file itself and, when it has one,
 * the render manifest beside it. The revoked rendering matches
 * {@link ../publications/artifact-links.ArtifactLinks} exactly — muted,
 * struck-through, non-clickable — because revoke deletes these objects too, so
 * the URLs would 404.
 */
export function MediaLinks({
  urls,
  revoked,
  className,
}: {
  urls: MediaUrls;
  revoked: boolean;
  className?: string;
}) {
  const items: Array<{ key: string; label: string; href: string }> = [
    { key: "file", label: "File", href: urls.file },
  ];
  if (urls.manifest) items.push({ key: "manifest", label: "Manifest", href: urls.manifest });

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)}>
      {items.map(({ key, label, href }) =>
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
            href={href}
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
