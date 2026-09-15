import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MediaCommentsPanel } from "@/components/publications/media-comments-panel";
import { PublicationDetailView } from "@/components/publications/publication-detail-view";
import { PublishDisabled } from "@/components/publications/publish-disabled";
import { ReviewLinksPanel } from "@/components/publications/review-links-panel";
import { getPublication, toPublicationDetail } from "@/lib/publications";
import { publishEnabled } from "@/lib/publish/config";
import { renderMarkdownToSafeHtml } from "@/lib/render/pipeline";
import { listMediaComments, toCommentViews } from "@/lib/review/comments";
import { listReviewLinks, toReviewLinkView } from "@/lib/review/links";
import { reviewLinkUrl, reviewPublicBase } from "@/lib/review/public-url";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  if (!publishEnabled()) return { title: "Publications" };
  const { id } = await params;
  const row = getPublication(id);
  return { title: row?.title ?? "Publication" };
}

export default async function PublicationDetailPage({ params }: PageProps) {
  if (!publishEnabled()) {
    return (
      <section className="mx-auto w-full max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Publications</h1>
        <PublishDisabled />
      </section>
    );
  }

  const { id } = await params;
  const row = getPublication(id);
  if (!row) notFound();

  const detail = toPublicationDetail(row);
  // Render the source markdown server-side through the shared sanitize pipeline;
  // the client detail view only needs the (already-safe) HTML string. A media
  // publication has no source markdown — it renders a player instead.
  const bodyHtml = detail.kind === "markdown" ? renderMarkdownToSafeHtml(detail.sourceMd) : undefined;

  // The review half (Phase C) hangs off a media publication only: markdown
  // publications have no player to leave a timecoded note against. Both panels
  // read from SQLite, so they work on a server with no bucket configured.
  const review =
    detail.kind === "media" ? (
      <>
        <ReviewLinksPanel
          publicationId={detail.id}
          initialLinks={listReviewLinks(detail.id).map((row) => ({
            ...toReviewLinkView(row),
            url: reviewLinkUrl(detail.id, row.token),
          }))}
          publicBase={reviewPublicBase()}
        />
        <MediaCommentsPanel
          publicationId={detail.id}
          initialComments={toCommentViews(listMediaComments(detail.id))}
        />
      </>
    ) : null;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <PublicationDetailView detail={detail} bodyHtml={bodyHtml} />
      {review}
    </section>
  );
}
