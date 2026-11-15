-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `receipts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `code` VARCHAR(255) NOT NULL UNIQUE,
  `online_payment_id` BIGINT NOT NULL,
  `order_id` BIGINT,
  `customer_id` BIGINT,
  `payer_name` VARCHAR(255),
  `service` TEXT,
  `amount` BIGINT NOT NULL,
  `currency` VARCHAR(255) NOT NULL,
  `decimals` BIGINT NOT NULL DEFAULT 2,
  `method_label` VARCHAR(255),
  `reference` VARCHAR(255),
  `signature` VARCHAR(255) NOT NULL,
  `emailed_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payment_refunds` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `online_payment_id` BIGINT NOT NULL,
  `pharmacy_id` BIGINT NOT NULL,
  `amount` BIGINT NOT NULL CHECK (amount > 0),
  `reason` TEXT,
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `currency_rates` (
  `code` VARCHAR(255) PRIMARY KEY,
  `per_eur` DOUBLE NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `file_scans` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255),
  `mime` VARCHAR(255),
  `size` BIGINT,
  `sha256` VARCHAR(255),
  `verdict` VARCHAR(255) NOT NULL,
  `reason` TEXT,
  `engine` VARCHAR(255),
  `user_id` BIGINT,
  `ip` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payouts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `amount` BIGINT NOT NULL CHECK (amount > 0),
  `currency` VARCHAR(255) NOT NULL,
  `reference` VARCHAR(255),
  `note` VARCHAR(255),
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `payment_methods` ADD COLUMN `countries` TEXT;

ALTER TABLE `payment_methods` ADD COLUMN `currencies` TEXT;

ALTER TABLE `payment_methods` ADD COLUMN `commission_bp` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `payment_methods` ADD COLUMN `commission_fixed` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `payment_methods` ADD COLUMN `family` VARCHAR(255);

ALTER TABLE `payment_methods` ADD COLUMN `fields` TEXT;

ALTER TABLE `payment_methods` ADD COLUMN `merchant_account` TEXT;

ALTER TABLE `payment_methods` ADD COLUMN `payout` VARCHAR(255) NOT NULL DEFAULT 'deferred';

ALTER TABLE `online_payments` ADD COLUMN `currency` VARCHAR(255);

ALTER TABLE `online_payments` ADD COLUMN `commission` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `online_payments` ADD COLUMN `ip` VARCHAR(255);

ALTER TABLE `online_payments` ADD COLUMN `payer_ref` VARCHAR(255);

ALTER TABLE `online_payments` ADD COLUMN `refunded` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `online_payments` ADD COLUMN `risk_score` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `online_payments` ADD COLUMN `risk_flags` TEXT;

ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_online_payment_id` FOREIGN KEY (`online_payment_id`) REFERENCES `online_payments` (`id`);

ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_order_id` FOREIGN KEY (`order_id`) REFERENCES `customer_orders` (`id`);

ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);

ALTER TABLE `payment_refunds` ADD CONSTRAINT `fk_payment_refunds_online_payment_id` FOREIGN KEY (`online_payment_id`) REFERENCES `online_payments` (`id`);

ALTER TABLE `payment_refunds` ADD CONSTRAINT `fk_payment_refunds_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `payment_refunds` ADD CONSTRAINT `fk_payment_refunds_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

ALTER TABLE `payouts` ADD CONSTRAINT `fk_payouts_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `payouts` ADD CONSTRAINT `fk_payouts_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

CREATE INDEX `idx_receipts_ph` ON `receipts` (`pharmacy_id`);

CREATE INDEX `idx_receipts_cust` ON `receipts` (`customer_id`);

CREATE INDEX `idx_filescans_v` ON `file_scans` (`verdict`);

CREATE INDEX `idx_payouts_ph` ON `payouts` (`pharmacy_id`);

INSERT INTO currency_rates(code,per_eur) VALUES ('EUR',1),('USD',1.08),('GBP',0.85),('CAD',1.47),('TND',3.35),('XOF',655.957),('XAF',655.957),('MAD',10.8),('DZD',146),('NGN',1650),('GHS',16),('KES',140),('EGP',52),('CHF',0.96);

ALTER TABLE `payment_methods` MODIFY `config` TEXT, MODIFY `instructions` TEXT;
ALTER TABLE `online_payments` MODIFY `detail` TEXT, MODIFY `checkout_url` TEXT;
