-- GÉNÉRÉ par tools/gen-mariadb.js
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

ALTER TABLE `drivers` ADD COLUMN `photo_file` VARCHAR(255);

ALTER TABLE `drivers` ADD COLUMN `id_doc_file` VARCHAR(255);

ALTER TABLE `drivers` ADD COLUMN `id_doc_type` VARCHAR(255);

ALTER TABLE `drivers` ADD COLUMN `id_doc_number` VARCHAR(255);

ALTER TABLE `drivers` ADD COLUMN `home_address` VARCHAR(255);

ALTER TABLE `deliveries` ADD COLUMN `offer_mode` VARCHAR(255) NOT NULL DEFAULT 'driver';

ALTER TABLE `deliveries` ADD COLUMN `picked_up_at` DATETIME NULL DEFAULT NULL;

ALTER TABLE `deliveries` ADD COLUMN `accepted_at` DATETIME NULL DEFAULT NULL;

ALTER TABLE `deliveries` ADD COLUMN `standard_fee` BIGINT;

ALTER TABLE `delivery_messages` ADD COLUMN `file` VARCHAR(255);

ALTER TABLE `delivery_messages` ADD COLUMN `file_name` VARCHAR(255);

ALTER TABLE `delivery_reports` ADD COLUMN `file` VARCHAR(255);

ALTER TABLE `delivery_reports` ADD COLUMN `file_name` VARCHAR(255);

ALTER TABLE `driver_pharmacies` ADD CONSTRAINT `fk_driver_pharmacies_driver_id` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`);

ALTER TABLE `driver_pharmacies` ADD CONSTRAINT `fk_driver_pharmacies_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `delivery_offers` ADD CONSTRAINT `fk_delivery_offers_delivery_id` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`);

ALTER TABLE `delivery_offers` ADD CONSTRAINT `fk_delivery_offers_driver_id` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`id`);

CREATE INDEX `idx_driver_ph` ON `driver_pharmacies` (`pharmacy_id`);

CREATE INDEX `idx_offers_delivery` ON `delivery_offers` (`delivery_id`, `status`);
