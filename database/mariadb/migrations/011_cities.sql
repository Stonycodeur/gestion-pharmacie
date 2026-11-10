-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `cities` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `country_id` BIGINT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  UNIQUE (`country_id`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `cities` ADD CONSTRAINT `fk_cities_country_id` FOREIGN KEY (`country_id`) REFERENCES `countries` (`id`) ON DELETE CASCADE;

CREATE INDEX `idx_cities_country` ON `cities` (`country_id`);
