-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `ip_geo` (
  `ip` VARCHAR(255) PRIMARY KEY,
  `country` VARCHAR(255),
  `region` VARCHAR(255),
  `city` VARCHAR(255),
  `isp` VARCHAR(255),
  `lat` DOUBLE,
  `lng` DOUBLE,
  `fetched_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `audit_logs` ADD COLUMN `user_agent` VARCHAR(255);
