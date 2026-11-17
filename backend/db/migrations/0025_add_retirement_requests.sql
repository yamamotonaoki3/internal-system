CREATE TABLE `retirement_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`target_user_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`department_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decision_reason` text,
	`decided_by` text,
	`decided_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "retirement_requests_status_check" CHECK("retirement_requests"."status" in ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "retirement_requests_rejected_reason_check" CHECK("retirement_requests"."status" <> 'rejected' or "retirement_requests"."decision_reason" is not null),
	CONSTRAINT "retirement_requests_decided_check" CHECK("retirement_requests"."status" = 'pending' or ("retirement_requests"."decided_at" is not null and "retirement_requests"."decided_by" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retirement_requests_pending_target_unique` ON `retirement_requests` (`target_user_id`) WHERE "retirement_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `retirement_requests_requested_by_id_idx` ON `retirement_requests` (`requested_by`,`id`);--> statement-breakpoint
CREATE INDEX `retirement_requests_status_id_idx` ON `retirement_requests` (`status`,`id`);