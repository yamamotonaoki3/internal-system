PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_search_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`room_id` text,
	`message_id` text,
	`created_at` text NOT NULL,
	`source_body` text NOT NULL,
	CONSTRAINT "search_documents_kind_check" CHECK("__new_search_documents"."kind" IN ('message', 'attachment', 'case_title'))
);
--> statement-breakpoint
INSERT INTO `__new_search_documents`("id", "kind", "ref_id", "room_id", "message_id", "created_at", "source_body") SELECT "id", "kind", "ref_id", "room_id", "message_id", "created_at", "source_body" FROM `search_documents`;--> statement-breakpoint
DROP TABLE `search_documents`;--> statement-breakpoint
ALTER TABLE `__new_search_documents` RENAME TO `search_documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `search_documents_kind_ref_id_unique` ON `search_documents` (`kind`,`ref_id`);--> statement-breakpoint
CREATE INDEX `search_documents_room_id_created_at_id_idx` ON `search_documents` (`room_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `search_documents_kind_created_at_id_idx` ON `search_documents` (`kind`,`created_at`,`id`);