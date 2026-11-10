-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `transfers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `from_pharmacy_id` BIGINT NOT NULL,
  `to_pharmacy_id` BIGINT NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','shipped','received','cancelled','rejected')),
  `notes` TEXT,
  `created_by` BIGINT,
  `shipped_by` BIGINT,
  `received_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `shipped_at` DATETIME NULL DEFAULT NULL,
  `received_at` DATETIME NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `transfer_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `transfer_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `batch_id` BIGINT NOT NULL,
  `qty` BIGINT NOT NULL CHECK (qty > 0),
  `qty_received` BIGINT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `supplier_returns` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `supplier_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `receipt_id` BIGINT,
  `reason` TEXT NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','credited','cancelled')),
  `credit_amount` BIGINT,
  `credit_note_ref` VARCHAR(255),
  `created_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `credited_at` DATETIME NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `supplier_return_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `return_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `batch_id` BIGINT NOT NULL,
  `qty` BIGINT NOT NULL CHECK (qty > 0),
  `bucket` VARCHAR(255) NOT NULL DEFAULT 'available',
  `unit_cost` BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `supplier_payments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `supplier_id` BIGINT NOT NULL,
  `amount` BIGINT NOT NULL CHECK (amount > 0),
  `method` VARCHAR(255) NOT NULL DEFAULT 'transfer',
  `reference` VARCHAR(255),
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_deposits` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `order_id` BIGINT NOT NULL,
  `method` VARCHAR(255) NOT NULL CHECK (method IN ('cash','card','mobile','transfer','wallet')),
  `amount` BIGINT NOT NULL CHECK (amount > 0),
  `session_id` BIGINT,
  `status` VARCHAR(255) NOT NULL DEFAULT 'held' CHECK (status IN ('held','applied','refunded')),
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `period_locks` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `locked_until` DATE NOT NULL,
  `note` VARCHAR(255),
  `created_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `refunds` ADD COLUMN `cash_amount` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `transfers` ADD CONSTRAINT `fk_transfers_from_pharmacy_id` FOREIGN KEY (`from_pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `transfers` ADD CONSTRAINT `fk_transfers_to_pharmacy_id` FOREIGN KEY (`to_pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `transfers` ADD CONSTRAINT `fk_transfers_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

ALTER TABLE `transfers` ADD CONSTRAINT `fk_transfers_shipped_by` FOREIGN KEY (`shipped_by`) REFERENCES `users` (`id`);

ALTER TABLE `transfers` ADD CONSTRAINT `fk_transfers_received_by` FOREIGN KEY (`received_by`) REFERENCES `users` (`id`);

ALTER TABLE `transfer_lines` ADD CONSTRAINT `fk_transfer_lines_transfer_id` FOREIGN KEY (`transfer_id`) REFERENCES `transfers` (`id`);

ALTER TABLE `transfer_lines` ADD CONSTRAINT `fk_transfer_lines_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);

ALTER TABLE `transfer_lines` ADD CONSTRAINT `fk_transfer_lines_batch_id` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`);

ALTER TABLE `supplier_returns` ADD CONSTRAINT `fk_supplier_returns_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `supplier_returns` ADD CONSTRAINT `fk_supplier_returns_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`);

ALTER TABLE `supplier_returns` ADD CONSTRAINT `fk_supplier_returns_receipt_id` FOREIGN KEY (`receipt_id`) REFERENCES `goods_receipts` (`id`);

ALTER TABLE `supplier_returns` ADD CONSTRAINT `fk_supplier_returns_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

ALTER TABLE `supplier_return_lines` ADD CONSTRAINT `fk_supplier_return_lines_return_id` FOREIGN KEY (`return_id`) REFERENCES `supplier_returns` (`id`);

ALTER TABLE `supplier_return_lines` ADD CONSTRAINT `fk_supplier_return_lines_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);

ALTER TABLE `supplier_return_lines` ADD CONSTRAINT `fk_supplier_return_lines_batch_id` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`);

ALTER TABLE `supplier_payments` ADD CONSTRAINT `fk_supplier_payments_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `supplier_payments` ADD CONSTRAINT `fk_supplier_payments_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`);

ALTER TABLE `supplier_payments` ADD CONSTRAINT `fk_supplier_payments_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

ALTER TABLE `order_deposits` ADD CONSTRAINT `fk_order_deposits_order_id` FOREIGN KEY (`order_id`) REFERENCES `customer_orders` (`id`);

ALTER TABLE `order_deposits` ADD CONSTRAINT `fk_order_deposits_session_id` FOREIGN KEY (`session_id`) REFERENCES `cash_sessions` (`id`);

ALTER TABLE `order_deposits` ADD CONSTRAINT `fk_order_deposits_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

ALTER TABLE `period_locks` ADD CONSTRAINT `fk_period_locks_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `period_locks` ADD CONSTRAINT `fk_period_locks_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

CREATE INDEX `idx_transfers_from` ON `transfers` (`from_pharmacy_id`, `status`);

CREATE INDEX `idx_transfers_to` ON `transfers` (`to_pharmacy_id`, `status`);

CREATE INDEX `idx_supplier_payments` ON `supplier_payments` (`supplier_id`);

CREATE INDEX `idx_locks_ph` ON `period_locks` (`pharmacy_id`, `locked_until`);

UPDATE refunds SET cash_amount = amount;
