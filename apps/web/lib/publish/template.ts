/**
 * The GitHub-style HTML shell, ported byte-for-byte from the Smitty `share`
 * CLI (`template.js`). Published HTML must stay identical to what `share`
 * produced: `wrapHtml` builds the clean document used for the PDF, and
 * `addShareBar` injects the web-only bar (Download PDF / View Markdown / theme
 * toggle) plus its script. Do not "tidy" the markup — the bytes are the contract.
 */

export function wrapHtml(bodyHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg-primary: #fff;
      --bg-secondary: #f6f8fa;
      --text-primary: #24292f;
      --text-secondary: #656d76;
      --border-color: #d1d9e0;
      --link-color: #0969da;
      --code-bg: #f6f8fa;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg-primary: #0d1117;
        --bg-secondary: #161b22;
        --text-primary: #e6edf3;
        --text-secondary: #8b949e;
        --border-color: #30363d;
        --link-color: #58a6ff;
        --code-bg: #161b22;
      }
    }
    [data-theme="dark"] {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --border-color: #30363d;
      --link-color: #58a6ff;
      --code-bg: #161b22;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica,
                   Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
      font-size: 16px;
      line-height: 1.6;
      color: var(--text-primary);
      background: var(--bg-primary);
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
      transition: color 0.2s, background 0.2s;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.25;
    }
    h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border-color); }
    h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border-color); }
    h3 { font-size: 1.25em; }
    p { margin: 0 0 1em; }
    a { color: var(--link-color); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.875em;
      background: var(--code-bg);
      padding: 0.2em 0.4em;
      border-radius: 3px;
    }
    pre {
      background: var(--code-bg);
      padding: 1em;
      border-radius: 6px;
      overflow-x: auto;
      line-height: 1.45;
      border: 1px solid var(--border-color);
    }
    pre code { background: none; padding: 0; font-size: 0.875em; }
    blockquote {
      margin: 0 0 1em;
      padding: 0 1em;
      color: var(--text-secondary);
      border-left: 3px solid var(--border-color);
    }
    table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
    th, td {
      border: 1px solid var(--border-color);
      padding: 6px 13px;
      text-align: left;
    }
    th { font-weight: 600; background: var(--bg-secondary); }
    tr:nth-child(even) { background: var(--bg-secondary); }
    img { max-width: 100%; }
    hr { border: none; border-top: 1px solid var(--border-color); margin: 2em 0; }
    ul, ol { padding-left: 2em; margin-bottom: 1em; }
    li + li { margin-top: 0.25em; }
    .share-bar {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.6rem 1rem;
      margin: 0 0 2rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      font-size: 0.85em;
    }
    .share-bar a {
      color: var(--link-color);
      text-decoration: none;
    }
    .share-bar a:hover {
      text-decoration: underline;
    }
    .theme-toggle {
      margin-left: auto;
      background: none;
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85em;
      line-height: 1;
      transition: border-color 0.2s;
    }
    .theme-toggle:hover {
      border-color: var(--link-color);
    }
  </style>
  <script>
    (function() {
      var saved = localStorage.getItem('share-theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    })();
  </script>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}

export function addShareBar(html: string, sanitizedName: string): string {
  const bar = `<div class="share-bar">
    <a href="./${sanitizedName}.pdf">Download PDF</a>
    <a href="./${sanitizedName}.md">View Markdown</a>
    <button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle theme">
      <span class="theme-icon"></span>
    </button>
  </div>`;
  const script = `<script>
    function getSystemTheme() {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    function updateIcon() {
      var el = document.querySelector('.theme-icon');
      if (!el) return;
      var theme = document.documentElement.getAttribute('data-theme') || getSystemTheme();
      el.textContent = theme === 'dark' ? '\\u2600\\uFE0F' : '\\u{1F319}';
    }
    function toggleTheme() {
      var current = document.documentElement.getAttribute('data-theme') || getSystemTheme();
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('share-theme', next);
      updateIcon();
    }
    updateIcon();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
      if (!localStorage.getItem('share-theme')) updateIcon();
    });
  <\/script>`;
  return html.replace("<body>", `<body>\n  ${bar}`).replace("</body>", `${script}\n</body>`);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
