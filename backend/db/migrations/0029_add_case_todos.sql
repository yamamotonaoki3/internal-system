CREATE TABLE `case_todo_events` (
	`id` text PRIMARY KEY NOT NULL,
	`todo_id` text NOT NULL,
	`case_id` text NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`title` text,
	`previous_title` text,
	`assignee_id` text,
	`assignee_name` text,
	`previous_assignee_id` text,
	`previous_assignee_name` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`todo_id`) REFERENCES `case_todos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "case_todo_events_kind_check" CHECK("case_todo_events"."kind" in ('create', 'title_change', 'assignee_change', 'complete', 'uncomplete', 'delete', 'restore', 'auto_unassign'))
);
--> statement-breakpoint
CREATE INDEX `case_todo_events_todo_id_id_idx` ON `case_todo_events` (`todo_id`,`id`);--> statement-breakpoint
CREATE TABLE `case_todos` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`title` text NOT NULL,
	`assignee_id` text,
	`recorded_assignee_id` text,
	`recorded_assignee_name` text,
	`completed_assignee_id` text,
	`completed_assignee_name` text,
	`is_done` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "case_todos_is_done_check" CHECK("case_todos"."is_done" in (0, 1)),
	CONSTRAINT "case_todos_assignee_check" CHECK("case_todos"."assignee_id" is null or ("case_todos"."recorded_assignee_id" is not null and "case_todos"."assignee_id" = "case_todos"."recorded_assignee_id")),
	CONSTRAINT "case_todos_recorded_assignee_check" CHECK(("case_todos"."recorded_assignee_id" is null) = ("case_todos"."recorded_assignee_name" is null)),
	CONSTRAINT "case_todos_completed_assignee_check" CHECK(("case_todos"."completed_assignee_id" is null) = ("case_todos"."completed_assignee_name" is null) and ("case_todos"."is_done" = 1 or "case_todos"."completed_assignee_id" is null)),
	CONSTRAINT "case_todos_deleted_check" CHECK(("case_todos"."deleted_at" is null) = ("case_todos"."deleted_by" is null))
);
--> statement-breakpoint
CREATE INDEX `case_todos_case_id_id_idx` ON `case_todos` (`case_id`,`id`);