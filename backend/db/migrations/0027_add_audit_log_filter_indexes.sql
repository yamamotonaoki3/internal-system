CREATE INDEX `audit_logs_actor_occurred_idx` ON `audit_logs` (`actor_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_occurred_idx` ON `audit_logs` (`action`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_logs_target_occurred_idx` ON `audit_logs` (`target_type`,`target_id`,`occurred_at`,`id`);