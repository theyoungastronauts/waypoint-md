import { mediaCategory } from "@/lib/publish/media-types";
import type { MediaUrls } from "@/lib/publish/paths";

/**
 * Playback for a media publication (decision B-4): a video player for renders,
 * an image for stills, an embedded viewer for PDFs. The bytes are served from
 * R2 directly — Waypoint is never in the serving path — so these are plain
 * elements pointed at the public URL, with no proxying and no player library.
 *
 * Two states render a notice instead of a player, because in both the object is
 * genuinely not there: an upload that has not been finalized yet, and a revoked
 * publication whose objects were deleted.
 */
export function MediaViewer({
  urls,
  contentType,
  title,
  revoked,
  finalized,
}: {
  urls: MediaUrls;
  contentType: string | null;
  title: string;
  revoked: boolean;
  finalized: boolean;
}) {
  if (revoked) {
    return (
      <Notice>
        The file was deleted from R2 when this publication was revoked. The registry entry stays for
        the record.
      </Notice>
    );
  }
  if (!finalized) {
    return (
      <Notice>
        The upload has not been finalized. Nothing is stored at this key yet — re-run the publish to
        complete it.
      </Notice>
    );
  }

  const category = mediaCategory(contentType);

  if (category === "video") {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        src={urls.file}
        className="w-full rounded-lg border border-border bg-black"
      />
    );
  }

  if (category === "image") {
    return (
      // A published still is served from R2 at its original dimensions; next/image
      // would want to optimize it through the server, which is the one thing the
      // publish path exists to avoid.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={urls.file}
        alt={title}
        className="w-full rounded-lg border border-border bg-card object-contain"
      />
    );
  }

  if (category === "pdf") {
    return (
      <iframe
        src={urls.file}
        title={title}
        className="h-[70vh] w-full rounded-lg border border-border bg-card"
      />
    );
  }

  return <Notice>No preview for this file type — use the File link above.</Notice>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
