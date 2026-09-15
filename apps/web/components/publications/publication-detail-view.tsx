"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";
import type { PublicationDetail } from "@/lib/publications";
import { ArtifactLinks } from "./artifact-links";
import { formatBytes, kindLabel, originLabel } from "./labels";
import { MediaLinks } from "./media-links";
import { MediaViewer } from "./media-viewer";

/**
 * Publication detail (§ publish spec, extended by § media spec Phase B):
 * metadata, artifact links, the publication's body, and a Revoke control.
 * The body depends on the kind — rendered source markdown for a markdown
 * publication, a player plus the render manifest for a media one (decision B-4).
 * Revoke deletes the R2 objects, so it takes a two-click inline confirm (no
 * window.confirm — that breaks the harness and reads worse). On success the view
 * reflects the revoked state in place, no reload: the links go dead and a
 * revoked note replaces the button. `bodyHtml` is pre-rendered server-side
 * through the shared rehype-sanitize pipeline, so it is safe for
 * `dangerouslySetInnerHTML`.
 */
export function PublicationDetailView({
  detail,
  bodyHtml,
}: {
  detail: PublicationDetail;
  bodyHtml?: string;
}) {
  const [revoked, setRevoked] = useState(detail.revoked);
  const [revokedAt, setRevokedAt] = useState(detail.revokedAt);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const media = detail.kind === "media" ? detail : null;
  const size = media ? formatBytes(media.bytes) : null;
  // Narrowed here rather than at the usage site: `media` is a separate binding,
  // so it does not narrow `detail.urls` for the markdown branch below.
  const links =
    detail.kind === "media" ? (
      <MediaLinks urls={detail.urls} revoked={revoked} />
    ) : (
      <ArtifactLinks urls={detail.urls} revoked={revoked} />
    );
  const artifacts = media
    ? media.urls.manifest
      ? "file and manifest"
      : "file"
    : "HTML, PDF, and Markdown";

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/publications/${detail.id}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRevoked(true);
      setRevokedAt(data.publication?.revokedAt ?? new Date().toISOString());
      setConfirming(false);
      // Drop the cached list so navigating back refetches — otherwise a
      // just-revoked row keeps rendering as live (staleTime) until it expires,
      // which is exactly the feedback revoke exists to give.
      queryClient.invalidateQueries({ queryKey: ["publications"] });
    } catch {
      setError("Couldn’t revoke this publication. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/publications" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to publications
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {detail.title || "Untitled publication"}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge>{kindLabel(detail.kind, media?.contentType ?? null)}</Badge>
          {media && (media.group || media.label) && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono">
                {[media.group, media.label].filter(Boolean).join(" · ")}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <Badge variant="outline">{originLabel(detail.origin)}</Badge>
          {detail.sourceHost && (
            <>
              <span aria-hidden>·</span>
              <span className="font-mono">{detail.sourceHost}</span>
            </>
          )}
          {size && (
            <>
              <span aria-hidden>·</span>
              <span>{size}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>published {relativeTime(detail.createdAt)}</span>
          {revoked && (
            <>
              <span aria-hidden>·</span>
              <Badge className="bg-destructive/15 text-destructive">revoked</Badge>
            </>
          )}
        </div>
      </div>

      {links}

      <div className="space-y-2">
        {revoked ? (
          <p className="text-sm text-muted-foreground">
            Revoked {revokedAt ? relativeTime(revokedAt) : ""} — the {artifacts} {media ? "was" : "were"}{" "}
            deleted from R2. This registry entry stays for the record.
          </p>
        ) : confirming ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
            <span className="text-sm">
              Revoke this publication? This deletes the {artifacts} from R2 and can’t be undone.
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={revoke} disabled={busy}>
                {busy ? "Revoking…" : "Revoke"}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Revoke
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {media ? (
        <>
          <MediaViewer
            urls={media.urls}
            contentType={media.contentType}
            title={detail.title}
            revoked={revoked}
            finalized={media.finalizedAt !== null}
          />
          {media.manifest !== null && media.manifest !== undefined && (
            <details className="rounded-lg border border-border bg-card px-5 py-4">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                Render manifest
              </summary>
              <pre className="mt-3 overflow-x-auto text-xs">
                {JSON.stringify(media.manifest, null, 2)}
              </pre>
            </details>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Source</h2>
          <div
            className="wp-prose max-w-none rounded-lg border border-border bg-card px-5 py-4"
            // Pre-sanitized server-side by the shared rehype-sanitize pipeline.
            dangerouslySetInnerHTML={{ __html: bodyHtml ?? "" }}
          />
        </div>
      )}
    </div>
  );
}
