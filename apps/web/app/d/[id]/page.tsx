import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { WarningsBanner } from "@/components/document/warnings-banner";
import { ReviewView } from "@/components/review/review-view";
import { Badge } from "@/components/ui/badge";
import { aiEnabled } from "@/lib/ai/config";
import { listChatMessages } from "@/lib/chat";
import { getDocumentDetail } from "@/lib/documents";
import { relativeTime, sourceLabel, statusMeta } from "@/lib/format";
import { renderReviewDocument } from "@/lib/render/review";
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

  const { segments, docWarnings } = renderReviewDocument(doc.rawMd, doc.items);
  const status = statusMeta(doc.status);

  // Server-driven AI capability (§14): the sidebar only renders with a key.
  const ai = aiEnabled();
  const initialChat = ai
    ? listChatMessages(doc.id).map((m) => ({ id: m.id, role: m.role, content: m.content }))
    : [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
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
      </div>

      <WarningsBanner warnings={docWarnings} />

      <ReviewView
        docId={doc.id}
        segments={segments}
        aiEnabled={ai}
        initialChat={initialChat}
        comments={doc.comments.map((c) => ({
          id: c.id,
          anchor: c.anchor,
          bodyMd: c.bodyMd,
          suggestionMd: c.suggestionMd,
          createdAt: c.createdAt,
        }))}
      />
    </div>
  );
}
