import { InertItemCard } from "@/components/document/inert-item-card";
import type { DocumentSegment } from "@/lib/render/document";

/**
 * Renders a document's segments in order (§9): prose runs as sanitized HTML,
 * `wp:` questions as in-place cards. The segmentation lives in
 * lib/render/document; this component only decides how each segment is drawn.
 */
export function DocumentView({ segments }: { segments: DocumentSegment[] }) {
  let itemOrdinal = 0;
  return (
    <article>
      {segments.map((segment, i) => {
        if (segment.kind === "prose") {
          return (
            <div
              key={i}
              className="wp-prose"
              // Sanitized upstream by the render pipeline (rehype-sanitize).
              dangerouslySetInnerHTML={{ __html: segment.html }}
            />
          );
        }
        itemOrdinal += 1;
        return <InertItemCard key={i} item={segment.item} index={itemOrdinal} />;
      })}
    </article>
  );
}
