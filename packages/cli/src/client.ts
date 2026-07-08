import type { ResolvedConfig } from "./config";

/**
 * The thin HTTP client (§8, §12). Native `fetch` only — zero heavy deps. Two
 * distinct failure modes matter to callers:
 *   - {@link NetworkError}: the server was unreachable (connection refused, DNS,
 *     timeout). `push` queues to the outbox rather than failing on this.
 *   - {@link ApiError}: the server answered with a non-2xx (401, 400, …). This is
 *     a real error the user must fix (e.g. a missing token) — never queued.
 */

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Body posted to `POST /api/documents` for a CLI push. */
export interface PushPayload {
  markdown: string;
  project?: string;
  title?: string;
  source: { path: string; host: string };
}

export interface PushResult {
  id: string;
  url: string;
  title: string | null;
  warnings: unknown[];
}

export interface DocumentSummary {
  id: string;
  title: string | null;
  status: string;
  sourceType: string;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  sourcePath: string | null;
  items: Array<{ id: string; response: { status: string | null } | null }>;
}

export interface HealthInfo {
  status: string;
  version: string;
  specVersion: string;
}

export interface ExportFile {
  filename: string;
  body: string;
}

function headers(config: ResolvedConfig, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (config.token) h.authorization = `Bearer ${config.token}`;
  return h;
}

/** Options accepted by the global `fetch` — derived so no DOM lib is required. */
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

/** Perform a fetch, translating a connection failure into a {@link NetworkError}. */
async function doFetch(url: string, init: FetchInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new NetworkError(`Could not reach the Waypoint server (${detail}).`);
  }
}

/** Read an error response body into an {@link ApiError}. */
async function toApiError(res: Response): Promise<ApiError> {
  let code = "http_error";
  let message = `Request failed (HTTP ${res.status}).`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    /* non-JSON body — keep the defaults */
  }
  if (res.status === 401) {
    message = "Unauthorized. Set a token with `waypoint config set token <token>` (or WAYPOINT_TOKEN).";
  }
  return new ApiError(res.status, code, message);
}

export async function health(config: ResolvedConfig): Promise<HealthInfo> {
  const res = await doFetch(`${config.url}/api/health`, { headers: headers(config) });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as HealthInfo;
}

export async function pushDocument(config: ResolvedConfig, payload: PushPayload): Promise<PushResult> {
  const res = await doFetch(`${config.url}/api/documents`, {
    method: "POST",
    headers: headers(config, { "content-type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as PushResult;
}

export async function listDocuments(config: ResolvedConfig): Promise<DocumentSummary[]> {
  const res = await doFetch(`${config.url}/api/documents`, { headers: headers(config) });
  if (!res.ok) throw await toApiError(res);
  return ((await res.json()) as { documents: DocumentSummary[] }).documents;
}

export async function getDocument(config: ResolvedConfig, id: string): Promise<DocumentDetail> {
  const res = await doFetch(`${config.url}/api/documents/${encodeURIComponent(id)}`, {
    headers: headers(config),
  });
  if (!res.ok) throw await toApiError(res);
  return ((await res.json()) as { document: DocumentDetail }).document;
}

export async function exportAnnotated(config: ResolvedConfig, id: string): Promise<ExportFile> {
  const res = await doFetch(
    `${config.url}/api/documents/${encodeURIComponent(id)}/export?format=annotated`,
    { headers: headers(config) },
  );
  if (!res.ok) throw await toApiError(res);
  const body = await res.text();
  const filename = filenameFromDisposition(res.headers.get("content-disposition"));
  return { filename, body };
}

export async function markPulled(config: ResolvedConfig, id: string): Promise<void> {
  const res = await doFetch(`${config.url}/api/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers(config, { "content-type": "application/json" }),
    body: JSON.stringify({ status: "pulled" }),
  });
  if (!res.ok) throw await toApiError(res);
}

/** Parse a filename out of a `Content-Disposition` header; null when absent. */
function filenameFromDisposition(header: string | null): string {
  if (!header) return "";
  const match = /filename="?([^"]+)"?/i.exec(header);
  return match ? match[1] : "";
}
