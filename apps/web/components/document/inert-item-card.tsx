import type { Item } from "@waypoint/spec";

import { Badge } from "@/components/ui/badge";
import { renderMarkdownToSafeHtml } from "@/lib/render/pipeline";
import { cn } from "@/lib/utils";

/**
 * A `wp:question` block rendered inert (Phase 3): the prompt and options are
 * visible but non-interactive. Phase 4 replaces this with a live QuestionCard /
 * ChoiceGroup at the same segmentation seam (see lib/render/document).
 */
export function InertItemCard({ item, index }: { item: Item; index: number }) {
  const typeLabel =
    item.type === "choice"
      ? `Choice · ${item.select === "multi" ? "select many" : "select one"}`
      : "Text";
  const draft = item.type === "text" ? item.response?.text : item.response?.other;

  return (
    <div className="my-6 rounded-lg border border-border bg-card p-5 shadow-xs">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Question {index}</span>
        {item.wpId && <span className="font-mono">#{item.wpId}</span>}
        <span className="ml-auto flex items-center gap-2">
          {item.response?.status && <Badge variant="outline">{item.response.status}</Badge>}
          <Badge>{typeLabel}</Badge>
        </span>
      </div>

      <div
        className="wp-prose"
        // Sanitized by the render pipeline (rehype-sanitize).
        dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(item.promptMd) }}
      />

      {item.type === "choice" && item.options && item.options.length > 0 && (
        <ul className="mt-4 space-y-2">
          {item.options.map((opt, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
                  item.select === "multi" ? "rounded-sm" : "rounded-full",
                  opt.checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input",
                )}
                aria-hidden
              >
                {opt.checked && (
                  <span
                    className={cn(
                      "bg-primary-foreground",
                      item.select === "multi" ? "size-1.5 rounded-[1px]" : "size-1.5 rounded-full",
                    )}
                  />
                )}
              </span>
              <span
                className="wp-prose wp-prose-inline"
                dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(opt.label) }}
              />
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <div className="mt-4 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Draft answer
          </p>
          <div
            className="wp-prose text-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(draft) }}
          />
        </div>
      )}
    </div>
  );
}
