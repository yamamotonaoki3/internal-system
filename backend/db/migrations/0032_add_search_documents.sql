CREATE TABLE `search_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`room_id` text,
	`message_id` text,
	`created_at` text NOT NULL,
	`source_body` text NOT NULL,
	CONSTRAINT "search_documents_kind_check" CHECK("search_documents"."kind" IN ('message'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_documents_kind_ref_id_unique` ON `search_documents` (`kind`,`ref_id`);--> statement-breakpoint
CREATE INDEX `search_documents_room_id_created_at_id_idx` ON `search_documents` (`room_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `search_documents_kind_created_at_id_idx` ON `search_documents` (`kind`,`created_at`,`id`);