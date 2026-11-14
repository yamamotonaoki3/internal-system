ALTER TABLE `messages` ADD `edited_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `deleted_by` text REFERENCES users(id);