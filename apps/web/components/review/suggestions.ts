/**
 * Pure extraction of `wpsuggest` suggestion blocks from an assistant chat
 * message (§14, decision B-1). The sidebar model is instructed to wrap a
 * concrete proposed answer in a ```wpsuggest fenced block, keeping its prose
 * explanation outside the fence. Here we split the raw markdown into an ordered
 * list of segments — prose runs and suggestion blocks — so the panel can render
 * the prose through the sanitizing markdown pipeline and each suggestion as a
 * distinct "Use this answer" card.
 *
 * Kept DOM-free and free of any markdown dependency so the fence detection is
 * directly unit-testable. A `wpsuggest` fence is *removed* from the prose stream
 * (never double-rendered as a code block and a card), and a suggestion's text is
 * the verbatim fence interior — answers are markdown and must be inserted raw,
 * never HTML-rendered.
 */

/** One ordered piece of an assistant message: surrounding prose or a suggestion. */
export type MessageSegment =
  | { kind: "prose"; text: string }
  | { kind: "suggestion"; text: string };

/** Opening fence: up to 3 leading spaces, ≥3 backticks, info string `wpsuggest`. */
const OPEN_FENCE = /^ {0,3}(`{3,})[ \t]*wpsuggest[ \t]*$/;
/** Closing fence: up to 3 leading spaces, ≥3 backticks, nothing else. */
const CLOSE_FENCE = /^ {0,3}(`{3,})[ \t]*$/;

/**
 * Split an assistant markdown message into ordered prose and `wpsuggest`
 * segments. A message with no fence yields a single prose segment holding the
 * whole message; each closed `wpsuggest` fence becomes a suggestion segment
 * carrying the exact interior text, with the surrounding prose split around it.
 * An unterminated `wpsuggest` fence is left as prose (the model output was
 * malformed mid-stream or otherwise) rather than swallowing the rest of the
 * message.
 */
export function splitSuggestions(message: string): MessageSegment[] {
  // Normalize CRLF so the fence anchors (which end at `$`) match even when a
  // message arrives with `\r\n` line endings — otherwise the trailing `\r` on
  // the info-string line defeats detection and the block degrades to prose.
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const segments: MessageSegment[] = [];
  let prose: string[] = [];

  const flushProse = () => {
    const text = prose.join("\n");
    // Drop a run that is only whitespace (e.g. the blank line between a fence
    // and its surrounding paragraphs) so it doesn't render as an empty bubble.
    if (text.trim().length > 0) segments.push({ kind: "prose", text });
    prose = [];
  };

  let i = 0;
  while (i < lines.length) {
    const open = OPEN_FENCE.exec(lines[i]);
    if (open) {
      const openTicks = open[1].length;
      // Scan forward for a matching (or longer) closing fence.
      let j = i + 1;
      let closeAt = -1;
      while (j < lines.length) {
        const close = CLOSE_FENCE.exec(lines[j]);
        if (close && close[1].length >= openTicks) {
          closeAt = j;
          break;
        }
        j++;
      }
      if (closeAt === -1) {
        // Unterminated fence: keep this line as prose and continue scanning.
        prose.push(lines[i]);
        i++;
        continue;
      }
      flushProse();
      segments.push({ kind: "suggestion", text: lines.slice(i + 1, closeAt).join("\n") });
      i = closeAt + 1;
    } else {
      prose.push(lines[i]);
      i++;
    }
  }
  flushProse();

  // A message that was entirely whitespace still yields one (empty) prose
  // segment so callers never receive a zero-segment result for real input.
  if (segments.length === 0) segments.push({ kind: "prose", text: message });
  return segments;
}

/** True when a message carries at least one `wpsuggest` suggestion block. */
export function hasSuggestion(message: string): boolean {
  return splitSuggestions(message).some((s) => s.kind === "suggestion");
}
