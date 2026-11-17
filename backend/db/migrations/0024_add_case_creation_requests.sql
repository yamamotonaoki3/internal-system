CREATE TABLE `case_creation_request_candidates` (
	`request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`request_id`, `user_id`),
	FOREIGN KEY (`request_id`) REFERENCES `case_creation_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `case_creation_request_departments` (
	`request_id` text NOT NULL,
	`department_id` text NOT NULL,
	PRIMARY KEY(`request_id`, `department_id`),
	FOREIGN KEY (`request_id`) REFERENCES `case_creation_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `case_creation_request_departments_department_id_idx` ON `case_creation_request_departments` (`department_id`);--> statement-breakpoint
CREATE TABLE `case_creation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`due_date` text,
	`requested_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`decided_by` text,
	`decision_reason` text,
	`case_id` text,
	`resubmitted_from` text,
	`requested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resubmitted_from`) REFERENCES `case_creation_requests`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "case_creation_requests_status_check" CHECK("case_creation_requests"."status" in ('pending', 'approved', 'rejected', 'withdrawn', 'auto_cancelled')),
	CONSTRAINT "case_creation_requests_rejected_reason_check" CHECK("case_creation_requests"."status" <> 'rejected' or "case_creation_requests"."decision_reason" is not null),
	CONSTRAINT "case_creation_requests_approved_case_check" CHECK("case_creation_requests"."status" <> 'approved' or "case_creation_requests"."case_id" is not null),
	CONSTRAINT "case_creation_requests_decided_check" CHECK("case_creation_requests"."status" = 'pending' or ("case_creation_requests"."decided_at" is not null and "case_creation_requests"."decided_by" is not null)),
	CONSTRAINT "case_creation_requests_due_date_check" CHECK("case_creation_requests"."due_date" is null or "case_creation_requests"."due_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `case_creation_requests_requested_by_id_idx` ON `case_creation_requests` (`requested_by`,`id`);--> statement-breakpoint
CREATE INDEX `case_creation_requests_status_id_idx` ON `case_creation_requests` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `case_creation_requests_client_id_title_idx` ON `case_creation_requests` (`client_id`,`title`);