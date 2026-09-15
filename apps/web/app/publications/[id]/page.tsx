import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicationDetailView } from "@/components/publications/publication-detail-view";
import { PublishDisabled } from "@/components/publications/publish-disabled";
import { getPublication, toPublicationDetail } from "@/lib/publications";
import { publishEnabled } from "@/lib/publish/config";
import { renderMarkdownToSafeHtml } from "@/lib/render/pipeline";

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

  return (
    <section className="mx-auto w-full max-w-3xl">
      <PublicationDetailView detail={detail} bodyHtml={bodyHtml} />
    </section>
  );
}
