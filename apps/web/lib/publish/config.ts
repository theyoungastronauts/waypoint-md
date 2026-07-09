/**
 * The server-side capability gate for `publish` (mirrors {@link ../ai/config}).
 * R2 credentials live in env only — never in the DB, never in a client bundle.
 * Callers use {@link publishEnabled} to decide whether to accept a publish (the
 * API route) or render the Publications section (server components, B2); the
 * health endpoint reports the flag, never the secrets.
 */

/** Default bucket / public domain, matching the Smitty `share` CLI it absorbs. */
export const DEFAULT_R2_BUCKET = "dropzone";
export const DEFAULT_R2_PUBLIC_DOMAIN = "dropzone.tylersavery.com";

/** Fully-resolved R2 configuration, once the three required secrets are present. */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicDomain: string;
}

function trimmed(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

/**
 * Whether publishing is available: the three R2 credentials must all be set.
 * Bucket and public domain have defaults, so they do not gate the capability.
 * Purely a function of env — safe to call from server components, route
 * handlers, and the health endpoint.
 */
export function publishEnabled(): boolean {
  return (
    trimmed("R2_ACCOUNT_ID") !== null &&
    trimmed("R2_ACCESS_KEY_ID") !== null &&
    trimmed("R2_SECRET_ACCESS_KEY") !== null
  );
}

/**
 * Resolve the full R2 config, or null when any required credential is missing.
 * Never throws — callers gate on {@link publishEnabled} (a 400 `publish_unavailable`)
 * before doing R2 work, and a null here means the same "not configured" state.
 */
export function getR2Config(): R2Config | null {
  const accountId = trimmed("R2_ACCOUNT_ID");
  const accessKeyId = trimmed("R2_ACCESS_KEY_ID");
  const secretAccessKey = trimmed("R2_SECRET_ACCESS_KEY");
  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket: trimmed("R2_BUCKET_NAME") ?? DEFAULT_R2_BUCKET,
    publicDomain: trimmed("R2_PUBLIC_DOMAIN") ?? DEFAULT_R2_PUBLIC_DOMAIN,
  };
}
