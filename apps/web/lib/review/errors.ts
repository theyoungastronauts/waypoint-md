import { HttpError } from "../api/http";
import { MAX_COMMENT_BYTES } from "./comments";
import type { AddCommentFailure } from "./comments";

/**
 * The single failure the public review surface admits to (decision C-1). Every
 * way a request can be refused there — an id that does not exist, a token that
 * does not, a revoked link, a link for another group, a publication whose bytes
 * were never uploaded or have been deleted — answers with exactly this, so an
 * outsider holding a URL learns nothing from the difference.
 */
export function notFoundError(): HttpError {
  return new HttpError(404, "not_found", "Not found.");
}

/**
 * Map a storage-layer refusal to the status and message a reviewer should read.
 * Shared by the public and the authoring comment doors so both refuse the same
 * input the same way.
 */
export function commentError(reason: AddCommentFailure): HttpError {
  switch (reason) {
    case "body_too_long":
      return new HttpError(400, "body_too_long", `A comment is limited to ${MAX_COMMENT_BYTES} bytes.`);
    case "invalid_timecode":
      return new HttpError(400, "invalid_timecode", "That timecode is not a valid position.");
    case "invalid_region":
      return new HttpError(400, "invalid_region", "That region mark is not inside the frame.");
    case "empty_body":
      return new HttpError(400, "empty_body", "A comment cannot be empty.");
  }
}
