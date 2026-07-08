/**
 * Renders a run of pre-sanitized prose HTML (§9). The HTML is produced and
 * sanitized on the server by the render pipeline (rehype-sanitize); this is the
 * one place it reaches the DOM, so the `dangerouslySetInnerHTML` is safe here
 * and nowhere else.
 */
export function Prose({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={className ?? "wp-prose"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
