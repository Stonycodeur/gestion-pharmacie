-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `pharmacy_payment_methods` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `method_code` VARCHAR(255) NOT NULL,
  `enabled` BIGINT NOT NULL DEFAULT 1,
  `at_counter` BIGINT NOT NULL DEFAULT 0,
  `on_delivery` BIGINT NOT NULL DEFAULT 0,
  `online` BIGINT NOT NULL DEFAULT 0,
  UNIQUE (`pharmacy_id`, `method_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `countries` ADD COLUMN `currencies` TEXT;

ALTER TABLE `pharmacies` ADD COLUMN `currencies` TEXT;

ALTER TABLE `users` ADD COLUMN `country_id` BIGINT;

ALTER TABLE `users` ADD COLUMN `see_all_countries` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `customer_orders` ADD COLUMN `wants_delivery` BIGINT;

ALTER TABLE `customer_orders` ADD COLUMN `pay_mode` VARCHAR(255);

ALTER TABLE `customer_orders` ADD COLUMN `pay_method_code` VARCHAR(255);

ALTER TABLE `pharmacy_payment_methods` ADD CONSTRAINT `fk_pharmacy_payment_methods_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`) ON DELETE CASCADE;
