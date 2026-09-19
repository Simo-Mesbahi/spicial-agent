CREATE TABLE `provider_health` (
	`scope` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`payload` text,
	`expires_at` integer NOT NULL,
	`lock_id` text NOT NULL,
	`lock_until` integer NOT NULL
);
