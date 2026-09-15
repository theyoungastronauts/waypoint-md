"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The authoring chrome. Hidden on the public review surface (`/r/*`): those
 * pages are served to reviewers who are not on the tailnet, through a tunnel
 * whose ingress forwards nothing else, so every link in this header would be a
 * 404 at the edge — and the nav would advertise an authoring app the reviewer
 * has no business seeing.
 *
 * `publish` is resolved on the server (R2 credentials never reach the client)
 * and passed down, exactly as the layout resolved it before.
 */
export function SiteHeader({ publish }: { publish: boolean }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/r/")) return null;

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Waypoint
        </Link>
        <span className="hidden text-sm text-muted-foreground sm:inline">
          review agent-generated markdown
        </span>
        <nav className="ml-auto flex items-center gap-4 text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            Queue
          </Link>
          <Link href="/new" className="text-muted-foreground hover:text-foreground">
            New
          </Link>
          {publish && (
            <Link href="/publications" className="text-muted-foreground hover:text-foreground">
              Publications
            </Link>
          )}
          <Link href="/settings" className="text-muted-foreground hover:text-foreground">
            Settings
          </Link>
        </nav>
      </div>
    </header>
  );
}
