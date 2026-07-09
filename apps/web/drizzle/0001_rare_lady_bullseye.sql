CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`sanitized_name` text NOT NULL,
	`source_md` text NOT NULL,
	`r2_folder` text NOT NULL,
	`public_base` text NOT NULL,
	`origin` text NOT NULL,
	`source_host` text,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
-- Full-text search over the registry (title + source markdown). External-content
-- FTS5 table keyed on the publications rowid; the index is kept in sync by the
-- three triggers below, so the source bytes live once (in `publications`) and the
-- FTS shadow tables hold only the index. drizzle-kit does not manage virtual
-- tables or triggers, so this is hand-written raw SQL in the committed migration.
CREATE VIRTUAL TABLE `publications_fts` USING fts5(
	title,
	source_md,
	content='publications',
	content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER `publications_fts_ai` AFTER INSERT ON `publications` BEGIN
	INSERT INTO `publications_fts`(rowid, title, source_md) VALUES (new.rowid, new.title, new.source_md);
END;
--> statement-breakpoint
CREATE TRIGGER `publications_fts_ad` AFTER DELETE ON `publications` BEGIN
	INSERT INTO `publications_fts`(`publications_fts`, rowid, title, source_md) VALUES ('delete', old.rowid, old.title, old.source_md);
END;
--> statement-breakpoint
CREATE TRIGGER `publications_fts_au` AFTER UPDATE ON `publications` BEGIN
	INSERT INTO `publications_fts`(`publications_fts`, rowid, title, source_md) VALUES ('delete', old.rowid, old.title, old.source_md);
	INSERT INTO `publications_fts`(rowid, title, source_md) VALUES (new.rowid, new.title, new.source_md);
END;
