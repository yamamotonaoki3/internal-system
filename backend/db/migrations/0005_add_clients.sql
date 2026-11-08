CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_code_unique` ON `clients` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `clients_name_normalized_unique` ON `clients` (`name_normalized`);--> statement-breakpoint
CREATE INDEX `clients_code_id_idx` ON `clients` (`code`,`id`);