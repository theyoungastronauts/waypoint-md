import { randomUUID } from "node:crypto";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The full §6 data model. Landed in one shot in Phase 1 (it is small and
 * ratified) to avoid migration churn. Timestamps are stored as ISO-8601 text;
 * JSON columns are stored as text with drizzle's `{ mode: "json" }`.
 *
 * `raw_md` is immutable after import — all review state lives in `responses` /
 * `comments`, and export is a pure function of (raw_md, review state).
 */

const id = () => text("id").primaryKey().$defaultFn(randomUUID);
const createdAt = () =>
  text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

export const projects = sqliteTable("projects", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const documents = sqliteTable("documents", {
  id: id(),
  projectId: text("project_id").references(() => projects.id),
  title: text("title"),
  rawMd: text("raw_md").notNull(),
  frontmatter: text("frontmatter", { mode: "json" }),
  /** cli | upload | paste | path | url */
  sourceType: text("source_type").notNull(),
  sourcePath: text("source_path"),
  sourceUrl: text("source_url"),
  pushedFromHost: text("pushed_from_host"),
  specVersion: text("spec_version"),
  /**
   * pending | in_review | completed | pulled | archived.
   * `archived` is set only by supersede automation (a newer push archives the
   * prior doc); it is never a direct reviewer/API transition (see the PATCH
   * route, which rejects it).
   */
  status: text("status").notNull().default("pending"),
  supersedesId: text("supersedes_id"),
  createdAt: createdAt(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const items = sqliteTable("items", {
  id: id(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id),
  /** e.g. "q1" (from the wp:question id attribute). Null for synthetic items. */
  wpId: text("wp_id"),
  /** text | choice */
  type: text("type").notNull(),
  /** JSON: { select, options[] } */
  config: text("config", { mode: "json" }),
  promptMd: text("prompt_md"),
  synthetic: integer("synthetic", { mode: "boolean" }).notNull().default(false),
  /** JSON anchor, only for synthetic items (§5.7). */
  anchor: text("anchor", { mode: "json" }),
  orderIndex: integer("order_index").notNull(),
  /** Byte-offset span refs into raw_md (populated by the parser in Phase 2). */
  spanStart: integer("span_start"),
  spanEnd: integer("span_end"),
});

export const responses = sqliteTable("responses", {
  /** One response per item. */
  itemId: text("item_id")
    .primaryKey()
    .references(() => items.id),
  /** JSON: { text } | { selected[], other } */
  value: text("value", { mode: "json" }),
  /** answered | flagged | skipped */
  status: text("status"),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * Image attachments on a reviewer's response (§6, decision B-3). One row per
 * uploaded image, keyed to the `item` whose answer/elaboration field it hangs
 * under. The bytes never live here: they are written to
 * `WAYPOINT_DATA_DIR/attachments/<id>` (mirroring the raw-upload store), and only
 * this metadata row is persisted — `bytes_len` records the size for display and
 * accounting. Images only, ≤ 10 MB (enforced at the API boundary). Attachments
 * are additive to export (B-4): they are materialized into a sibling folder and
 * referenced from the answer interior, never spliced into the immutable body.
 */
export const attachments = sqliteTable("attachments", {
  id: id(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  bytesLen: integer("bytes_len").notNull(),
  createdAt: createdAt(),
});

export const comments = sqliteTable("comments", {
  id: id(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id),
  /** JSON: { exact, prefix, suffix, hash } */
  anchor: text("anchor", { mode: "json" }).notNull(),
  bodyMd: text("body_md").notNull(),
  suggestionMd: text("suggestion_md"),
  createdAt: createdAt(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: id(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: createdAt(),
});

export const settings = sqliteTable("settings", {
  /** e.g. model choice, theme — never secrets. */
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * The publications registry (Phase B — `publish`). Unlike `documents` (a
 * pending → pulled review lifecycle), a publication is a permanent static
 * artifact: the source markdown is rendered to HTML + PDF, uploaded to R2, and
 * served from the bucket forever with Waypoint never in the serving path. Only
 * the source markdown + metadata live here — the HTML/PDF bytes stay on R2 and
 * are never duplicated in the DB.
 *
 * `id` is the R2 folder uuid: `r2_folder` is always `smitty/shares/<id>`, so
 * backfill is idempotent by primary key. The three object keys and public URLs
 * derive from `r2_folder + sanitized_name + public_base`. A companion
 * `publications_fts` FTS5 virtual table (raw-SQL migration, trigger-synced)
 * indexes `(title, source_md, search_text)` for the registry search.
 *
 * Phase B adds a second `kind`: a **media** publication (a render, still, or
 * PDF). Its bytes never pass through the server — the CLI PUTs them straight to
 * R2 through a presigned URL and then finalizes the row — so a media row carries
 * `content_type`, `bytes`, the render `manifest_json`, and a `finalized_at`
 * stamp instead of source markdown. `source_md` stays NOT NULL (media rows store
 * `''`) so the FTS triggers need no null handling; `search_text` carries the
 * derived text an author would search a render by (group, label, composition).
 */
export const publications = sqliteTable("publications", {
  id: id(),
  title: text("title").notNull(),
  sanitizedName: text("sanitized_name").notNull(),
  /** The published markdown for `kind = "markdown"`; `''` for media rows. */
  sourceMd: text("source_md").notNull(),
  /** markdown | media */
  kind: text("kind").notNull().default("markdown"),
  /** Media only: the uploaded object's MIME type (from the upload allowlist). */
  contentType: text("content_type"),
  /** Media only: the object size in bytes, confirmed by the finalize HEAD. */
  bytes: integer("bytes"),
  /**
   * Media only: the material slug a version stack shares (e.g. `vbtc-unwrapped`).
   * Named `group_slug` because `group` is a SQL keyword.
   */
  groupSlug: text("group_slug"),
  /** Media only: the version label within the group (`v1`, `draft`, …). */
  label: text("label"),
  /** Media only: the render manifest, as published alongside the object. */
  manifestJson: text("manifest_json", { mode: "json" }),
  /** Derived searchable text (group, label, manifest summary); `''` for markdown. */
  searchText: text("search_text").notNull().default(""),
  /** Media only: set once the presigned upload is confirmed present on R2. */
  finalizedAt: text("finalized_at"),
  /** `smitty/shares/<id>` — the immutable object prefix for this publication. */
  r2Folder: text("r2_folder").notNull(),
  /** The public domain at publish time (e.g. `dropzone.tylersavery.com`). */
  publicBase: text("public_base").notNull(),
  /** cli | api | backfill */
  origin: text("origin").notNull(),
  /** Host that published (from the CLI); null for API/backfill origins. */
  sourceHost: text("source_host"),
  createdAt: createdAt(),
  /** Set when the R2 objects are deleted; the registry row itself survives. */
  revokedAt: text("revoked_at"),
});
