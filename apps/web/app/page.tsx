export default function DashboardPage() {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
        <p className="text-sm text-muted-foreground">
          Pending, in-review, and completed documents will appear here.
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-medium">No documents yet</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Import lands in a later phase — upload a file, paste markdown, point at a
          path, or fetch a URL. For now this is the app shell.
        </p>
      </div>
    </section>
  );
}
