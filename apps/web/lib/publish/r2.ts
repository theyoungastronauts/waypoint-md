import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Config, type R2Config } from "./config";
import { UPLOAD_URL_TTL_SECONDS } from "./media-types";
import { objectKey, PUBLICATION_EXTS, R2_PREFIX } from "./paths";

/**
 * The R2 (S3-compatible) object layer, ported from the Smitty `share` CLI
 * (`upload.js`). Server-side only. Content types and the account endpoint match
 * `share` exactly so published objects are indistinguishable from the originals.
 * Callers gate on {@link publishEnabled} first; a missing config here is an
 * unexpected state and throws rather than silently no-op'ing.
 */

const CONTENT_TYPE: Record<(typeof PUBLICATION_EXTS)[number], string> = {
  md: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  pdf: "application/pdf",
};

function requireConfig(): R2Config {
  const config = getR2Config();
  if (!config) {
    throw new Error("R2 is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).");
  }
  return config;
}

/** Build the S3 client for Cloudflare R2 (region `auto`, account endpoint). */
function client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/**
 * A client configured for **presigning**, which needs one thing the uploading
 * client does not: default request checksums off. Since v3.729 the SDK attaches
 * a CRC32 of the request body to every PutObject; when the command is presigned
 * rather than sent there is no body yet, so the signature carries the checksum
 * of zero bytes (`x-amz-checksum-crc32=AAAAAA==`) and the store rejects the real
 * upload. `WHEN_REQUIRED` emits a checksum only for operations that mandate one,
 * which PutObject does not. The uploading client keeps the default so nothing
 * about the existing markdown publish path changes.
 */
function presignClient(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

export interface PutPublicationInput {
  r2Folder: string;
  sanitizedName: string;
  markdown: string;
  /** The web HTML (with the share bar); the clean HTML is baked into the PDF. */
  html: string;
  pdf: Uint8Array;
}

/** Upload the three publication objects (md, html, pdf) to R2. */
export async function putPublicationObjects(input: PutPublicationInput): Promise<void> {
  const config = requireConfig();
  const s3 = client(config);
  const bodies: Record<(typeof PUBLICATION_EXTS)[number], string | Uint8Array> = {
    md: input.markdown,
    html: input.html,
    pdf: input.pdf,
  };
  for (const ext of PUBLICATION_EXTS) {
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey(input.r2Folder, input.sanitizedName, ext),
        Body: bodies[ext],
        ContentType: CONTENT_TYPE[ext],
      }),
    );
  }
}

/**
 * Delete the three publication objects. Idempotent — R2/S3 `DeleteObject` on a
 * missing key succeeds, so re-revoking is safe.
 */
export async function deletePublicationObjects(r2Folder: string, sanitizedName: string): Promise<void> {
  const config = requireConfig();
  const s3 = client(config);
  for (const ext of PUBLICATION_EXTS) {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: objectKey(r2Folder, sanitizedName, ext),
      }),
    );
  }
}

/** One object found under the share prefix. */
export interface ShareObject {
  key: string;
  lastModified: Date | null;
}

/**
 * List every object under the `smitty/shares/` prefix, following continuation
 * tokens so a bucket with more than one page is fully enumerated. Read-only.
 */
export async function listShareObjects(): Promise<ShareObject[]> {
  const config = requireConfig();
  const s3 = client(config);
  const prefix = `${R2_PREFIX}/`;
  const objects: ShareObject[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) objects.push({ key: obj.Key, lastModified: obj.LastModified ?? null });
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/** Fetch an object's body as UTF-8 text (used by backfill to read the `.md`). */
export async function getObjectText(key: string): Promise<string> {
  const config = requireConfig();
  const s3 = client(config);
  const res = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  if (!res.Body) return "";
  return res.Body.transformToString("utf-8");
}

/** A presigned upload URL and the moment it stops working. */
export interface PresignedUpload {
  url: string;
  expiresAt: string;
}

export interface PresignPutInput {
  key: string;
  contentType: string;
  contentLength: number;
}

/**
 * Mint a presigned PUT for one object (decision B-2 / spec Q3). Media bytes go
 * from the CLI straight to the bucket: the server never buffers a 250 MB render,
 * and the upload is immune to the 100 MB body cap on a proxied hostname.
 *
 * `ContentLength` is signed into the URL, so the upload cannot be larger (or
 * smaller) than the size the row was created for — the presign is a capability
 * for exactly one object of exactly one size.
 */
export async function presignPut(input: PresignPutInput): Promise<PresignedUpload> {
  const config = requireConfig();
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
  const url = await getSignedUrl(
    presignClient(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
  return { url, expiresAt };
}

/** What a HEAD reports about an object that exists. */
export interface ObjectHead {
  contentLength: number | null;
  contentType: string | null;
}

/**
 * HEAD one object: the finalize step's proof that the presigned upload actually
 * landed. Returns null when the object is absent (S3/R2 answer a missing key
 * with 404/NotFound rather than an error worth propagating); any other failure
 * is a real problem and propagates.
 */
export async function headObject(key: string): Promise<ObjectHead | null> {
  const config = requireConfig();
  const s3 = client(config);
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return {
      contentLength: typeof res.ContentLength === "number" ? res.ContentLength : null,
      contentType: res.ContentType ?? null,
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Whether a thrown S3 error means "no such object" rather than a real failure. */
function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

/** Upload a JSON document (the render manifest) as a pretty-printed object. */
export async function putJson(key: string, body: unknown): Promise<void> {
  const config = requireConfig();
  const s3 = client(config);
  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: `${JSON.stringify(body, null, 2)}\n`,
      ContentType: "application/json; charset=utf-8",
    }),
  );
}

/**
 * Delete an arbitrary set of object keys. Idempotent, like
 * {@link deletePublicationObjects} — DeleteObject on a missing key succeeds, so
 * revoking twice (or garbage-collecting a row whose upload never landed) is safe.
 */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const config = requireConfig();
  const s3 = client(config);
  for (const key of keys) {
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  }
}
