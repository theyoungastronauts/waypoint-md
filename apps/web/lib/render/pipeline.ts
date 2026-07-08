import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { sanitizeSchema } from "./schema";

/**
 * The reusable markdown render pipeline (§9). Prose in → sanitized HTML out.
 *
 * remark-parse (+GFM, +frontmatter) → remark-rehype (raw HTML passed through)
 * → rehype-raw (parse that raw HTML into the tree) → rehype-sanitize (strip
 * everything outside the allowlist) → rehype-stringify. `rehype-raw` before
 * `rehype-sanitize` is what lets the sanitizer actually see and remove embedded
 * `<script>` / `onerror` nodes rather than passing them through as opaque HTML.
 *
 * Frozen so the processor is compiled once and shared. Phase 4 lifts `wp:`
 * blocks into interactive React components by segmenting the document
 * ({@link ./document}); this prose pipeline stays the renderer for the
 * surrounding markdown and does not need to change.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStringify)
  .freeze();

/** Render a markdown string to sanitized HTML safe for `dangerouslySetInnerHTML`. */
export function renderMarkdownToSafeHtml(markdown: string): string {
  return String(processor.processSync(markdown));
}
