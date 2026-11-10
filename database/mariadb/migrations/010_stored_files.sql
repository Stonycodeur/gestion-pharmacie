-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `stored_files` (
  `name` VARCHAR(255) PRIMARY KEY,
  `is_public` BIGINT NOT NULL DEFAULT 0,
  `mime` VARCHAR(255) NOT NULL,
  `size` BIGINT NOT NULL,
  `data` LONGBLOB NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
