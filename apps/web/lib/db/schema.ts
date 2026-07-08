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
