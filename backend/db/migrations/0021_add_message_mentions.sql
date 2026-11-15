CREATE TABLE `message_mentions` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	PRIMARY KEY(`message_id`, `start`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "message_mentions_range_check" CHECK("message_mentions"."start" >= 0 and "message_mentions"."end" > "message_mentions"."start")
);
--> statement-breakpoint
CREATE INDEX `message_mentions_user_id_message_id_idx` ON `message_mentions` (`user_id`,`message_id`);