import { defaultSchema } from "rehype-sanitize";

/**
 * The rehype-sanitize allowlist for rendered document HTML (§15). Agent-authored
 * markdown is untrusted: it may contain `<script>`, `onerror` handlers, or
 * `javascript:` URLs, none of which may reach the DOM. We start from
 * rehype-sanitize's GitHub-derived default (a tight, well-audited allowlist) and
 * clone it so later phases can extend this single object without mutating the
 * library's shared default.
 *
 * This is the one place render sanitization is configured — Phase 4's
 * interactive nodes and Phase 6's comment highlights extend it here.
 */
export const sanitizeSchema = structuredClone(defaultSchema);
