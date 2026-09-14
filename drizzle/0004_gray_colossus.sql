CREATE TABLE `mfa_enrollments` (
	`scope` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	`lock_id` text NOT NULL,
	`lock_until` integer NOT NULL
);
