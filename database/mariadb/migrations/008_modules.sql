-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `drivers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `matricule` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(255),
  `vehicle` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`pharmacy_id`, `matricule`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `deliveries` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `order_id` BIGINT NOT NULL UNIQUE,
  `customer_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `address` TEXT NOT NULL,
  `phone` VARCHAR(255),
  `notes` TEXT,
  `fee` BIGINT NOT NULL DEFAULT 0,
  `driver_id` BIGINT,
  `status` VARCHAR(255) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','received','in_progress','delivered','failed','cancelled')),
  `failure_reason` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivered_at` DATETIME NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `delivery_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `delivery_id` BIGINT NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  `note` VARCHAR(255),
  `user_id` BIGINT,
  `driver_name` VARCHAR(255),
  `driver_matricule` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rfqs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `title` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','closed','cancelled')),
  `deadline` VARCHAR(255),
  `notes` TEXT,
  `po_id` BIGINT,
  `created_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rfq_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `rfq_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `qty` BIGINT NOT NULL CHECK (qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rfq_suppliers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `rfq_id` BIGINT NOT NULL,
  `supplier_id` BIGINT NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','quoted','declined')),
  `lead_days` BIGINT,
  `notes` TEXT,
  `sent_at` DATETIME NULL DEFAULT NULL,
  `quoted_at` DATETIME NULL DEFAULT NULL,
  UNIQUE (`rfq_id`, `supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rfq_quotes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `rfq_supplier_id` BIGINT NOT NULL,
  `rfq_line_id` BIGINT NOT NULL,
  `unit_price` BIGINT NOT NULL CHECK (unit_price >= 0),
  UNIQUE (`rfq_supplier_id`, `rfq_line_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `acc_accounts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `code` VARCHAR(255) NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `type` VARCHAR(255) NOT NULL CHECK (type IN ('asset','liability','equity','expense','income')),
  `is_system` BIGINT NOT NULL DEFAULT 0,
  UNIQUE (`pharmacy_id`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `acc_entries` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `entry_date` VARCHAR(255) NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `reference` VARCHAR(255),
  `reversed_of` BIGINT,
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `acc_entry_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `entry_id` BIGINT NOT NULL,
  `account_code` VARCHAR(255) NOT NULL,
  `debit` BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
  `credit` BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
  `memo` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `drivers` ADD CONSTRAINT `fk_drivers_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `deliveries` ADD CONSTRAINT `fk_deliveries_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `deliveries` ADD CONSTRAINT `fk_deliveries_order_id` FOREIGN KEY (`order_id`) REFERENCES `customer_orders` (`id`);

ALTER TABLE `deliveries` ADD CONSTRAINT `fk_deliveries_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);

ALTER TABLE `deliveries` ADD CONSTRAINT `fk_deliveries_driver_id` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`);

ALTER TABLE `delivery_events` ADD CONSTRAINT `fk_delivery_events_delivery_id` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`);

ALTER TABLE `delivery_events` ADD CONSTRAINT `fk_delivery_events_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

ALTER TABLE `rfqs` ADD CONSTRAINT `fk_rfqs_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `rfqs` ADD CONSTRAINT `fk_rfqs_po_id` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`);

ALTER TABLE `rfqs` ADD CONSTRAINT `fk_rfqs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);

ALTER TABLE `rfq_lines` ADD CONSTRAINT `fk_rfq_lines_rfq_id` FOREIGN KEY (`rfq_id`) REFERENCES `rfqs` (`id`);

ALTER TABLE `rfq_lines` ADD CONSTRAINT `fk_rfq_lines_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);

ALTER TABLE `rfq_suppliers` ADD CONSTRAINT `fk_rfq_suppliers_rfq_id` FOREIGN KEY (`rfq_id`) REFERENCES `rfqs` (`id`);

ALTER TABLE `rfq_suppliers` ADD CONSTRAINT `fk_rfq_suppliers_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`);

ALTER TABLE `rfq_quotes` ADD CONSTRAINT `fk_rfq_quotes_rfq_supplier_id` FOREIGN KEY (`rfq_supplier_id`) REFERENCES `rfq_suppliers` (`id`);

ALTER TABLE `rfq_quotes` ADD CONSTRAINT `fk_rfq_quotes_rfq_line_id` FOREIGN KEY (`rfq_line_id`) REFERENCES `rfq_lines` (`id`);

ALTER TABLE `acc_accounts` ADD CONSTRAINT `fk_acc_accounts_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `acc_entries` ADD CONSTRAINT `fk_acc_entries_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `acc_entries` ADD CONSTRAINT `fk_acc_entries_reversed_of` FOREIGN KEY (`reversed_of`) REFERENCES `acc_entries` (`id`);

ALTER TABLE `acc_entries` ADD CONSTRAINT `fk_acc_entries_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

ALTER TABLE `acc_entry_lines` ADD CONSTRAINT `fk_acc_entry_lines_entry_id` FOREIGN KEY (`entry_id`) REFERENCES `acc_entries` (`id`);

CREATE INDEX `idx_deliveries_ph` ON `deliveries` (`pharmacy_id`, `status`);

CREATE INDEX `idx_deliveries_customer` ON `deliveries` (`customer_id`);

CREATE INDEX `idx_delivery_events` ON `delivery_events` (`delivery_id`);

CREATE INDEX `idx_acc_entries` ON `acc_entries` (`pharmacy_id`, `entry_date`);

CREATE INDEX `idx_acc_lines` ON `acc_entry_lines` (`entry_id`);
