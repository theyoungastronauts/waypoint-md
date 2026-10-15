import { randomUUID } from "node:crypto";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const documents = sqliteTable(
  "documents",
  {
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
  /**
   * Waypoint Voice: the 4-digit PIN that opens this review over the phone.
   * Only live reviews (pending / in_review) answer to it; a finished review's
   * PIN can be handed to a new one, which clears it here (`lib/voice/phone-pins.ts`).
   */
  phonePin: text("phone_pin"),
  createdAt: createdAt(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("documents_phone_pin_idx").on(table.phonePin)],
);

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

/**
 * A per-reviewer capability for the public review surface (§ media spec Phase C,
 * decision C-1). A link is minted against one publication and carries the
 * reviewer's name, so a comment's author is never taken from a request body — it
 * is read off the link the request arrived on.
 *
 * The link is valid for **every finalized media publication sharing that
 * publication's `group_slug`**, so a reviewer handed a v1 link keeps working when
 * v2 is published. Revoking stamps `revoked_at`: the link dies while the
 * publication and every comment made through it survive.
 */
export const reviewLinks = sqliteTable(
  "review_links",
  {
    id: id(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id),
    /** Displayed on the public page; the author of every comment made through it. */
    reviewerName: text("reviewer_name").notNull(),
    /** 32 random bytes, hex — the `?k=` capability. Compared in constant time. */
    token: text("token").notNull(),
    createdAt: createdAt(),
    revokedAt: text("revoked_at"),
    /** Last time the link was used, so a stale link is recognizable. */
    lastSeenAt: text("last_seen_at"),
  },
  (table) => [
    uniqueIndex("review_links_token_idx").on(table.token),
    index("review_links_publication_idx").on(table.publicationId),
  ],
);

/**
 * A note on a media publication (decision C-2). Separate from `comments`, whose
 * anchor is a text quote: this anchor is a timecode (null = a general note) and,
 * optionally, a region drawn on the frame — `{ x, y, w, h }` in 0–1 fractions of
 * the media box, so it survives any player size.
 *
 * `review_link_id` is null for an author-side comment (made on the tailnet), set
 * for one that arrived through a public review link. `body` is plain text and is
 * escaped on output — the public page never renders markdown.
 */
export const mediaComments = sqliteTable(
  "media_comments",
  {
    id: id(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id),
    /** The link the comment arrived on; null for an author-side note. */
    reviewLinkId: text("review_link_id").references(() => reviewLinks.id),
    /** Copied from the link at write time, so a revoked link keeps its attribution. */
    authorName: text("author_name").notNull(),
    /** Milliseconds into the media; null is a general (untimed) note. */
    timecodeMs: integer("timecode_ms"),
    /** JSON `{ x, y, w, h }` in 0–1 fractions, or null for no region mark. */
    region: text("region", { mode: "json" }),
    bodyText: text("body").notNull(),
    createdAt: createdAt(),
    /** Author-side only: set when the note has been acted on. */
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("media_comments_publication_idx").on(table.publicationId),
    index("media_comments_unresolved_idx").on(table.publicationId, table.resolvedAt),
  ],
);

/**
 * A cached "voice brief" (Waypoint Voice): the document rewritten to be heard,
 * made by Claude the first time a call is started and reused until the document
 * changes. `cache_key` hashes `raw_md`, the item set and the brief format
 * version, so a re-structured document or a new brief format makes a fresh one.
 * `brief` is the validated JSON the voice model is given (see `lib/voice/brief.ts`).
 */
export const voiceBriefs = sqliteTable(
  "voice_briefs",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    cacheKey: text("cache_key").notNull(),
    /** The Claude model that wrote it, for transparency. */
    model: text("model").notNull(),
    brief: text("brief", { mode: "json" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("voice_briefs_doc_key_idx").on(table.documentId, table.cacheKey)],
);

/**
 * One voice call against a document (Waypoint Voice). Created when the server
 * mints the call's short-lived Realtime key; the browser appends to
 * `transcript` as the call goes, so a dropped call keeps what was said.
 *
 * `transcript` is a JSON array of entries (`lib/voice/transcript.ts`): what the
 * reviewer said, what the voice model said, and each tool call it made, so a
 * misheard answer can be checked against what was actually written.
 */
export const voiceSessions = sqliteTable(
  "voice_sessions",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    /** The Realtime model the call ran on. */
    model: text("model").notNull(),
    /** brief | thorough — set when the reviewer picks at the start; null until then. */
    mode: text("mode"),
    /** active | ended | submitted */
    status: text("status").notNull().default("active"),
    transcript: text("transcript", { mode: "json" }).notNull(),
    startedAt: text("started_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    endedAt: text("ended_at"),
    submittedAt: text("submitted_at"),
  },
  (table) => [index("voice_sessions_document_idx").on(table.documentId)],
);
