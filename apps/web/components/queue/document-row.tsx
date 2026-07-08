import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { DocumentSummary } from "@/lib/documents";
import { relativeTime, sourceLabel, statusMeta } from "@/lib/format";
import { cn } from "@/lib/utils";

/** One queue row: status dot, title, project + source badges, relative time. */
export function DocumentRow({ doc }: { doc: DocumentSummary }) {
  const status = statusMeta(doc.status);
  return (
    <Link
      href={`/d/${doc.id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/50"
    >
      <span
        className={cn("size-2 shrink-0 rounded-full", status.dot)}
        aria-label={status.label}
        title={status.label}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{doc.title ?? "Untitled document"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{status.label}</span>
          <span aria-hidden>·</span>
          <span>{relativeTime(doc.createdAt)}</span>
          {doc.supersedesId && (
            <>
              <span aria-hidden>·</span>
              <span>revised</span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {doc.projectName && <Badge>{doc.projectName}</Badge>}
        <Badge variant="outline">{sourceLabel(doc.sourceType)}</Badge>
      </div>
    </Link>
  );
}
