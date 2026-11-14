CREATE TABLE `thread_read_positions` (
	`user_id` text NOT NULL,
	`parent_message_id` text NOT NULL,
	`last_read_message_id` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`user_id`, `parent_message_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `parent_message_id` text REFERENCES messages(id);--> statement-breakpoint
CREATE INDEX `messages_parent_message_id_id_idx` ON `messages` (`parent_message_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_sender_id_parent_message_id_idx` ON `messages` (`sender_id`,`parent_message_id`);