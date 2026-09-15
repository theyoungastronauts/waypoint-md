-- Public video review (§ media spec Phase C, decisions C-1 and C-2). The two
-- tables are ordered by hand: `media_comments` carries a foreign key into
-- `review_links`, so the referenced table is created first (SQLite resolves a
-- forward reference lazily, but an ordering that reads correctly is cheaper to
-- verify than one that relies on that).
CREATE TABLE `review_links` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`reviewer_name` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	`last_seen_at` text,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_links_token_idx` ON `review_links` (`token`);--> statement-breakpoint
CREATE INDEX `review_links_publication_idx` ON `review_links` (`publication_id`);--> statement-breakpoint
CREATE TABLE `media_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`review_link_id` text,
	`author_name` text NOT NULL,
	`timecode_ms` integer,
	`region` text,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_link_id`) REFERENCES `review_links`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `media_comments_publication_idx` ON `media_comments` (`publication_id`);--> statement-breakpoint
CREATE INDEX `media_comments_unresolved_idx` ON `media_comments` (`publication_id`,`resolved_at`);
