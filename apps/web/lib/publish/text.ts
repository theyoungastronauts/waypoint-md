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
 * A media filename without its directory or extension — `renders/vBTC v2.mp4`
 * → `vBTC v2`. The markdown path strips only `.md` (that is the only extension
 * it ever sees); media arrives as `.mp4`, `.mov`, `.pdf` and friends, so the
 * real extension has to come off before the name is slugified or used as a title.
 */
export function mediaStem(filename: string): string {
  const base = path.basename(filename);
  const ext = path.extname(base);
  // A dotfile with no extension (`.manifest`) keeps its whole name.
  return ext && ext !== base ? base.slice(0, base.length - ext.length) : base;
}

/** The object base name for a media publication: {@link mediaStem}, slugified. */
export function sanitizeMediaName(filename: string): string {
  return sanitizeFilename(mediaStem(filename));
}

/**
 * Strip a leading YAML frontmatter block (`---` … `---`) from markdown before it
 * is rendered or scanned for a title. `marked` has no frontmatter support, so an
 * unstripped block renders as a giant setext heading — the closing `---`
 * underlines the metadata as an `<h2>`. Waypoint docs routinely carry
 * frontmatter (`waypoint: 1`, a skill's `name`/`description`), so publish drops
 * it from the rendered HTML/PDF; the uploaded `.md` keeps the original bytes.
 * Only a block at the very start of the document is removed; a `---` thematic
 * break elsewhere is untouched. Frontmatter-free input is returned unchanged, so
 * every existing `share` object renders byte-identically.
 */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/, "");
}

/**
 * The document title: the first `# ` heading's text (after any frontmatter is
 * stripped, so a `#` inside frontmatter can't be mistaken for it), else the
 * filename without its `.md` extension (Smitty `extractTitle`). `fallbackName`
 * is the raw name to fall back to; it is basename-and-`.md`-stripped to match.
 */
export function extractTitle(markdown: string, fallbackName: string): string {
  const match = stripFrontmatter(markdown).match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return path.basename(fallbackName, ".md");
}
