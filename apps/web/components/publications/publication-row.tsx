import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/format";
import type { PublicationSummary } from "@/lib/publications";
import { cn } from "@/lib/utils";
import { ArtifactLinks } from "./artifact-links";
import { originLabel } from "./labels";

/**
 * One registry row: title (links to detail), origin + source-host + relative
 * time, and the three artifact links. Revoked rows still appear — the registry
 * remembers — but read as revoked: muted, badged, and their artifact links go
 * dead (see {@link ArtifactLinks}).
 */
export function PublicationRow({ pub }: { pub: PublicationSummary }) {
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
        <ArtifactLinks urls={pub.urls} revoked={pub.revoked} className="shrink-0" />
      </div>
    </div>
  );
}
