-- Gestion_pharmacie — schéma MariaDB 10.6+ (InnoDB, utf8mb4). GÉNÉRÉ par tools/gen-mariadb.js — ne pas modifier à la main.
-- ⚠ Non exécuté sur un serveur MariaDB dans l'environnement de développement initial : valider sur une instance de test (voir docs/MISE_EN_LIGNE.md).
-- Montants : BIGINT en plus petite unité monétaire (ex. millimes pour TND).
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE `pharmacies` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `address` TEXT,
  `phone` VARCHAR(255),
  `email` VARCHAR(255),
  `currency` VARCHAR(255) NOT NULL DEFAULT 'TND',
  `currency_decimals` BIGINT NOT NULL DEFAULT 3,
  `timezone` VARCHAR(255) NOT NULL DEFAULT 'Africa/Tunis',
  `invoice_prefix` VARCHAR(255) NOT NULL DEFAULT 'F',
  `legal_notice` TEXT,
  `status` VARCHAR(255) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `country_id` BIGINT,
  `city` VARCHAR(255),
  `lat` DOUBLE,
  `lng` DOUBLE,
  `logo_path` VARCHAR(255),
  `manager_user_id` BIGINT,
  `appointments_enabled` BIGINT NOT NULL DEFAULT 0,
  `opening_hours` VARCHAR(255),
  `public_listed` BIGINT NOT NULL DEFAULT 1,
  `currencies` TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `settings` (
  `pharmacy_id` BIGINT NOT NULL,
  `skey` VARCHAR(255) NOT NULL,
  `svalue` VARCHAR(1000) NOT NULL,
  PRIMARY KEY (`pharmacy_id`, `skey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `roles` (
  `code` VARCHAR(255) PRIMARY KEY,
  `label` VARCHAR(255) NOT NULL,
  `privileged` BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `permissions` (
  `code` VARCHAR(255) PRIMARY KEY,
  `label` VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `role_permissions` (
  `role_code` VARCHAR(255) NOT NULL,
  `permission_code` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`role_code`, `permission_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `role_code` VARCHAR(255) NOT NULL,
  `pharmacy_id` BIGINT,
  `phone` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'active',
  `failed_attempts` BIGINT NOT NULL DEFAULT 0,
  `locked_until` DATETIME NULL DEFAULT NULL,
  `mfa_secret` VARCHAR(255),
  `mfa_enabled` BIGINT NOT NULL DEFAULT 0,
  `must_change_password` BIGINT NOT NULL DEFAULT 0,
  `lang` VARCHAR(255) NOT NULL DEFAULT 'fr',
  `last_login_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status_reason` TEXT,
  `suspended_until` DATETIME NULL DEFAULT NULL,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  `is_primary` BIGINT NOT NULL DEFAULT 0,
  `avatar_path` VARCHAR(255),
  `is_guest` BIGINT NOT NULL DEFAULT 0,
  `created_by` BIGINT,
  `country_id` BIGINT,
  `see_all_countries` BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `refresh_tokens` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL UNIQUE,
  `family` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked` BIGINT NOT NULL DEFAULT 0,
  `device` VARCHAR(255),
  `ip` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `login_attempts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(255),
  `ip` VARCHAR(255),
  `success` BIGINT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT,
  `user_id` BIGINT,
  `user_email` VARCHAR(255),
  `action` VARCHAR(255) NOT NULL,
  `entity` VARCHAR(255),
  `entity_id` VARCHAR(255),
  `old_json` TEXT,
  `new_json` TEXT,
  `ip` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `user_agent` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `categories` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL UNIQUE,
  `kind` VARCHAR(255) NOT NULL DEFAULT 'medicament'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `manufacturers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `products` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `sku` VARCHAR(255) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `dci` VARCHAR(255),
  `dosage` VARCHAR(255),
  `form` VARCHAR(255),
  `route` VARCHAR(255),
  `packaging` VARCHAR(255),
  `manufacturer_id` BIGINT,
  `category_id` BIGINT,
  `barcode` VARCHAR(255) UNIQUE,
  `rx_status` VARCHAR(255) NOT NULL DEFAULT 'free' CHECK (rx_status IN ('free','prescription','controlled')),
  `storage_conditions` TEXT,
  `cold_chain` BIGINT NOT NULL DEFAULT 0,
  `generic_group` VARCHAR(255),
  `min_stock` BIGINT NOT NULL DEFAULT 0,
  `critical_stock` BIGINT NOT NULL DEFAULT 0,
  `max_stock` BIGINT NOT NULL DEFAULT 0,
  `tax_rate` DOUBLE NOT NULL DEFAULT 0,
  `purchase_price` BIGINT NOT NULL DEFAULT 0,
  `sale_price` BIGINT NOT NULL DEFAULT 0,
  `image_url` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'active',
  `created_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_price_history` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `product_id` BIGINT NOT NULL,
  `purchase_price` BIGINT NOT NULL,
  `sale_price` BIGINT NOT NULL,
  `changed_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `suppliers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `contact_name` VARCHAR(255),
  `phone` VARCHAR(255),
  `email` VARCHAR(255),
  `address` TEXT,
  `legal_id` VARCHAR(255),
  `payment_terms` VARCHAR(255),
  `lead_days` BIGINT NOT NULL DEFAULT 2,
  `rating` BIGINT NOT NULL DEFAULT 0,
  `status` VARCHAR(255) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `batches` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `product_id` BIGINT NOT NULL,
  `batch_no` VARCHAR(255) NOT NULL,
  `mfg_date` DATE,
  `exp_date` DATE NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','quarantine','recalled','blocked')),
  `status_reason` TEXT,
  `supplier_id` BIGINT,
  `unit_cost` BIGINT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`product_id`, `batch_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `stock_levels` (
  `pharmacy_id` BIGINT NOT NULL,
  `batch_id` BIGINT NOT NULL,
  `location` VARCHAR(255),
  `qty_available` BIGINT NOT NULL DEFAULT 0 CHECK (qty_available >= 0),
  `qty_reserved` BIGINT NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  `qty_quarantine` BIGINT NOT NULL DEFAULT 0 CHECK (qty_quarantine >= 0),
  `qty_damaged` BIGINT NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pharmacy_id`, `batch_id`),
  CHECK (qty_reserved <= qty_available)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `stock_movements` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `batch_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `movement_type` VARCHAR(255) NOT NULL,
  `qty` BIGINT NOT NULL,
  `bucket` VARCHAR(255) NOT NULL DEFAULT 'available',
  `reason` TEXT,
  `ref_type` VARCHAR(255),
  `ref_id` BIGINT,
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `purchase_orders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `supplier_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `status` VARCHAR(255) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partial','received','cancelled')),
  `expected_date` DATE,
  `notes` TEXT,
  `created_by` BIGINT,
  `approved_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `purchase_order_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `po_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `qty_ordered` BIGINT NOT NULL CHECK (qty_ordered > 0),
  `qty_received` BIGINT NOT NULL DEFAULT 0,
  `unit_cost` BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `goods_receipts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `po_id` BIGINT,
  `supplier_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `supplier_invoice_ref` VARCHAR(255),
  `notes` TEXT,
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `goods_receipt_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `receipt_id` BIGINT NOT NULL,
  `po_line_id` BIGINT,
  `product_id` BIGINT NOT NULL,
  `batch_id` BIGINT NOT NULL,
  `qty` BIGINT NOT NULL CHECK (qty > 0),
  `unit_cost` BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inventory_sessions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `kind` VARCHAR(255) NOT NULL DEFAULT 'full',
  `status` VARCHAR(255) NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','validated','cancelled')),
  `created_by` BIGINT,
  `validated_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` DATETIME NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inventory_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `session_id` BIGINT NOT NULL,
  `batch_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `expected_qty` BIGINT NOT NULL,
  `counted_qty` BIGINT,
  `reason` TEXT,
  UNIQUE (`session_id`, `batch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `user_id` BIGINT,
  `name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(255),
  `email` VARCHAR(255),
  `address` TEXT,
  `birth_date` DATE,
  `loyalty_points` BIGINT NOT NULL DEFAULT 0,
  `marketing_consent` BIGINT NOT NULL DEFAULT 0,
  `consent_at` DATETIME NULL DEFAULT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `loyalty_transactions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `customer_id` BIGINT NOT NULL,
  `sale_id` BIGINT,
  `points` BIGINT NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cash_registers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cash_sessions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `register_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `opening_float` BIGINT NOT NULL DEFAULT 0,
  `expected_cash` BIGINT,
  `counted_cash` BIGINT,
  `difference` BIGINT,
  `difference_reason` TEXT,
  `status` VARCHAR(255) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  `opened_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` DATETIME NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cash_movements` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `session_id` BIGINT NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `method` VARCHAR(255) NOT NULL DEFAULT 'cash',
  `amount` BIGINT NOT NULL,
  `ref_type` VARCHAR(255),
  `ref_id` BIGINT,
  `reason` TEXT,
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `prescriptions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `customer_id` BIGINT,
  `patient_name` VARCHAR(255) NOT NULL,
  `prescriber_name` VARCHAR(255),
  `prescription_date` DATE,
  `valid_until` DATE,
  `renewals_allowed` BIGINT NOT NULL DEFAULT 0,
  `status` VARCHAR(255) NOT NULL DEFAULT 'received' CHECK (status IN ('received','to_verify','complement_requested','validated','partially_delivered','delivered','rejected')),
  `file_name` VARCHAR(255),
  `file_path` VARCHAR(255),
  `file_mime` VARCHAR(255),
  `notes` TEXT,
  `status_reason` TEXT,
  `validated_by` BIGINT,
  `created_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `subject` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `prescription_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `prescription_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `qty_prescribed` BIGINT NOT NULL CHECK (qty_prescribed > 0),
  `qty_delivered` BIGINT NOT NULL DEFAULT 0,
  `posology` TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `prescription_reviews` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `prescription_id` BIGINT NOT NULL,
  `from_status` VARCHAR(255),
  `to_status` VARCHAR(255) NOT NULL,
  `reason` TEXT,
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sales` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `customer_id` BIGINT,
  `cashier_id` BIGINT NOT NULL,
  `cash_session_id` BIGINT NOT NULL,
  `prescription_id` BIGINT,
  `order_id` BIGINT,
  `subtotal` BIGINT NOT NULL,
  `discount` BIGINT NOT NULL DEFAULT 0,
  `tax_total` BIGINT NOT NULL,
  `total` BIGINT NOT NULL,
  `paid` BIGINT NOT NULL,
  `change_given` BIGINT NOT NULL DEFAULT 0,
  `status` VARCHAR(255) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','partially_refunded','refunded')),
  `idempotency_key` VARCHAR(255) UNIQUE,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `offline_at` DATETIME NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sale_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `sale_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `batch_id` BIGINT NOT NULL,
  `qty` BIGINT NOT NULL CHECK (qty > 0),
  `qty_refunded` BIGINT NOT NULL DEFAULT 0,
  `unit_price` BIGINT NOT NULL,
  `discount` BIGINT NOT NULL DEFAULT 0,
  `tax_rate` DOUBLE NOT NULL DEFAULT 0,
  `unit_cost` BIGINT NOT NULL DEFAULT 0,
  `line_total` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `sale_id` BIGINT NOT NULL,
  `method` VARCHAR(255) NOT NULL CHECK (method IN ('cash','card','mobile','transfer','wallet')),
  `amount` BIGINT NOT NULL CHECK (amount > 0),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `method_code` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `refunds` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `sale_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `amount` BIGINT NOT NULL,
  `method` VARCHAR(255) NOT NULL DEFAULT 'cash',
  `reason` TEXT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `approved_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cash_amount` BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `refund_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `refund_id` BIGINT NOT NULL,
  `sale_line_id` BIGINT NOT NULL,
  `qty` BIGINT NOT NULL CHECK (qty > 0),
  `amount` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `dispensing_records` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `prescription_id` BIGINT NOT NULL,
  `sale_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `batch_id` BIGINT NOT NULL,
  `qty` BIGINT NOT NULL,
  `pharmacist_id` BIGINT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customer_orders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `customer_id` BIGINT NOT NULL,
  `kind` VARCHAR(255) NOT NULL DEFAULT 'reservation' CHECK (kind IN ('reservation','order')),
  `status` VARCHAR(255) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','preparing','ready','picked_up','cancelled','expired')),
  `expires_at` DATETIME NULL DEFAULT NULL,
  `delivery_address` TEXT,
  `notes` TEXT,
  `created_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `wants_delivery` BIGINT,
  `pay_mode` VARCHAR(255),
  `pay_method_code` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_lines` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `order_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `qty` BIGINT NOT NULL CHECK (qty > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `stock_reservations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `order_line_id` BIGINT NOT NULL,
  `pharmacy_id` BIGINT NOT NULL,
  `batch_id` BIGINT NOT NULL,
  `qty` BIGINT NOT NULL CHECK (qty > 0),
  `released` BIGINT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_status_history` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `order_id` BIGINT NOT NULL,
  `from_status` VARCHAR(255),
  `to_status` VARCHAR(255) NOT NULL,
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT,
  `user_id` BIGINT,
  `audience` VARCHAR(255),
  `kind` VARCHAR(255) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT,
  `dedupe_key` VARCHAR(255),
  `is_read` BIGINT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `link` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `temperature_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `location` VARCHAR(255) NOT NULL,
  `celsius` DOUBLE NOT NULL,
  `in_range` BIGINT NOT NULL,
  `user_id` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `doc_counters` (
  `pharmacy_id` BIGINT NOT NULL,
  `doc_type` VARCHAR(255) NOT NULL,
  `year` BIGINT NOT NULL,
  `last_no` BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`pharmacy_id`, `doc_type`, `year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `method_code` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `period_locks` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `locked_until` DATE NOT NULL,
  `note` VARCHAR(255),
  `created_by` BIGINT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `password_resets` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL UNIQUE,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_permissions` (
  `user_id` BIGINT NOT NULL,
  `permission_code` VARCHAR(255) NOT NULL,
  `effect` VARCHAR(255) NOT NULL,
  `updated_by` BIGINT,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `permission_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_preferences` (
  `user_id` BIGINT PRIMARY KEY,
  `data` VARCHAR(255) NOT NULL DEFAULT '{}',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `push_tokens` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT NOT NULL,
  `token` VARCHAR(255) NOT NULL UNIQUE,
  `platform` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payment_methods` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(255) NOT NULL UNIQUE,
  `label` VARCHAR(255) NOT NULL,
  `kind` VARCHAR(255) NOT NULL CHECK (kind IN ('cash','card','mobile','transfer','wallet')),
  `provider` VARCHAR(255) NOT NULL DEFAULT 'manual',
  `enabled` BIGINT NOT NULL DEFAULT 1,
  `channel_pos` BIGINT NOT NULL DEFAULT 1,
  `channel_online` BIGINT NOT NULL DEFAULT 0,
  `instructions` TEXT,
  `config` TEXT,
  `sort_order` BIGINT NOT NULL DEFAULT 100,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `countries` TEXT,
  `currencies` TEXT,
  `commission_bp` BIGINT NOT NULL DEFAULT 0,
  `commission_fixed` BIGINT NOT NULL DEFAULT 0,
  `family` VARCHAR(255),
  `fields` TEXT,
  `merchant_account` TEXT,
  `payout` VARCHAR(255) NOT NULL DEFAULT 'deferred',
  `otp_required` BIGINT NOT NULL DEFAULT 0,
  `otp_ttl` BIGINT NOT NULL DEFAULT 120
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `online_payments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `order_id` BIGINT NOT NULL,
  `customer_id` BIGINT NOT NULL,
  `user_id` BIGINT,
  `method_code` VARCHAR(255) NOT NULL,
  `provider` VARCHAR(255) NOT NULL,
  `amount` BIGINT NOT NULL CHECK (amount > 0),
  `status` VARCHAR(255) NOT NULL DEFAULT 'pending',
  `provider_ref` VARCHAR(255),
  `checkout_url` TEXT,
  `deposit_id` BIGINT,
  `detail` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` DATETIME NULL DEFAULT NULL,
  `currency` VARCHAR(255),
  `commission` BIGINT NOT NULL DEFAULT 0,
  `ip` VARCHAR(255),
  `payer_ref` VARCHAR(255),
  `refunded` BIGINT NOT NULL DEFAULT 0,
  `risk_score` BIGINT NOT NULL DEFAULT 0,
  `risk_flags` TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `drivers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `matricule` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(255),
  `vehicle` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`pharmacy_id`, `matricule`),
  `user_id` BIGINT,
  `availability` VARCHAR(255) NOT NULL DEFAULT 'offline',
  `vehicle_type` VARCHAR(255) NOT NULL DEFAULT 'moto',
  `plate` VARCHAR(255),
  `base_fee` BIGINT NOT NULL DEFAULT 0,
  `per_km` BIGINT NOT NULL DEFAULT 0,
  `speed_kmh` BIGINT NOT NULL DEFAULT 25,
  `wait_min` BIGINT NOT NULL DEFAULT 15,
  `lat` DOUBLE,
  `lng` DOUBLE,
  `loc_at` DATETIME NULL DEFAULT NULL,
  `rating_sum` BIGINT NOT NULL DEFAULT 0,
  `rating_count` BIGINT NOT NULL DEFAULT 0,
  `photo_file` VARCHAR(255),
  `id_doc_file` VARCHAR(255),
  `id_doc_type` VARCHAR(255),
  `id_doc_number` VARCHAR(255),
  `home_address` VARCHAR(255)
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
  `delivered_at` DATETIME NULL DEFAULT NULL,
  `dest_lat` DOUBLE,
  `dest_lng` DOUBLE,
  `distance_m` BIGINT,
  `eta_min` BIGINT,
  `eta_max` BIGINT,
  `driver_response` VARCHAR(255) NOT NULL DEFAULT 'none',
  `cancelled_by` VARCHAR(255),
  `cancel_reason` VARCHAR(255),
  `offer_mode` VARCHAR(255) NOT NULL DEFAULT 'driver',
  `picked_up_at` DATETIME NULL DEFAULT NULL,
  `accepted_at` DATETIME NULL DEFAULT NULL,
  `standard_fee` BIGINT,
  `relaunch_status` VARCHAR(255),
  `relaunch_reason` VARCHAR(255),
  `relaunch_requested_at` DATETIME NULL DEFAULT NULL,
  `mode` VARCHAR(255) NOT NULL DEFAULT 'standard',
  `scheduled_at` DATETIME NULL DEFAULT NULL,
  `reminder_sent` BIGINT NOT NULL DEFAULT 0
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

CREATE TABLE `countries` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `iso2` VARCHAR(255) NOT NULL UNIQUE,
  `name_fr` VARCHAR(255) NOT NULL,
  `name_en` VARCHAR(255) NOT NULL,
  `name_ar` VARCHAR(255),
  `dial_code` VARCHAR(255) NOT NULL,
  `flag_svg` VARCHAR(255),
  `phone_min` BIGINT NOT NULL DEFAULT 6,
  `phone_max` BIGINT NOT NULL DEFAULT 12,
  `active` BIGINT NOT NULL DEFAULT 1,
  `currencies` TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `pharmacy_catalog` (
  `pharmacy_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pharmacy_id`, `product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `trash` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT,
  `entity` VARCHAR(255) NOT NULL,
  `entity_id` BIGINT NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `data` VARCHAR(255) NOT NULL,
  `deleted_by` BIGINT,
  `deleted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `purge_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `help_tickets` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `number` VARCHAR(255) NOT NULL UNIQUE,
  `kind` VARCHAR(255) NOT NULL DEFAULT 'message' CHECK (kind IN ('message','claim','interpharmacy')),
  `pharmacy_id` BIGINT NOT NULL,
  `from_pharmacy_id` BIGINT,
  `from_user_id` BIGINT NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `help_messages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `ticket_id` BIGINT NOT NULL,
  `author_user_id` BIGINT NOT NULL,
  `from_staff` BIGINT NOT NULL DEFAULT 0,
  `reply_as` VARCHAR(255) NOT NULL DEFAULT 'user' CHECK (reply_as IN ('user','pharmacy')),
  `signature` VARCHAR(255),
  `body` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `attachments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `owner_type` VARCHAR(255) NOT NULL,
  `owner_id` BIGINT NOT NULL,
  `sender_user_id` BIGINT NOT NULL,
  `recipient_user_id` BIGINT,
  `name` VARCHAR(255) NOT NULL,
  `mime` VARCHAR(255) NOT NULL,
  `size` BIGINT NOT NULL,
  `path` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','saved','rejected')),
  `decided_by` BIGINT,
  `decided_at` DATETIME NULL DEFAULT NULL,
  `note` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `driver_locations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `driver_id` BIGINT NOT NULL,
  `delivery_id` BIGINT,
  `lat` DOUBLE NOT NULL,
  `lng` DOUBLE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `delivery_messages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `delivery_id` BIGINT NOT NULL,
  `sender_user_id` BIGINT NOT NULL,
  `sender_role` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `file` VARCHAR(255),
  `file_name` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `delivery_ratings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `delivery_id` BIGINT NOT NULL,
  `rater_user_id` BIGINT NOT NULL,
  `target` VARCHAR(255) NOT NULL CHECK (target IN ('driver','customer')),
  `stars` BIGINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  `comment` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`delivery_id`, `target`),
  `status` VARCHAR(255) NOT NULL DEFAULT 'pending',
  `reviewed_by` BIGINT,
  `reviewed_at` DATETIME NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `delivery_reports` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `delivery_id` BIGINT NOT NULL,
  `reporter_user_id` BIGINT NOT NULL,
  `target` VARCHAR(255) NOT NULL CHECK (target IN ('driver','customer')),
  `reason` TEXT NOT NULL,
  `details` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `file` VARCHAR(255),
  `file_name` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `appointment_slots` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `doctor_user_id` BIGINT NOT NULL,
  `starts_at` DATETIME NOT NULL,
  `duration_min` BIGINT NOT NULL DEFAULT 20,
  `online_enabled` BIGINT NOT NULL DEFAULT 1,
  `status` VARCHAR(255) NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `appointments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `pharmacy_id` BIGINT NOT NULL,
  `slot_id` BIGINT NOT NULL,
  `customer_user_id` BIGINT NOT NULL,
  `reason` TEXT,
  `status` VARCHAR(255) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','refused','cancelled','done')),
  `doctor_note` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `file_path` VARCHAR(255),
  `file_name` VARCHAR(255),
  `file_mime` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `stored_files` (
  `name` VARCHAR(255) PRIMARY KEY,
  `is_public` BIGINT NOT NULL DEFAULT 0,
  `mime` VARCHAR(255) NOT NULL,
  `size` BIGINT NOT NULL,
  `data` LONGBLOB NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cities` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `country_id` BIGINT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  UNIQUE (`country_id`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `gateway_status` VARCHAR(255) NOT NULL DEFAULT 'manual',
  `gateway_ref` VARCHAR(255),
  `gateway_error` VARCHAR(255)
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

CREATE TABLE `driver_pharmacies` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `driver_id` BIGINT NOT NULL,
  `pharmacy_id` BIGINT NOT NULL,
  `depart_lat` DOUBLE,
  `depart_lng` DOUBLE,
  `depart_label` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`driver_id`, `pharmacy_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `delivery_offers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `delivery_id` BIGINT NOT NULL,
  `driver_id` BIGINT NOT NULL,
  `kind` VARCHAR(255) NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard','counter')),
  `price` BIGINT NOT NULL CHECK (price >= 0),
  `standard_price` BIGINT NOT NULL,
  `distance_m` BIGINT,
  `eta_min` BIGINT,
  `eta_max` BIGINT,
  `status` VARCHAR(255) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','chosen','rejected','withdrawn')),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`delivery_id`, `driver_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

SET FOREIGN_KEY_CHECKS = 1;

-- Clés étrangères
ALTER TABLE `role_permissions` ADD CONSTRAINT `fk_role_permissions_role_code` FOREIGN KEY (`role_code`) REFERENCES `roles` (`code`);
ALTER TABLE `role_permissions` ADD CONSTRAINT `fk_role_permissions_permission_code` FOREIGN KEY (`permission_code`) REFERENCES `permissions` (`code`);
ALTER TABLE `users` ADD CONSTRAINT `fk_users_role_code` FOREIGN KEY (`role_code`) REFERENCES `roles` (`code`);
ALTER TABLE `users` ADD CONSTRAINT `fk_users_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `fk_refresh_tokens_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `products` ADD CONSTRAINT `fk_products_manufacturer_id` FOREIGN KEY (`manufacturer_id`) REFERENCES `manufacturers` (`id`);
ALTER TABLE `products` ADD CONSTRAINT `fk_products_category_id` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`);
ALTER TABLE `product_price_history` ADD CONSTRAINT `fk_product_price_history_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `batches` ADD CONSTRAINT `fk_batches_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `batches` ADD CONSTRAINT `fk_batches_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`);
ALTER TABLE `stock_levels` ADD CONSTRAINT `fk_stock_levels_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `stock_levels` ADD CONSTRAINT `fk_stock_levels_batch_id` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`);
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movements_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movements_batch_id` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`);
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movements_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movements_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `purchase_orders` ADD CONSTRAINT `fk_purchase_orders_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `purchase_orders` ADD CONSTRAINT `fk_purchase_orders_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`);
ALTER TABLE `purchase_orders` ADD CONSTRAINT `fk_purchase_orders_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);
ALTER TABLE `purchase_orders` ADD CONSTRAINT `fk_purchase_orders_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`);
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `fk_purchase_order_lines_po_id` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`);
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `fk_purchase_order_lines_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `goods_receipts` ADD CONSTRAINT `fk_goods_receipts_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `goods_receipts` ADD CONSTRAINT `fk_goods_receipts_po_id` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`);
ALTER TABLE `goods_receipts` ADD CONSTRAINT `fk_goods_receipts_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`);
ALTER TABLE `goods_receipts` ADD CONSTRAINT `fk_goods_receipts_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `fk_goods_receipt_lines_receipt_id` FOREIGN KEY (`receipt_id`) REFERENCES `goods_receipts` (`id`);
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `fk_goods_receipt_lines_po_line_id` FOREIGN KEY (`po_line_id`) REFERENCES `purchase_order_lines` (`id`);
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `fk_goods_receipt_lines_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `fk_goods_receipt_lines_batch_id` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`);
ALTER TABLE `inventory_sessions` ADD CONSTRAINT `fk_inventory_sessions_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `inventory_sessions` ADD CONSTRAINT `fk_inventory_sessions_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);
ALTER TABLE `inventory_sessions` ADD CONSTRAINT `fk_inventory_sessions_validated_by` FOREIGN KEY (`validated_by`) REFERENCES `users` (`id`);
ALTER TABLE `inventory_lines` ADD CONSTRAINT `fk_inventory_lines_session_id` FOREIGN KEY (`session_id`) REFERENCES `inventory_sessions` (`id`);
ALTER TABLE `inventory_lines` ADD CONSTRAINT `fk_inventory_lines_batch_id` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`);
ALTER TABLE `inventory_lines` ADD CONSTRAINT `fk_inventory_lines_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `customers` ADD CONSTRAINT `fk_customers_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `customers` ADD CONSTRAINT `fk_customers_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `loyalty_transactions` ADD CONSTRAINT `fk_loyalty_transactions_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);
ALTER TABLE `cash_registers` ADD CONSTRAINT `fk_cash_registers_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `cash_sessions` ADD CONSTRAINT `fk_cash_sessions_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `cash_sessions` ADD CONSTRAINT `fk_cash_sessions_register_id` FOREIGN KEY (`register_id`) REFERENCES `cash_registers` (`id`);
ALTER TABLE `cash_sessions` ADD CONSTRAINT `fk_cash_sessions_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `cash_movements` ADD CONSTRAINT `fk_cash_movements_session_id` FOREIGN KEY (`session_id`) REFERENCES `cash_sessions` (`id`);
ALTER TABLE `cash_movements` ADD CONSTRAINT `fk_cash_movements_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `prescriptions` ADD CONSTRAINT `fk_prescriptions_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `prescriptions` ADD CONSTRAINT `fk_prescriptions_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);
ALTER TABLE `prescriptions` ADD CONSTRAINT `fk_prescriptions_validated_by` FOREIGN KEY (`validated_by`) REFERENCES `users` (`id`);
ALTER TABLE `prescriptions` ADD CONSTRAINT `fk_prescriptions_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);
ALTER TABLE `prescription_lines` ADD CONSTRAINT `fk_prescription_lines_prescription_id` FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions` (`id`);
ALTER TABLE `prescription_lines` ADD CONSTRAINT `fk_prescription_lines_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `prescription_reviews` ADD CONSTRAINT `fk_prescription_reviews_prescription_id` FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions` (`id`);
ALTER TABLE `prescription_reviews` ADD CONSTRAINT `fk_prescription_reviews_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `sales` ADD CONSTRAINT `fk_sales_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `sales` ADD CONSTRAINT `fk_sales_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);
ALTER TABLE `sales` ADD CONSTRAINT `fk_sales_cashier_id` FOREIGN KEY (`cashier_id`) REFERENCES `users` (`id`);
ALTER TABLE `sales` ADD CONSTRAINT `fk_sales_cash_session_id` FOREIGN KEY (`cash_session_id`) REFERENCES `cash_sessions` (`id`);
ALTER TABLE `sales` ADD CONSTRAINT `fk_sales_prescription_id` FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions` (`id`);
ALTER TABLE `sale_lines` ADD CONSTRAINT `fk_sale_lines_sale_id` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`);
ALTER TABLE `sale_lines` ADD CONSTRAINT `fk_sale_lines_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `sale_lines` ADD CONSTRAINT `fk_sale_lines_batch_id` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`);
ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_sale_id` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`);
ALTER TABLE `refunds` ADD CONSTRAINT `fk_refunds_sale_id` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`);
ALTER TABLE `refunds` ADD CONSTRAINT `fk_refunds_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `refunds` ADD CONSTRAINT `fk_refunds_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`);
ALTER TABLE `refund_lines` ADD CONSTRAINT `fk_refund_lines_refund_id` FOREIGN KEY (`refund_id`) REFERENCES `refunds` (`id`);
ALTER TABLE `refund_lines` ADD CONSTRAINT `fk_refund_lines_sale_line_id` FOREIGN KEY (`sale_line_id`) REFERENCES `sale_lines` (`id`);
ALTER TABLE `dispensing_records` ADD CONSTRAINT `fk_dispensing_records_prescription_id` FOREIGN KEY (`prescription_id`) REFERENCES `prescriptions` (`id`);
ALTER TABLE `dispensing_records` ADD CONSTRAINT `fk_dispensing_records_sale_id` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`);
ALTER TABLE `dispensing_records` ADD CONSTRAINT `fk_dispensing_records_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `dispensing_records` ADD CONSTRAINT `fk_dispensing_records_batch_id` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`);
ALTER TABLE `dispensing_records` ADD CONSTRAINT `fk_dispensing_records_pharmacist_id` FOREIGN KEY (`pharmacist_id`) REFERENCES `users` (`id`);
ALTER TABLE `customer_orders` ADD CONSTRAINT `fk_customer_orders_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `customer_orders` ADD CONSTRAINT `fk_customer_orders_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);
ALTER TABLE `customer_orders` ADD CONSTRAINT `fk_customer_orders_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);
ALTER TABLE `order_lines` ADD CONSTRAINT `fk_order_lines_order_id` FOREIGN KEY (`order_id`) REFERENCES `customer_orders` (`id`);
ALTER TABLE `order_lines` ADD CONSTRAINT `fk_order_lines_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `stock_reservations` ADD CONSTRAINT `fk_stock_reservations_order_line_id` FOREIGN KEY (`order_line_id`) REFERENCES `order_lines` (`id`);
ALTER TABLE `stock_reservations` ADD CONSTRAINT `fk_stock_reservations_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `stock_reservations` ADD CONSTRAINT `fk_stock_reservations_batch_id` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`id`);
ALTER TABLE `order_status_history` ADD CONSTRAINT `fk_order_status_history_order_id` FOREIGN KEY (`order_id`) REFERENCES `customer_orders` (`id`);
ALTER TABLE `order_status_history` ADD CONSTRAINT `fk_order_status_history_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `temperature_logs` ADD CONSTRAINT `fk_temperature_logs_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `temperature_logs` ADD CONSTRAINT `fk_temperature_logs_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
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
ALTER TABLE `password_resets` ADD CONSTRAINT `fk_password_resets_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `user_permissions` ADD CONSTRAINT `fk_user_permissions_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `user_permissions` ADD CONSTRAINT `fk_user_permissions_permission_code` FOREIGN KEY (`permission_code`) REFERENCES `permissions` (`code`);
ALTER TABLE `user_preferences` ADD CONSTRAINT `fk_user_preferences_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `push_tokens` ADD CONSTRAINT `fk_push_tokens_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `online_payments` ADD CONSTRAINT `fk_online_payments_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `online_payments` ADD CONSTRAINT `fk_online_payments_order_id` FOREIGN KEY (`order_id`) REFERENCES `customer_orders` (`id`);
ALTER TABLE `online_payments` ADD CONSTRAINT `fk_online_payments_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);
ALTER TABLE `online_payments` ADD CONSTRAINT `fk_online_payments_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
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
ALTER TABLE `pharmacy_catalog` ADD CONSTRAINT `fk_pharmacy_catalog_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `pharmacy_catalog` ADD CONSTRAINT `fk_pharmacy_catalog_product_id` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);
ALTER TABLE `help_tickets` ADD CONSTRAINT `fk_help_tickets_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `help_tickets` ADD CONSTRAINT `fk_help_tickets_from_pharmacy_id` FOREIGN KEY (`from_pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `help_tickets` ADD CONSTRAINT `fk_help_tickets_from_user_id` FOREIGN KEY (`from_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `help_messages` ADD CONSTRAINT `fk_help_messages_ticket_id` FOREIGN KEY (`ticket_id`) REFERENCES `help_tickets` (`id`);
ALTER TABLE `help_messages` ADD CONSTRAINT `fk_help_messages_author_user_id` FOREIGN KEY (`author_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `attachments` ADD CONSTRAINT `fk_attachments_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `attachments` ADD CONSTRAINT `fk_attachments_sender_user_id` FOREIGN KEY (`sender_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `attachments` ADD CONSTRAINT `fk_attachments_recipient_user_id` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `attachments` ADD CONSTRAINT `fk_attachments_decided_by` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`);
ALTER TABLE `driver_locations` ADD CONSTRAINT `fk_driver_locations_driver_id` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`);
ALTER TABLE `driver_locations` ADD CONSTRAINT `fk_driver_locations_delivery_id` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`);
ALTER TABLE `delivery_messages` ADD CONSTRAINT `fk_delivery_messages_delivery_id` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`);
ALTER TABLE `delivery_messages` ADD CONSTRAINT `fk_delivery_messages_sender_user_id` FOREIGN KEY (`sender_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `delivery_ratings` ADD CONSTRAINT `fk_delivery_ratings_delivery_id` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`);
ALTER TABLE `delivery_ratings` ADD CONSTRAINT `fk_delivery_ratings_rater_user_id` FOREIGN KEY (`rater_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `delivery_reports` ADD CONSTRAINT `fk_delivery_reports_delivery_id` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`);
ALTER TABLE `delivery_reports` ADD CONSTRAINT `fk_delivery_reports_reporter_user_id` FOREIGN KEY (`reporter_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `appointment_slots` ADD CONSTRAINT `fk_appointment_slots_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `appointment_slots` ADD CONSTRAINT `fk_appointment_slots_doctor_user_id` FOREIGN KEY (`doctor_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_slot_id` FOREIGN KEY (`slot_id`) REFERENCES `appointment_slots` (`id`);
ALTER TABLE `appointments` ADD CONSTRAINT `fk_appointments_customer_user_id` FOREIGN KEY (`customer_user_id`) REFERENCES `users` (`id`);
ALTER TABLE `cities` ADD CONSTRAINT `fk_cities_country_id` FOREIGN KEY (`country_id`) REFERENCES `countries` (`id`) ON DELETE CASCADE;
ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_online_payment_id` FOREIGN KEY (`online_payment_id`) REFERENCES `online_payments` (`id`);
ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_order_id` FOREIGN KEY (`order_id`) REFERENCES `customer_orders` (`id`);
ALTER TABLE `receipts` ADD CONSTRAINT `fk_receipts_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);
ALTER TABLE `payment_refunds` ADD CONSTRAINT `fk_payment_refunds_online_payment_id` FOREIGN KEY (`online_payment_id`) REFERENCES `online_payments` (`id`);
ALTER TABLE `payment_refunds` ADD CONSTRAINT `fk_payment_refunds_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `payment_refunds` ADD CONSTRAINT `fk_payment_refunds_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `payouts` ADD CONSTRAINT `fk_payouts_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `payouts` ADD CONSTRAINT `fk_payouts_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);
ALTER TABLE `driver_pharmacies` ADD CONSTRAINT `fk_driver_pharmacies_driver_id` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`);
ALTER TABLE `driver_pharmacies` ADD CONSTRAINT `fk_driver_pharmacies_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);
ALTER TABLE `delivery_offers` ADD CONSTRAINT `fk_delivery_offers_delivery_id` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`);
ALTER TABLE `delivery_offers` ADD CONSTRAINT `fk_delivery_offers_driver_id` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`);
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
ALTER TABLE `payment_otps` ADD CONSTRAINT `fk_payment_otps_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
ALTER TABLE `payment_otps` ADD CONSTRAINT `fk_payment_otps_order_id` FOREIGN KEY (`order_id`) REFERENCES `customer_orders` (`id`) ON DELETE CASCADE;
ALTER TABLE `fm_nodes` ADD CONSTRAINT `fk_fm_nodes_owner_user_id` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
ALTER TABLE `fm_nodes` ADD CONSTRAINT `fk_fm_nodes_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`) ON DELETE SET NULL;
ALTER TABLE `fm_nodes` ADD CONSTRAINT `fk_fm_nodes_parent_id` FOREIGN KEY (`parent_id`) REFERENCES `fm_nodes` (`id`) ON DELETE CASCADE;
ALTER TABLE `fm_shares` ADD CONSTRAINT `fk_fm_shares_node_id` FOREIGN KEY (`node_id`) REFERENCES `fm_nodes` (`id`) ON DELETE CASCADE;
ALTER TABLE `fm_shares` ADD CONSTRAINT `fk_fm_shares_shared_by` FOREIGN KEY (`shared_by`) REFERENCES `users` (`id`) ON DELETE CASCADE;
ALTER TABLE `pharmacy_payment_methods` ADD CONSTRAINT `fk_pharmacy_payment_methods_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`) ON DELETE CASCADE;

-- Index
CREATE INDEX `idx_batches_product` ON `batches` (`product_id`);
CREATE INDEX `idx_batches_exp` ON `batches` (`exp_date`);
CREATE INDEX `idx_movements_ph` ON `stock_movements` (`pharmacy_id`, `created_at`);
CREATE INDEX `idx_movements_batch` ON `stock_movements` (`batch_id`);
CREATE INDEX `idx_sales_ph_date` ON `sales` (`pharmacy_id`, `created_at`);
CREATE INDEX `idx_sale_lines_sale` ON `sale_lines` (`sale_id`);
CREATE INDEX `idx_audit_ph_date` ON `audit_logs` (`pharmacy_id`, `created_at`);
CREATE INDEX `idx_products_name` ON `products` (`name`);
CREATE INDEX `idx_products_dci` ON `products` (`dci`);
CREATE INDEX `idx_notif_user` ON `notifications` (`user_id`, `is_read`);
CREATE INDEX `idx_presc_ph` ON `prescriptions` (`pharmacy_id`, `status`);
CREATE INDEX `idx_orders_ph` ON `customer_orders` (`pharmacy_id`, `status`);
CREATE INDEX `idx_customers_ph` ON `customers` (`pharmacy_id`, `name`);
CREATE INDEX `idx_transfers_from` ON `transfers` (`from_pharmacy_id`, `status`);
CREATE INDEX `idx_transfers_to` ON `transfers` (`to_pharmacy_id`, `status`);
CREATE INDEX `idx_supplier_payments` ON `supplier_payments` (`supplier_id`);
CREATE INDEX `idx_locks_ph` ON `period_locks` (`pharmacy_id`, `locked_until`);
CREATE INDEX `idx_pwreset_user` ON `password_resets` (`user_id`);
CREATE INDEX `idx_push_user` ON `push_tokens` (`user_id`);
CREATE INDEX `idx_onlinepay_order` ON `online_payments` (`order_id`);
CREATE INDEX `idx_onlinepay_ref` ON `online_payments` (`provider_ref`);
CREATE INDEX `idx_deliveries_ph` ON `deliveries` (`pharmacy_id`, `status`);
CREATE INDEX `idx_deliveries_customer` ON `deliveries` (`customer_id`);
CREATE INDEX `idx_delivery_events` ON `delivery_events` (`delivery_id`);
CREATE INDEX `idx_acc_entries` ON `acc_entries` (`pharmacy_id`, `entry_date`);
CREATE INDEX `idx_acc_lines` ON `acc_entry_lines` (`entry_id`);
CREATE INDEX `idx_catalog_product` ON `pharmacy_catalog` (`product_id`);
CREATE INDEX `idx_trash_purge` ON `trash` (`purge_at`);
CREATE INDEX `idx_tickets_ph` ON `help_tickets` (`pharmacy_id`, `status`);
CREATE INDEX `idx_tickets_user` ON `help_tickets` (`from_user_id`);
CREATE INDEX `idx_help_msgs` ON `help_messages` (`ticket_id`);
CREATE INDEX `idx_attach_owner` ON `attachments` (`owner_type`, `owner_id`);
CREATE INDEX `idx_attach_ph` ON `attachments` (`pharmacy_id`, `status`);
CREATE INDEX `idx_driver_loc` ON `driver_locations` (`delivery_id`, `id`);
CREATE INDEX `idx_dmsg` ON `delivery_messages` (`delivery_id`);
CREATE INDEX `idx_slots` ON `appointment_slots` (`pharmacy_id`, `starts_at`);
CREATE INDEX `idx_appt_user` ON `appointments` (`customer_user_id`);
CREATE INDEX `idx_cities_country` ON `cities` (`country_id`);
CREATE INDEX `idx_receipts_ph` ON `receipts` (`pharmacy_id`);
CREATE INDEX `idx_receipts_cust` ON `receipts` (`customer_id`);
CREATE INDEX `idx_filescans_v` ON `file_scans` (`verdict`);
CREATE INDEX `idx_payouts_ph` ON `payouts` (`pharmacy_id`);
CREATE INDEX `idx_driver_ph` ON `driver_pharmacies` (`pharmacy_id`);
CREATE INDEX `idx_offers_delivery` ON `delivery_offers` (`delivery_id`, `status`);
CREATE INDEX `idx_subs_run` ON `subscriptions` (`status`, `next_run`);
CREATE INDEX `idx_subinv_cust` ON `subscription_invoices` (`customer_id`);
CREATE INDEX `idx_payment_otps_user` ON `payment_otps` (`user_id`, `order_id`, `method_code`);
CREATE INDEX `idx_fm_nodes_parent` ON `fm_nodes` (`parent_id`);
CREATE INDEX `idx_fm_nodes_owner` ON `fm_nodes` (`owner_user_id`);

-- Tables en ajout seul / suppression interdite des pièces validées
CREATE TRIGGER `audit_logs_no_update` BEFORE UPDATE ON `audit_logs` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs est en ajout seul';
CREATE TRIGGER `audit_logs_no_delete` BEFORE DELETE ON `audit_logs` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs est en ajout seul';
CREATE TRIGGER `stock_movements_no_update` BEFORE UPDATE ON `stock_movements` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movements est en ajout seul';
CREATE TRIGGER `stock_movements_no_delete` BEFORE DELETE ON `stock_movements` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movements est en ajout seul';
CREATE TRIGGER `sales_no_delete` BEFORE DELETE ON `sales` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'une vente validée ne peut pas être supprimée (utiliser un remboursement)';
CREATE TRIGGER `sale_lines_no_delete` BEFORE DELETE ON `sale_lines` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'une vente validée ne peut pas être supprimée (utiliser un remboursement)';
