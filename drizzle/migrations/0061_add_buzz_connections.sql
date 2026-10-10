CREATE TABLE `buzz_connections` (
 `user_id` text PRIMARY KEY NOT NULL,
 `team_name` text NOT NULL,
 `relay_url` text NOT NULL,
 `web_url` text NOT NULL,
 `updated_at` integer NOT NULL,
 FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
