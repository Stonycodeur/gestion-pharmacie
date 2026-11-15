-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `payment_otps` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT NOT NULL,
  `order_id` BIGINT NOT NULL,
  `method_code` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(255) NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `attempts` BIGINT NOT NULL DEFAULT 0,
  `used_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `payment_methods` ADD COLUMN `otp_required` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `payment_methods` ADD COLUMN `otp_ttl` BIGINT NOT NULL DEFAULT 120;

ALTER TABLE `payment_otps` ADD CONSTRAINT `fk_payment_otps_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

ALTER TABLE `payment_otps` ADD CONSTRAINT `fk_payment_otps_order_id` FOREIGN KEY (`order_id`) REFERENCES `customer_orders` (`id`) ON DELETE CASCADE;

CREATE INDEX `idx_payment_otps_user` ON `payment_otps` (`user_id`, `order_id`, `method_code`);
