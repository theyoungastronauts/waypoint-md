import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getR2Config, type R2Config } from "./config";
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
