ALTER TABLE `documents` ADD `phone_pin` text;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_phone_pin_idx` ON `documents` (`phone_pin`);