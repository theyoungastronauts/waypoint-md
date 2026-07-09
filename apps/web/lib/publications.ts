import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { publications } from "./db/schema";
import { publicationUrls, type PublicationUrls } from "./publish/paths";

/**
 * Data access for the publications registry (§ publish spec). Mirrors
 * `lib/documents.ts`: pure DB reads/writes over drizzle, plus the FTS5 search.
 * The HTML/PDF bytes are never touched here — they live on R2 (see
 * `lib/publish/r2.ts`); this module owns only the source markdown + metadata row
 * and the full-text index derived from it.
 */

/** The publish origins recorded on a row. */
export const PUBLICATION_ORIGINS = ["cli", "api", "backfill"] as const;
export type PublicationOrigin = (typeof PUBLICATION_ORIGINS)[number];

/** A full publications row (camelCase, as drizzle returns it). */
export interface PublicationRow {
  id: string;
  title: string;
  sanitizedName: string;
  sourceMd: string;
  r2Folder: string;
  publicBase: string;
  origin: string;
  sourceHost: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface InsertPublicationInput {
  /** Set for backfill (the folder uuid); omitted for cli/api (auto uuid). */
  id?: string;
  title: string;
  sanitizedName: string;
  sourceMd: string;
  r2Folder: string;
  publicBase: string;
  origin: PublicationOrigin;
  sourceHost?: string | null;
  /** Set for backfill (from the object's LastModified); omitted otherwise (now). */
  createdAt?: string;
}

/** Insert one publication row and return it. Triggers keep the FTS index synced. */
export function insertPublication(input: InsertPublicationInput): PublicationRow {
  const db = getDb();
  const values: typeof publications.$inferInsert = {
    title: input.title,
    sanitizedName: input.sanitizedName,
    sourceMd: input.sourceMd,
    r2Folder: input.r2Folder,
    publicBase: input.publicBase,
    origin: input.origin,
    sourceHost: input.sourceHost ?? null,
  };
  // id / createdAt default when omitted (auto uuid + now); backfill supplies both.
  if (input.id !== undefined) values.id = input.id;
  if (input.createdAt !== undefined) values.createdAt = input.createdAt;

  const [row] = db.insert(publications).values(values).returning().all();
  return row as PublicationRow;
}

/** Full row by id, or null when absent. */
export function getPublication(id: string): PublicationRow | null {
  const db = getDb();
  const row = db.select().from(publications).where(eq(publications.id, id)).get();
  return (row as PublicationRow) ?? null;
}

/** Whether a publication id already exists (backfill idempotency check). */
export function publicationExists(id: string): boolean {
  const db = getDb();
  return db.select({ id: publications.id }).from(publications).where(eq(publications.id, id)).get() !== undefined;
}

export interface ListPublicationsOptions {
  /** FTS5 query over title + source markdown. Empty/absent → list everything. */
  q?: string;
  limit?: number;
  /** Rows to skip, for pagination (newest-first order is stable). */
  offset?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

/**
 * Turn a raw user query into a safe FTS5 MATCH expression. Hostile input can
 * never reach the FTS parser: the query is tokenized to letters/digits only
 * (every operator character — quotes, `*`, `-`, `:`, `(`, `AND`/`OR`/`NEAR` as
 * syntax — is dropped), and each token is emitted as a quoted prefix term. So
 * `"` or `foo:bar(` search as literal words instead of erroring or injecting.
 * Returns "" when the query has no searchable tokens (caller returns no rows).
 */
export function toFtsMatch(raw: string): string {
  const tokens = raw.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return "";
  return tokens.map((token) => `"${token}"*`).join(" ");
}

/**
 * Registry listing, newest first (§ publish spec). With `q`, restrict to rows
 * matching the FTS index; ordering stays newest-first regardless of rank.
 */
export function listPublications(options: ListPublicationsOptions = {}): PublicationRow[] {
  const db = getDb();
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const q = (options.q ?? "").trim();

  if (!q) {
    return db
      .select()
      .from(publications)
      .orderBy(desc(publications.createdAt))
      .limit(limit)
      .offset(offset)
      .all() as PublicationRow[];
  }

  const match = toFtsMatch(q);
  if (!match) return [];

  const matched = db.all(
    sql`SELECT p.id AS id FROM publications_fts f JOIN publications p ON p.rowid = f.rowid WHERE publications_fts MATCH ${match}`,
  ) as Array<{ id: string }>;
  const ids = matched.map((r) => r.id);
  if (ids.length === 0) return [];

  return db
    .select()
    .from(publications)
    .where(inArray(publications.id, ids))
    .orderBy(desc(publications.createdAt))
    .limit(limit)
    .offset(offset)
    .all() as PublicationRow[];
}

/**
 * Stamp `revoked_at` (once) so the registry remembers the publication was pulled
 * from R2. Idempotent: an already-revoked row keeps its original timestamp.
 * Returns the row, or null when absent. Does not touch R2 — the caller deletes
 * the objects (see `lib/publish/service.ts`).
 */
export function stampRevoked(id: string): PublicationRow | null {
  const db = getDb();
  const existing = getPublication(id);
  if (!existing) return null;
  if (existing.revokedAt) return existing;

  const [row] = db
    .update(publications)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(publications.id, id))
    .returning()
    .all();
  return (row as PublicationRow) ?? null;
}

/** A registry list entry: the row minus the (heavy) source markdown, plus URLs. */
export interface PublicationSummary {
  id: string;
  title: string;
  sanitizedName: string;
  origin: string;
  sourceHost: string | null;
  createdAt: string;
  revokedAt: string | null;
  revoked: boolean;
  urls: PublicationUrls;
}

/** A registry detail entry: the full row (incl. source markdown) plus URLs. */
export interface PublicationDetail extends PublicationSummary {
  sourceMd: string;
  r2Folder: string;
  publicBase: string;
}

export function toPublicationSummary(row: PublicationRow): PublicationSummary {
  return {
    id: row.id,
    title: row.title,
    sanitizedName: row.sanitizedName,
    origin: row.origin,
    sourceHost: row.sourceHost,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    revoked: row.revokedAt !== null,
    urls: publicationUrls(row.publicBase, row.r2Folder, row.sanitizedName),
  };
}

export function toPublicationDetail(row: PublicationRow): PublicationDetail {
  return {
    ...toPublicationSummary(row),
    sourceMd: row.sourceMd,
    r2Folder: row.r2Folder,
    publicBase: row.publicBase,
  };
}
