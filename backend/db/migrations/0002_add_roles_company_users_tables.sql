CREATE TABLE `company_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "company_settings_id_check" CHECK("company_settings"."id" = 'company')
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_name_normalized_unique` ON `departments` (`name_normalized`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission_id` text NOT NULL,
	PRIMARY KEY(`role_id`, `permission_id`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope_type` text NOT NULL,
	`department_id` text,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "roles_scope_type_check" CHECK("roles"."scope_type" in ('company', 'department'))
);
--> statement-breakpoint
CREATE TABLE `user_role_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`department_id` text,
	`assigned_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_role_assignments_scope_check" CHECK(("user_role_assignments"."scope_type" = 'company' and "user_role_assignments"."department_id" is null) or ("user_role_assignments"."scope_type" = 'department' and "user_role_assignments"."department_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_role_assignments_global_admin_unique` ON `user_role_assignments` (`role_id`) WHERE "user_role_assignments"."role_id" = 'role_global_admin';--> statement-breakpoint
CREATE UNIQUE INDEX `user_role_assignments_owner_department_unique` ON `user_role_assignments` (`department_id`) WHERE "user_role_assignments"."role_id" = 'role_owner';--> statement-breakpoint
CREATE INDEX `user_role_assignments_user_id_idx` ON `user_role_assignments` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`login_id` text NOT NULL,
	`login_id_normalized` text NOT NULL,
	`display_name` text NOT NULL,
	`legal_name` text NOT NULL,
	`email` text NOT NULL,
	`email_normalized` text NOT NULL,
	`email_verified_by` text,
	`email_verified_at` text,
	`department_id` text,
	`extension` text,
	`job_title` text,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`deactivated_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`email_verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_login_id_normalized_unique` ON `users` (`login_id_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_normalized_unique` ON `users` (`email_normalized`);