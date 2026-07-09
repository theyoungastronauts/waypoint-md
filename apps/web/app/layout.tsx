import type { Metadata } from "next";
import Link from "next/link";

import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { publishEnabled } from "@/lib/publish/config";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Waypoint",
    template: "%s · Waypoint",
  },
  description: "Review agent-generated markdown — answer, choose, comment, export.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Server-driven capability gate (spec: mirrors the AI degradation contract):
  // the Publications nav link only appears when R2 credentials are configured.
  const publish = publishEnabled();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <QueryProvider>
            <div className="flex min-h-screen flex-col">
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
                      <Link
                        href="/publications"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        Publications
                      </Link>
                    )}
                    <Link href="/settings" className="text-muted-foreground hover:text-foreground">
                      Settings
                    </Link>
                  </nav>
                </div>
              </header>
              {/* Pages self-constrain: narrow pages wrap in `max-w-3xl`, the
                  review view spans wider for its document + right rail (§9). */}
              <main className="w-full flex-1 px-4 py-10">{children}</main>
            </div>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
