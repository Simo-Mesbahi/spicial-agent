CREATE TABLE `runtime_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`revision` integer NOT NULL,
	`config` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_settings_revision` ON `runtime_settings` (`scope`,`revision`);