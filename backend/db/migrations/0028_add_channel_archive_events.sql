CREATE TABLE `channel_archive_events` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`archived_by` text NOT NULL,
	`archived_at` text NOT NULL,
	`reason` text,
	`restored_by` text,
	`restored_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`room_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`archived_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`restored_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "channel_archive_events_reason_check" CHECK("channel_archive_events"."reason" is null or length("channel_archive_events"."reason") between 1 and 500),
	CONSTRAINT "channel_archive_events_restored_check" CHECK(("channel_archive_events"."restored_at" is null) = ("channel_archive_events"."restored_by" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_archive_events_open_unique` ON `channel_archive_events` (`channel_id`) WHERE "channel_archive_events"."restored_at" is null;--> statement-breakpoint
CREATE INDEX `channel_archive_events_channel_id_archived_at_idx` ON `channel_archive_events` (`channel_id`,`archived_at`);