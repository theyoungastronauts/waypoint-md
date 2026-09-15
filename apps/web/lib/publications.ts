import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { publications } from "./db/schema";
import { mediaExtension } from "./publish/media-types";
import { mediaUrls, publicationUrls, type MediaUrls, type PublicationUrls } from "./publish/paths";

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

/** The two shapes a publication takes (§ media spec Phase B). */
export const PUBLICATION_KINDS = ["markdown", "media"] as const;
export type PublicationKind = (typeof PUBLICATION_KINDS)[number];

/** A full publications row (camelCase, as drizzle returns it). */
export interface PublicationRow {
  id: string;
  title: string;
  sanitizedName: string;
  sourceMd: string;
  kind: string;
  contentType: string | null;
  bytes: number | null;
  groupSlug: string | null;
  label: string | null;
  manifestJson: unknown;
  searchText: string;
  finalizedAt: string | null;
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
  /** Defaults to `markdown`, matching the column default. */
  kind?: PublicationKind;
  contentType?: string | null;
  bytes?: number | null;
  groupSlug?: string | null;
  label?: string | null;
  manifestJson?: unknown;
  /** Derived search terms for media rows; markdown rows index `source_md`. */
  searchText?: string;
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
  // Media metadata: left at the column defaults (markdown, no media fields) for
  // a markdown publish, so the existing publish path writes exactly what it did.
  if (input.kind !== undefined) values.kind = input.kind;
  if (input.contentType !== undefined) values.contentType = input.contentType;
  if (input.bytes !== undefined) values.bytes = input.bytes;
  if (input.groupSlug !== undefined) values.groupSlug = input.groupSlug;
  if (input.label !== undefined) values.label = input.label;
  if (input.manifestJson !== undefined) values.manifestJson = input.manifestJson;
  if (input.searchText !== undefined) values.searchText = input.searchText;

  const [row] = db.insert(publications).values(values).returning().all();
  return row as PublicationRow;
}

/**
 * Stamp a media row as finalized: the presigned upload is confirmed present on
 * R2, so record its true size and open it to the registry. Returns the updated
 * row, or null when absent.
 */
export function stampFinalized(id: string, bytes: number | null): PublicationRow | null {
  const db = getDb();
  const [row] = db
    .update(publications)
    .set({ finalizedAt: new Date().toISOString(), ...(bytes !== null ? { bytes } : {}) })
    .where(eq(publications.id, id))
    .returning()
    .all();
  return (row as PublicationRow) ?? null;
}

/**
 * Media rows whose upload never landed, older than `before`. A create returns a
 * presigned URL that expires in 15 minutes; anything still unfinalized an hour
 * later is an abandoned upload, and the next media create sweeps it (decision
 * B-2). Deliberately a plain read — the caller deletes the objects first, then
 * the rows, so a failed R2 delete never orphans bytes behind a deleted row.
 */
export function listStaleUnfinalizedMedia(before: string): PublicationRow[] {
  const db = getDb();
  return db
    .select()
    .from(publications)
    .where(
      and(
        eq(publications.kind, "media"),
        isNull(publications.finalizedAt),
        lt(publications.createdAt, before),
      ),
    )
    .all() as PublicationRow[];
}

/** Delete one publication row outright (only ever an abandoned media upload). */
export function deletePublication(id: string): void {
  const db = getDb();
  db.delete(publications).where(eq(publications.id, id)).run();
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
 * The registry shows every markdown publication and only those media rows whose
 * upload landed. An unfinalized media row is a reserved key and a presigned URL,
 * not a publication: it has no bytes on R2, so listing it would advertise a
 * broken link until the CLI finishes (or until the next create sweeps it).
 */
const visible = () => or(eq(publications.kind, "markdown"), isNotNull(publications.finalizedAt));

/**
 * Registry listing, newest first (§ publish spec). With `q`, restrict to rows
 * matching the FTS index; ordering stays newest-first regardless of rank.
 * Unfinalized media uploads are excluded either way.
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
      .where(visible())
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
    .where(and(inArray(publications.id, ids), visible()))
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

/** What every registry entry carries, whatever its kind. */
export interface PublicationSummaryCommon {
  id: string;
  title: string;
  sanitizedName: string;
  origin: string;
  sourceHost: string | null;
  createdAt: string;
  revokedAt: string | null;
  revoked: boolean;
}

/** A rendered markdown publication: three artifacts on R2 (§ publish spec). */
export interface MarkdownPublicationSummary extends PublicationSummaryCommon {
  kind: "markdown";
  urls: PublicationUrls;
}

/** A media publication: one uploaded object, optionally a manifest beside it. */
export interface MediaPublicationSummary extends PublicationSummaryCommon {
  kind: "media";
  contentType: string | null;
  bytes: number | null;
  /** The material slug a version stack shares (`group_slug` on the row). */
  group: string | null;
  label: string | null;
  finalizedAt: string | null;
  urls: MediaUrls;
}

/**
 * A registry list entry: the row minus the (heavy) source markdown, plus URLs.
 * Discriminated on `kind` — the two kinds publish different artifacts, so their
 * `urls` differ in shape and a consumer has to say which it is handling.
 */
export type PublicationSummary = MarkdownPublicationSummary | MediaPublicationSummary;

export interface MarkdownPublicationDetail extends MarkdownPublicationSummary {
  sourceMd: string;
  r2Folder: string;
  publicBase: string;
}

export interface MediaPublicationDetail extends MediaPublicationSummary {
  /** The render manifest as published, or null when none was supplied. */
  manifest: unknown;
  r2Folder: string;
  publicBase: string;
}

/** A registry detail entry: the full row plus URLs. */
export type PublicationDetail = MarkdownPublicationDetail | MediaPublicationDetail;

/** Whether a stored row is a media publication (the column is free-form text). */
export function isMediaRow(row: PublicationRow): boolean {
  return row.kind === "media";
}

function common(row: PublicationRow): PublicationSummaryCommon {
  return {
    id: row.id,
    title: row.title,
    sanitizedName: row.sanitizedName,
    origin: row.origin,
    sourceHost: row.sourceHost,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    revoked: row.revokedAt !== null,
  };
}

export function toPublicationSummary(row: PublicationRow): PublicationSummary {
  if (isMediaRow(row)) {
    return {
      ...common(row),
      kind: "media",
      contentType: row.contentType,
      bytes: row.bytes,
      group: row.groupSlug,
      label: row.label,
      finalizedAt: row.finalizedAt,
      urls: mediaUrls(
        row.publicBase,
        row.r2Folder,
        row.sanitizedName,
        mediaExtension(row.contentType),
        row.manifestJson !== null && row.manifestJson !== undefined,
      ),
    };
  }
  return {
    ...common(row),
    kind: "markdown",
    urls: publicationUrls(row.publicBase, row.r2Folder, row.sanitizedName),
  };
}

export function toPublicationDetail(row: PublicationRow): PublicationDetail {
  const summary = toPublicationSummary(row);
  if (summary.kind === "media") {
    return {
      ...summary,
      manifest: row.manifestJson ?? null,
      r2Folder: row.r2Folder,
      publicBase: row.publicBase,
    };
  }
  return {
    ...summary,
    sourceMd: row.sourceMd,
    r2Folder: row.r2Folder,
    publicBase: row.publicBase,
  };
}
