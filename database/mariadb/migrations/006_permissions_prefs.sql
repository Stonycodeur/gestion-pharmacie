-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `user_permissions` (
  `user_id` BIGINT NOT NULL,
  `permission_code` VARCHAR(255) NOT NULL,
  `effect` VARCHAR(255) NOT NULL,
  `updated_by` BIGINT,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `permission_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_preferences` (
  `user_id` BIGINT PRIMARY KEY,
  `data` VARCHAR(255) NOT NULL DEFAULT '{}',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `push_tokens` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT NOT NULL,
  `token` VARCHAR(255) NOT NULL UNIQUE,
  `platform` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `user_permissions` ADD CONSTRAINT `fk_user_permissions_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

ALTER TABLE `user_permissions` ADD CONSTRAINT `fk_user_permissions_permission_code` FOREIGN KEY (`permission_code`) REFERENCES `permissions` (`code`);

ALTER TABLE `user_preferences` ADD CONSTRAINT `fk_user_preferences_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

ALTER TABLE `push_tokens` ADD CONSTRAINT `fk_push_tokens_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

CREATE INDEX `idx_push_user` ON `push_tokens` (`user_id`);
