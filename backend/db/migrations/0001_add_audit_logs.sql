CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`result` text NOT NULL,
	`trace_id` text NOT NULL,
	`detail` text,
	CONSTRAINT "audit_logs_result_check" CHECK("audit_logs"."result" in ('success', 'failure'))
);
--> statement-breakpoint
CREATE INDEX `audit_logs_occurred_at_id_idx` ON `audit_logs` (`occurred_at`,`id`);