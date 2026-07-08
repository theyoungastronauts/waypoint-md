import { describe, expect, it } from "vitest";
import { renderMarkdownToSafeHtml } from "../pipeline";
import { renderDocument } from "../document";

describe("render pipeline sanitization (§15)", () => {
  it("strips <script> tags from rendered markdown", () => {
    const html = renderMarkdownToSafeHtml("Hello\n\n<script>alert(1)</script>\n\nWorld");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("Hello");
    expect(html).toContain("World");
  });

  it("strips onerror handlers and javascript: URLs from images and links", () => {
    const html = renderMarkdownToSafeHtml(
      '<img src="x" onerror="alert(1)">\n\n<a href="javascript:alert(1)">click</a>',
    );
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("preserves ordinary markdown formatting", () => {
    const html = renderMarkdownToSafeHtml("# Title\n\n**bold** and [a link](https://example.com)");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.com"');
  });

  it("sanitizes prose segments and item prompts in a full document", () => {
    const raw = [
      "Intro <script>alert('p')</script> prose.",
      "",
      '<!-- wp:question id="q1" type="text" -->',
      "**Q1** <img src=x onerror=\"alert('q')\">",
      "<!-- wp:answer -->",
      "<!-- /wp:answer -->",
      "<!-- /wp:question -->",
    ].join("\n");
    const { segments } = renderDocument(raw);

    for (const segment of segments) {
      if (segment.kind === "prose") {
        expect(segment.html).not.toContain("<script");
        expect(segment.html).not.toContain("onerror");
      }
    }

    const item = segments.find((s) => s.kind === "item");
    expect(item?.kind).toBe("item");
    if (item?.kind === "item") {
      // The prompt is carried raw in the segment; the DOM-facing form is the
      // rendered HTML, which must be clean.
      const rendered = renderMarkdownToSafeHtml(item.item.promptMd);
      expect(rendered).not.toContain("<script");
      expect(rendered).not.toContain("onerror");
    }
  });
});
