import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/format";
import type { PublicationSummary } from "@/lib/publications";
import { cn } from "@/lib/utils";
import { ArtifactLinks } from "./artifact-links";
import { kindLabel, originLabel } from "./labels";
import { MediaLinks } from "./media-links";

/**
 * One registry row: title (links to detail), a kind badge, origin +
 * source-host + relative time, and the publication's artifact links — the three
 * rendered files for markdown, the file and manifest for media (decision B-4).
 * A media row also carries `group · label`, which is how a version stack reads
 * at a glance. Revoked rows still appear — the registry remembers — but read as
 * revoked: muted, badged, and their artifact links go dead.
 */
export function PublicationRow({ pub }: { pub: PublicationSummary }) {
  const media = pub.kind === "media" ? pub : null;
  const links =
    pub.kind === "media" ? (
      <MediaLinks urls={pub.urls} revoked={pub.revoked} className="shrink-0" />
    ) : (
      <ArtifactLinks urls={pub.urls} revoked={pub.revoked} className="shrink-0" />
    );

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3 transition-colors",
        pub.revoked ? "opacity-60" : "hover:bg-accent/50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/publications/${pub.id}`}
            className="block truncate font-medium hover:underline"
          >
            {pub.title || "Untitled publication"}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge>{kindLabel(pub.kind, media?.contentType ?? null)}</Badge>
            {media && (media.group || media.label) && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">
                  {[media.group, media.label].filter(Boolean).join(" · ")}
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <Badge variant="outline">{originLabel(pub.origin)}</Badge>
            {pub.sourceHost && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">{pub.sourceHost}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{relativeTime(pub.createdAt)}</span>
            {pub.revoked && (
              <>
                <span aria-hidden>·</span>
                <Badge className="bg-destructive/15 text-destructive">revoked</Badge>
              </>
            )}
          </div>
        </div>
        {links}
      </div>
    </div>
  );
}
