ALTER TABLE `message_attachments` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `message_attachments` ADD `deleted_by` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `message_attachments_deleted_at_idx` ON `message_attachments` (`deleted_at`,`id`) WHERE "deleted_at" IS NOT NULL;