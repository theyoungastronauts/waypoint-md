import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DocumentView } from "@/components/document/document-view";
import { WarningsBanner } from "@/components/document/warnings-banner";
import { Badge } from "@/components/ui/badge";
import { getDocumentDetail } from "@/lib/documents";
import { relativeTime, sourceLabel, statusMeta } from "@/lib/format";
import { renderDocument } from "@/lib/render/document";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface DocPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: DocPageProps): Promise<Metadata> {
  const { id } = await params;
  const doc = getDocumentDetail(id);
  return { title: doc?.title ?? "Document" };
}

export default async function DocumentPage({ params }: DocPageProps) {
  const { id } = await params;
  const doc = getDocumentDetail(id);
  if (!doc) notFound();

  const { segments, warnings } = renderDocument(doc.rawMd);
  const status = statusMeta(doc.status);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to queue
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {doc.title ?? "Untitled document"}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", status.dot)} aria-hidden />
            {status.label}
          </span>
          <span aria-hidden>·</span>
          {doc.projectName && (
            <>
              <Badge>{doc.projectName}</Badge>
              <span aria-hidden>·</span>
            </>
          )}
          <Badge variant="outline">{sourceLabel(doc.sourceType)}</Badge>
          <span aria-hidden>·</span>
          <span>imported {relativeTime(doc.createdAt)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Read-only view — interactive review arrives in the next phase.
        </p>
      </div>

      <WarningsBanner warnings={warnings} />

      <DocumentView segments={segments} />
    </div>
  );
}
