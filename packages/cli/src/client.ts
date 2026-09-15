import { createReadStream } from "node:fs";
import https from "node:https";

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

/** One image attachment as the document detail reports it (§6, B-4). */
export interface AttachmentDetail {
  id: string;
  filename: string;
  /** The collision-free name this materializes as inside `<name>.attachments/`. */
  exportName: string;
}

export interface DocumentDetail extends DocumentSummary {
  sourcePath: string | null;
  items: Array<{
    id: string;
    response: { status: string | null } | null;
    attachments?: AttachmentDetail[];
  }>;
}

export interface HealthInfo {
  status: string;
  version: string;
  specVersion: string;
}

/** Body posted to `POST /api/publications` for `waypoint publish`. */
export interface PublishPayload {
  markdown: string;
  filename?: string;
  title?: string;
  /** Marks this as a CLI publish (origin = cli) and records the host. */
  source: { host: string };
}

export interface PublishResult {
  id: string;
  title: string;
  urls: { html: string; pdf: string; md: string };
}

export interface BackfillResult {
  indexed: number;
  skipped: number;
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

export async function publishDocument(config: ResolvedConfig, payload: PublishPayload): Promise<PublishResult> {
  const res = await doFetch(`${config.url}/api/publications`, {
    method: "POST",
    headers: headers(config, { "content-type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as PublishResult;
}

/** Body posted to `POST /api/publications/media` to reserve a media publication. */
export interface MediaPublishPayload {
  filename: string;
  contentType: string;
  bytes: number;
  title?: string;
  group?: string;
  label?: string;
  manifest?: Record<string, unknown>;
  source: { host: string };
}

/** The reserved row and its presigned upload capability. */
export interface MediaCreateResult {
  id: string;
  key: string;
  uploadUrl: string;
  expiresAt: string;
}

/** What finalize reports once the object is confirmed on R2. */
export interface MediaFinalizeResult {
  id: string;
  title: string;
  kind: string;
  bytes: number | null;
  /** `page` is a server-relative path; the caller prefixes it with `publicUrl`. */
  urls: { file: string; manifest: string | null; page: string };
}

/** Reserve a media publication: the row, the object key, and a presigned PUT. */
export async function createMediaPublication(
  config: ResolvedConfig,
  payload: MediaPublishPayload,
): Promise<MediaCreateResult> {
  const res = await doFetch(`${config.url}/api/publications/media`, {
    method: "POST",
    headers: headers(config, { "content-type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as MediaCreateResult;
}

/** Confirm the upload landed; the server HEADs the object before it answers. */
export async function finalizeMediaPublication(
  config: ResolvedConfig,
  id: string,
): Promise<MediaFinalizeResult> {
  const res = await doFetch(`${config.url}/api/publications/${encodeURIComponent(id)}/finalize`, {
    method: "POST",
    headers: headers(config),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as MediaFinalizeResult;
}

export interface PresignedUploadInput {
  url: string;
  filePath: string;
  contentType: string;
  contentLength: number;
  /** Called with 10, 20, … as the upload passes each tenth of the file. */
  onProgress?: (percent: number) => void;
}

/**
 * PUT a file to a presigned URL, streamed (§ media spec Q3, decision B-3).
 *
 * `node:https` rather than `fetch`: a fetch body that is a stream is sent with
 * `Transfer-Encoding: chunked`, and S3-compatible stores reject a chunked PUT
 * against a presigned URL whose signature covers `content-length`. Here the
 * length is set explicitly and the file is piped, so a 500 MB render never lands
 * in memory and the signature matches.
 */
export async function uploadPresigned(input: PresignedUploadInput): Promise<void> {
  const target = parseHttpsUrl(input.url);

  return new Promise<void>((resolve, reject) => {
    const req = https.request(
      target,
      {
        method: "PUT",
        headers: {
          "content-type": input.contentType,
          "content-length": input.contentLength,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          if (status >= 200 && status < 300) {
            resolve();
            return;
          }
          const body = Buffer.concat(chunks).toString("utf8").trim();
          reject(
            new ApiError(
              status,
              "upload_failed",
              `Upload to storage failed (HTTP ${status})${body ? `: ${firstLine(body)}` : "."}`,
            ),
          );
        });
      },
    );

    req.on("error", (err: Error) => {
      reject(new NetworkError(`Could not upload to storage (${err.message}).`));
    });

    const file = createReadStream(input.filePath);
    file.on("error", (err: Error) => {
      req.destroy();
      reject(new NetworkError(`Could not read the file to upload (${err.message}).`));
    });

    if (input.onProgress) {
      const notify = input.onProgress;
      let sent = 0;
      let lastTenth = 0;
      file.on("data", (chunk: string | Buffer) => {
        sent += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
        const tenth = Math.floor((sent / input.contentLength) * 10);
        if (tenth > lastTenth && tenth <= 10) {
          lastTenth = tenth;
          notify(tenth * 10);
        }
      });
    }

    file.pipe(req);
  });
}

/** Presigned storage URLs are always https; anything else is a misconfiguration. */
function parseHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(0, "invalid_upload_url", `The server returned an unusable upload URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new ApiError(0, "invalid_upload_url", `Refusing to upload over ${url.protocol}//: ${raw}`);
  }
  return url;
}

/** First line of an error body, so a multi-line XML fault reads as one message. */
function firstLine(body: string): string {
  const line = body.split("\n", 1)[0].trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

export async function backfillPublications(config: ResolvedConfig): Promise<BackfillResult> {
  const res = await doFetch(`${config.url}/api/publications/backfill`, {
    method: "POST",
    headers: headers(config),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as BackfillResult;
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
  return exportFormat(config, id, "annotated");
}

/** Fetch the compact digest export (§11 output 2, SPEC §9) — `pull --digest`. */
export async function exportDigest(config: ResolvedConfig, id: string): Promise<ExportFile> {
  return exportFormat(config, id, "digest");
}

async function exportFormat(
  config: ResolvedConfig,
  id: string,
  format: "annotated" | "digest",
): Promise<ExportFile> {
  const res = await doFetch(
    `${config.url}/api/documents/${encodeURIComponent(id)}/export?format=${format}`,
    { headers: headers(config) },
  );
  if (!res.ok) throw await toApiError(res);
  const body = await res.text();
  const filename = filenameFromDisposition(res.headers.get("content-disposition"));
  return { filename, body };
}

/** Fetch one attachment's raw bytes for materialization into `<name>.attachments/`. */
export async function getAttachmentBytes(config: ResolvedConfig, id: string): Promise<Buffer> {
  const res = await doFetch(`${config.url}/api/attachments/${encodeURIComponent(id)}`, {
    headers: headers(config),
  });
  if (!res.ok) throw await toApiError(res);
  return Buffer.from(await res.arrayBuffer());
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
