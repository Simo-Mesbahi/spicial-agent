CREATE TABLE `production_case_bindings` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`case_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
