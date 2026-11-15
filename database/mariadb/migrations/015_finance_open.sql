-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `platform_settings` (
  `skey` VARCHAR(255) PRIMARY KEY,
  `svalue` VARCHAR(1000),
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `subscriptions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `customer_id` BIGINT NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `amount` BIGINT NOT NULL CHECK (amount > 0),
  `currency` VARCHAR(255) NOT NULL,
  `period` VARCHAR(255) NOT NULL DEFAULT 'month',
  `next_run` VARCHAR(255) NOT NULL,
  `ends_on` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'active',
  `method_code` VARCHAR(255),
  `runs` BIGINT NOT NULL DEFAULT 0,
  `created_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `subscription_invoices` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `subscription_id` BIGINT NOT NULL,
  `pharmacy_id` BIGINT NOT NULL,
  `customer_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `amount` BIGINT NOT NULL,
  `currency` VARCHAR(255) NOT NULL,
  `due_on` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'due',
  `paid_at` DATETIME NULL DEFAULT NULL,
  `method_code` VARCHAR(255),
  `reference` VARCHAR(255),
  `reminded_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `kyc_records` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL UNIQUE,
  `holder_name` VARCHAR(255) NOT NULL,
  `doc_type` VARCHAR(255) NOT NULL,
  `doc_number` VARCHAR(255),
  `doc_file` VARCHAR(255) NOT NULL,
  `proof_file` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'pending',
  `note` VARCHAR(255),
  `submitted_by` BIGINT,
  `reviewed_by` BIGINT,
  `reviewed_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sms_log` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT,
  `user_id` BIGINT,
  `phone` VARCHAR(255),
  `body` TEXT,
  `status` VARCHAR(255) NOT NULL,
  `error` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `api_keys` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT,
  `name` VARCHAR(255) NOT NULL,
  `prefix` VARCHAR(255) NOT NULL,
  `key_hash` VARCHAR(255) NOT NULL UNIQUE,
  `scopes` VARCHAR(255) NOT NULL DEFAULT 'payments:read',
  `created_by` BIGINT,
  `last_used_at` DATETIME NULL DEFAULT NULL,
  `revoked_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `webhook_endpoints` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT,
  `url` VARCHAR(255) NOT NULL,
  `secret` VARCHAR(255) NOT NULL,
  `events` VARCHAR(255) NOT NULL DEFAULT 'payment.paid,payment.refunded',
  `active` BIGINT NOT NULL DEFAULT 1,
  `last_status` VARCHAR(255),
  `last_at` DATETIME NULL DEFAULT NULL,
  `created_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `payment_refunds` ADD COLUMN `gateway_status` VARCHAR(255) NOT NULL DEFAULT 'manual';

ALTER TABLE `payment_refunds` ADD COLUMN `gateway_ref` VARCHAR(255);

ALTER TABLE `payment_refunds` ADD COLUMN `gateway_error` VARCHAR(255);

ALTER TABLE `subscriptions` ADD CONSTRAINT `fk_subscriptions_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `subscriptions` ADD CONSTRAINT `fk_subscriptions_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);

ALTER TABLE `subscriptions` ADD CONSTRAINT `fk_subscriptions_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

ALTER TABLE `subscription_invoices` ADD CONSTRAINT `fk_subscription_invoices_subscription_id` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions` (`id`);

ALTER TABLE `subscription_invoices` ADD CONSTRAINT `fk_subscription_invoices_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `subscription_invoices` ADD CONSTRAINT `fk_subscription_invoices_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);

ALTER TABLE `kyc_records` ADD CONSTRAINT `fk_kyc_records_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `kyc_records` ADD CONSTRAINT `fk_kyc_records_submitted_by` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`);

ALTER TABLE `kyc_records` ADD CONSTRAINT `fk_kyc_records_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`);

ALTER TABLE `api_keys` ADD CONSTRAINT `fk_api_keys_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `api_keys` ADD CONSTRAINT `fk_api_keys_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

ALTER TABLE `webhook_endpoints` ADD CONSTRAINT `fk_webhook_endpoints_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `webhook_endpoints` ADD CONSTRAINT `fk_webhook_endpoints_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

CREATE INDEX `idx_subs_run` ON `subscriptions` (`status`, `next_run`);

CREATE INDEX `idx_subinv_cust` ON `subscription_invoices` (`customer_id`);
