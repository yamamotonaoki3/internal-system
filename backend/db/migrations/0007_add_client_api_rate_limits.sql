CREATE TABLE `client_api_rate_limits` (
	`user_id` text NOT NULL,
	`bucket_type` text NOT NULL,
	`window_started_at_ms` integer NOT NULL,
	`attempt_count` integer NOT NULL,
	PRIMARY KEY(`user_id`, `bucket_type`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "client_api_rate_limits_bucket_type_check" CHECK("client_api_rate_limits"."bucket_type" in ('read', 'write'))
);
