CREATE TABLE `message_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`thread_parent_id` text,
	`message_id` text,
	`uploader_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`original_name` text NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_parent_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "message_attachments_original_name_check" CHECK(length("message_attachments"."original_name") between 1 and 255),
	CONSTRAINT "message_attachments_kind_check" CHECK("message_attachments"."kind" in ('image', 'document', 'video')),
	CONSTRAINT "message_attachments_size_bytes_check" CHECK("message_attachments"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_attachments_storage_key_unique` ON `message_attachments` (`storage_key`);--> statement-breakpoint
CREATE INDEX `message_attachments_message_id_idx` ON `message_attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `message_attachments_uploader_id_message_id_idx` ON `message_attachments` (`uploader_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `message_attachments_pending_created_at_idx` ON `message_attachments` (`created_at`) WHERE "message_attachments"."message_id" IS NULL;