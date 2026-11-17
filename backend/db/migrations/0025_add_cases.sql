CREATE TABLE `case_departments` (
	`case_id` text NOT NULL,
	`department_id` text NOT NULL,
	PRIMARY KEY(`case_id`, `department_id`),
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `case_departments_department_id_idx` ON `case_departments` (`department_id`);--> statement-breakpoint
CREATE TABLE `case_number_sequences` (
	`client_id` text NOT NULL,
	`year` integer NOT NULL,
	`last_number` integer NOT NULL,
	PRIMARY KEY(`client_id`, `year`),
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "case_number_sequences_last_number_check" CHECK("case_number_sequences"."last_number" between 1 and 9999)
);
--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`case_number` text NOT NULL,
	`number_client_id` text NOT NULL,
	`client_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`request_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`approved_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`number_client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`room_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cases_case_number_check" CHECK(length("cases"."case_number") = 15 and substr("cases"."case_number", 1, 3) glob '[A-Z][A-Z][A-Z]' and substr("cases"."case_number", 4, 1) = '-' and substr("cases"."case_number", 5, 6) glob '[0-9][0-9][0-9][0-9][0-9][0-9]' and substr("cases"."case_number", 11, 1) = '-' and substr("cases"."case_number", 12, 4) glob '[0-9][0-9][0-9][0-9]'),
	CONSTRAINT "cases_status_check" CHECK("cases"."status" in ('active', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cases_case_number_unique` ON `cases` (`case_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `cases_channel_id_unique` ON `cases` (`channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cases_request_id_unique` ON `cases` (`request_id`);--> statement-breakpoint
CREATE INDEX `cases_client_id_title_idx` ON `cases` (`client_id`,`title`);