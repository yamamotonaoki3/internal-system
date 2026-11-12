CREATE TABLE `channel_creation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`visibility` text NOT NULL,
	`requested_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`decided_by` text,
	`decision_reason` text,
	`channel_id` text,
	`requested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "channel_creation_requests_visibility_check" CHECK("channel_creation_requests"."visibility" in ('public', 'private')),
	CONSTRAINT "channel_creation_requests_status_check" CHECK("channel_creation_requests"."status" in ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "channel_creation_requests_rejected_reason_check" CHECK("channel_creation_requests"."status" <> 'rejected' or "channel_creation_requests"."decision_reason" is not null),
	CONSTRAINT "channel_creation_requests_approved_channel_check" CHECK("channel_creation_requests"."status" <> 'approved' or "channel_creation_requests"."channel_id" is not null),
	CONSTRAINT "channel_creation_requests_decided_check" CHECK("channel_creation_requests"."status" = 'pending' or ("channel_creation_requests"."decided_at" is not null and "channel_creation_requests"."decided_by" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_creation_requests_pending_name_unique` ON `channel_creation_requests` (`name_normalized`) WHERE "channel_creation_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `channel_creation_requests_requested_by_id_idx` ON `channel_creation_requests` (`requested_by`,`id`);--> statement-breakpoint
CREATE INDEX `channel_creation_requests_status_department_id_idx` ON `channel_creation_requests` (`status`,`department_id`,`id`);