CREATE TABLE `channel_members` (
	`channel_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`channel_id`, `user_id`),
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`room_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `channel_members_user_id_idx` ON `channel_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`room_id` text PRIMARY KEY NOT NULL,
	`department_id` text,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`visibility` text NOT NULL,
	`purpose` text NOT NULL,
	`created_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "channels_visibility_check" CHECK("channels"."visibility" in ('public', 'private')),
	CONSTRAINT "channels_purpose_check" CHECK("channels"."purpose" in ('normal', 'department', 'announcement', 'company_general', 'case')),
	CONSTRAINT "channels_department_purpose_check" CHECK("channels"."purpose" not in ('department', 'announcement') or ("channels"."department_id" is not null and "channels"."visibility" = 'public')),
	CONSTRAINT "channels_company_general_check" CHECK("channels"."purpose" <> 'company_general' or "channels"."department_id" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_name_normalized_unique` ON `channels` (`name_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `channels_department_purpose_unique` ON `channels` (`department_id`,`purpose`) WHERE "channels"."purpose" in ('department', 'announcement');--> statement-breakpoint
CREATE INDEX `channels_department_id_idx` ON `channels` (`department_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "rooms_kind_check" CHECK("rooms"."kind" in ('channel', 'conversation'))
);
--> statement-breakpoint
ALTER TABLE `departments` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `departments` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `departments` ADD `updated_at` text;