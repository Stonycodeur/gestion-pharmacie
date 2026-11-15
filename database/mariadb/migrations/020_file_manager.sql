-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `fm_nodes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `owner_user_id` BIGINT NOT NULL,
  `pharmacy_id` BIGINT,
  `parent_id` BIGINT,
  `kind` VARCHAR(255) NOT NULL CHECK (kind IN ('folder','file')),
  `name` VARCHAR(255) NOT NULL,
  `stored_name` VARCHAR(255),
  `mime` VARCHAR(255),
  `size` BIGINT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `fm_shares` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `node_id` BIGINT NOT NULL,
  `target_type` VARCHAR(255) NOT NULL CHECK (target_type IN ('user','pharmacy')),
  `target_id` BIGINT NOT NULL,
  `can_edit` BIGINT NOT NULL DEFAULT 0,
  `shared_by` BIGINT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`node_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `fm_nodes` ADD CONSTRAINT `fk_fm_nodes_owner_user_id` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

ALTER TABLE `fm_nodes` ADD CONSTRAINT `fk_fm_nodes_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`) ON DELETE SET NULL;

ALTER TABLE `fm_nodes` ADD CONSTRAINT `fk_fm_nodes_parent_id` FOREIGN KEY (`parent_id`) REFERENCES `fm_nodes` (`id`) ON DELETE CASCADE;

ALTER TABLE `fm_shares` ADD CONSTRAINT `fk_fm_shares_node_id` FOREIGN KEY (`node_id`) REFERENCES `fm_nodes` (`id`) ON DELETE CASCADE;

ALTER TABLE `fm_shares` ADD CONSTRAINT `fk_fm_shares_shared_by` FOREIGN KEY (`shared_by`) REFERENCES `users` (`id`) ON DELETE CASCADE;

CREATE INDEX `idx_fm_nodes_parent` ON `fm_nodes` (`parent_id`);

CREATE INDEX `idx_fm_nodes_owner` ON `fm_nodes` (`owner_user_id`);
