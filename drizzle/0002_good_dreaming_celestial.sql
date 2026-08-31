CREATE TABLE `chat_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`response` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_requests_space` ON `chat_requests` (`space_id`);