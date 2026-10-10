CREATE TABLE `voice_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`cache_key` text NOT NULL,
	`model` text NOT NULL,
	`brief` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_briefs_doc_key_idx` ON `voice_briefs` (`document_id`,`cache_key`);--> statement-breakpoint
CREATE TABLE `voice_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`model` text NOT NULL,
	`mode` text,
	`status` text DEFAULT 'active' NOT NULL,
	`transcript` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`submitted_at` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `voice_sessions_document_idx` ON `voice_sessions` (`document_id`);