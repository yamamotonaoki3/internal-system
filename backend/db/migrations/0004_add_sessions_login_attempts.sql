CREATE TABLE `login_attempts` (
	`bucket_type` text NOT NULL,
	`bucket_key` text NOT NULL,
	`attempt_count` integer,
	`failed_count` integer,
	`window_started_at` text,
	`locked_until` text,
	`last_failed_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`bucket_type`, `bucket_key`),
	CONSTRAINT "login_attempts_bucket_type_check" CHECK("login_attempts"."bucket_type" in ('source', 'account', 'setup_source'))
);
--> statement-breakpoint
CREATE INDEX `login_attempts_updated_at_idx` ON `login_attempts` (`updated_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_active_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`reauthenticated_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_created_at_idx` ON `sessions` (`user_id`,`created_at`);