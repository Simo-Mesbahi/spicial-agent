CREATE TABLE `conversation_states` (
	`space_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`lock_id` text NOT NULL,
	`lock_until` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
