-- ADR-0025：D1 は foreign_keys=OFF が効かないため、PRAGMA の2行だけを defer_foreign_keys に置き換えた。
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "rooms_kind_check" CHECK("__new_rooms"."kind" in ('channel', 'direct'))
);
--> statement-breakpoint
INSERT INTO `__new_rooms`("id", "kind", "created_at") SELECT "id", "kind", "created_at" FROM `rooms`;--> statement-breakpoint
DROP TABLE `rooms`;--> statement-breakpoint
ALTER TABLE `__new_rooms` RENAME TO `rooms`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;