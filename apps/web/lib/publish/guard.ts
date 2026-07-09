import { HttpError } from "@/lib/api/http";
import { publishEnabled } from "./config";

/**
 * The publish degradation gate (mirrors the AI `ai_unavailable` contract). With
 * no R2 credentials configured, every publish endpoint fails with a 400
 * `publish_unavailable` — the CLI surfaces the message plainly and the B2
 * Publications UI stays hidden. Kept out of `config.ts` so the health endpoint
 * and server components can import the flag without pulling in `next/server`.
 */
export function assertPublishEnabled(): void {
  if (!publishEnabled()) {
    throw new HttpError(
      400,
      "publish_unavailable",
      "Publishing is not configured on this server. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.",
    );
  }
}
