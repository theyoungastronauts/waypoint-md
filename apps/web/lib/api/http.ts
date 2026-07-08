import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * A structured error that route handlers can throw to produce a clean JSON
 * response. Door modules (path/URL) throw subclasses so a route can surface a
 * precise status + machine-readable `code` without a tangle of if-branches.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Shape of every error body the API returns. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * Map any thrown value to a JSON error response. Known `HttpError`s and zod
 * validation failures get precise statuses; everything else is a 500 with a
 * generic message (details are logged, never leaked to the client).
 */
export function toErrorResponse(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof HttpError) {
    return errorResponse(err.status, err.code, err.message, err.details);
  }
  if (err instanceof z.ZodError) {
    return errorResponse(400, "invalid_request", "Request validation failed", err.issues);
  }
  // Unexpected: log server-side, return an opaque 500.
  console.error("[api] unhandled error:", err);
  return errorResponse(500, "internal_error", "Something went wrong");
}
