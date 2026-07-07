/**
 * The HTML-comment layer of the convention: attribute encode/decode and the
 * `wp:` comment tokenizer. All wp machinery lives in `<!-- wp:… -->` comments
 * (§5), which are invisible in any markdown renderer.
 */

/**
 * Decode an HTML-attribute-encoded value (§5.4). Inverse of {@link encodeAttr}
 * for the `& < > "` set, plus tolerant of a few single-quote entities.
 * `&amp;` is decoded last so the pair round-trips exactly.
 */
export function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * HTML-attribute-encode a value for emission inside a double-quoted attribute
 * (§5.4). `&` is encoded first so the pair round-trips exactly.
 */
export function encodeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Parse `name="value"` attributes from a comment's inner text; values decoded. */
export function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    attrs[match[1]] = decodeAttr(match[2]);
  }
  return attrs;
}

/** The four wp tag names (§5). */
export type WpTag = "question" | "answer" | "comment" | "suggestion";

/** A single `<!-- wp:… -->` comment located in the raw document. */
export interface WpToken {
  tag: WpTag;
  /** True for closing tags (`<!-- /wp:… -->`). */
  close: boolean;
  attrs: Record<string, string>;
  /** Offset of the leading `<` of the comment. */
  start: number;
  /** Offset just past the trailing `>` of the comment. */
  end: number;
}

const WP_TAGS = new Set<WpTag>(["question", "answer", "comment", "suggestion"]);

/**
 * Find every `wp:` comment in `raw`, in document order, skipping any whose
 * start falls inside one of the `excluded` ranges (code fences, inline code,
 * frontmatter) so that fake tags inside code never parse (§5.6, §17.1).
 */
export function tokenizeWpComments(raw: string, excluded: readonly { start: number; end: number }[]): WpToken[] {
  const tokens: WpToken[] = [];
  const re = /<!--\s*(\/?)\s*wp:([a-zA-Z]+)([\s\S]*?)-->/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const start = match.index;
    if (isExcluded(start, excluded)) continue;
    const tag = match[2].toLowerCase() as WpTag;
    if (!WP_TAGS.has(tag)) continue;
    tokens.push({
      tag,
      close: match[1] === "/",
      attrs: parseAttrs(match[3]),
      start,
      end: start + match[0].length,
    });
  }
  return tokens;
}

function isExcluded(offset: number, excluded: readonly { start: number; end: number }[]): boolean {
  for (const range of excluded) {
    if (offset >= range.start && offset < range.end) return true;
  }
  return false;
}
