import { describe, expect, it } from "vitest";

import { addShareBar, wrapHtml } from "@/lib/publish/template";

describe("wrapHtml", () => {
  it("produces a full GitHub-style HTML document with the body inlined", () => {
    const html = wrapHtml("<p>hello</p>", "My Title");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>My Title</title>");
    expect(html).toContain("<p>hello</p>");
    // The theme variables (light + dark) are present.
    expect(html).toContain("--bg-primary");
    expect(html).toContain('@media (prefers-color-scheme: dark)');
  });

  it("HTML-escapes the title (&, <, >, \")", () => {
    const html = wrapHtml("<p>x</p>", 'a<b>&"');
    expect(html).toContain("<title>a&lt;b&gt;&amp;&quot;</title>");
  });

  it("is clean — no share bar div and no bar links in the PDF source", () => {
    const html = wrapHtml("<p>x</p>", "T");
    expect(html).not.toContain('<div class="share-bar">');
    expect(html).not.toContain("Download PDF");
  });
});

describe("addShareBar", () => {
  const clean = wrapHtml("<p>body</p>", "T");
  const withBar = addShareBar(clean, "my-doc");

  it("injects the bar right after <body> with sibling-relative links", () => {
    expect(withBar).toContain('<body>\n  <div class="share-bar">');
    expect(withBar).toContain('<a href="./my-doc.pdf">Download PDF</a>');
    expect(withBar).toContain('<a href="./my-doc.md">View Markdown</a>');
  });

  it("adds the theme-toggle button and its script before </body>", () => {
    expect(withBar).toContain('<button class="theme-toggle" onclick="toggleTheme()"');
    expect(withBar).toContain("function toggleTheme()");
    expect(withBar).toContain("localStorage.setItem('share-theme'");
    // The emoji escapes are emitted as literal source (byte-fidelity with share).
    expect(withBar).toContain("'\\u2600\\uFE0F' : '\\u{1F319}'");
  });

  it("leaves the clean document unchanged (bar is additive)", () => {
    // Everything in the clean doc still present; only the body/head grew.
    expect(withBar).toContain("<p>body</p>");
    expect(withBar.length).toBeGreaterThan(clean.length);
  });
});
