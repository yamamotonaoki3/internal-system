-- drizzle-kit はテーブルの作り直しを生成したため、ADR-0024 に従い ADD COLUMN に書き換えた。
ALTER TABLE `users` ADD `status_kind` text DEFAULT 'available' NOT NULL CONSTRAINT "users_status_kind_check" CHECK (`status_kind` IN ('available', 'away', 'absent', 'vacation', 'meeting'));--> statement-breakpoint
ALTER TABLE `users` ADD `status_return_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `status_message` text;--> statement-breakpoint
ALTER TABLE `users` ADD `status_updated_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `status_updated_by` text REFERENCES `users`(`id`);--> statement-breakpoint
CREATE INDEX `users_directory_idx` ON `users` (`department_id`,`display_name`,`id`);--> statement-breakpoint
CREATE INDEX `users_display_name_idx` ON `users` (`display_name`,`id`);
