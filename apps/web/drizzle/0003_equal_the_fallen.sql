ALTER TABLE `publications` ADD `kind` text DEFAULT 'markdown' NOT NULL;--> statement-breakpoint
ALTER TABLE `publications` ADD `content_type` text;--> statement-breakpoint
ALTER TABLE `publications` ADD `bytes` integer;--> statement-breakpoint
ALTER TABLE `publications` ADD `group_slug` text;--> statement-breakpoint
ALTER TABLE `publications` ADD `label` text;--> statement-breakpoint
ALTER TABLE `publications` ADD `manifest_json` text;--> statement-breakpoint
ALTER TABLE `publications` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `publications` ADD `finalized_at` text;--> statement-breakpoint
-- Recreate the full-text index over the third column, `search_text`, so media
-- publications (which carry no source markdown) are findable by the text an
-- author actually searches a render by: its group, its label, and a summary of
-- the render manifest. drizzle-kit manages neither virtual tables nor triggers,
-- so the FTS half of this migration is hand-written raw SQL — the same house
-- pattern migration 0001 established. The triggers are dropped first: they name
-- the old two-column shape and would fail against the new table.
DROP TRIGGER `publications_fts_ai`;--> statement-breakpoint
DROP TRIGGER `publications_fts_ad`;--> statement-breakpoint
DROP TRIGGER `publications_fts_au`;--> statement-breakpoint
DROP TABLE `publications_fts`;--> statement-breakpoint
CREATE VIRTUAL TABLE `publications_fts` USING fts5(
	title,
	source_md,
	search_text,
	content='publications',
	content_rowid='rowid'
);--> statement-breakpoint
CREATE TRIGGER `publications_fts_ai` AFTER INSERT ON `publications` BEGIN
	INSERT INTO `publications_fts`(rowid, title, source_md, search_text) VALUES (new.rowid, new.title, new.source_md, new.search_text);
END;--> statement-breakpoint
CREATE TRIGGER `publications_fts_ad` AFTER DELETE ON `publications` BEGIN
	INSERT INTO `publications_fts`(`publications_fts`, rowid, title, source_md, search_text) VALUES ('delete', old.rowid, old.title, old.source_md, old.search_text);
END;--> statement-breakpoint
CREATE TRIGGER `publications_fts_au` AFTER UPDATE ON `publications` BEGIN
	INSERT INTO `publications_fts`(`publications_fts`, rowid, title, source_md, search_text) VALUES ('delete', old.rowid, old.title, old.source_md, old.search_text);
	INSERT INTO `publications_fts`(rowid, title, source_md, search_text) VALUES (new.rowid, new.title, new.source_md, new.search_text);
END;--> statement-breakpoint
-- Repopulate the index from the content table: every pre-existing markdown row
-- is re-indexed under the new shape (its `search_text` defaulting to '').
INSERT INTO `publications_fts`(`publications_fts`) VALUES('rebuild');
