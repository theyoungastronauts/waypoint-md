CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`anchor` text NOT NULL,
	`body_md` text NOT NULL,
	`suggestion_md` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`title` text,
	`raw_md` text NOT NULL,
	`frontmatter` text,
	`source_type` text NOT NULL,
	`source_path` text,
	`source_url` text,
	`pushed_from_host` text,
	`spec_version` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`supersedes_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`wp_id` text,
	`type` text NOT NULL,
	`config` text,
	`prompt_md` text,
	`synthetic` integer DEFAULT false NOT NULL,
	`anchor` text,
	`order_index` integer NOT NULL,
	`span_start` integer,
	`span_end` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `responses` (
	`item_id` text PRIMARY KEY NOT NULL,
	`value` text,
	`status` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
