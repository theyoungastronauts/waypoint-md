import path from "node:path";

/**
 * Pipeline text helpers ported verbatim from the Smitty `share` CLI. The
 * behaviour must stay byte-identical: existing published objects were named and
 * titled by exactly these rules, and backfill/re-publish must agree with them.
 */

/**
 * Slugify a filename into the object base name (Smitty `sanitizeFilename`):
 * lowercase, collapse whitespace/underscores to `-`, drop everything outside
 * `[a-z0-9-]`, squeeze repeated dashes, and trim leading/trailing dashes. The
 * `.md` extension is stripped first (a bare name or a full path both work).
 */
export function sanitizeFilename(filePath: string): string {
  const name = path.basename(filePath, ".md");
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The document title: the first `# ` heading's text, else the filename without
 * its `.md` extension (Smitty `extractTitle`). `fallbackName` is the raw name to
 * fall back to (a filename or path); it is basename-and-`.md`-stripped to match.
 */
export function extractTitle(markdown: string, fallbackName: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return path.basename(fallbackName, ".md");
}
