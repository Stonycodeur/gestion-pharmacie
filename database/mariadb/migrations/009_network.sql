-- GÉNÉRÉ par tools/gen-mariadb.js
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
  `active` BIGINT NOT NULL DEFAULT 1
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
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `delivery_ratings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `delivery_id` BIGINT NOT NULL,
  `rater_user_id` BIGINT NOT NULL,
  `target` VARCHAR(255) NOT NULL CHECK (target IN ('driver','customer')),
  `stars` BIGINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  `comment` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (`delivery_id`, `target`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `delivery_reports` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `delivery_id` BIGINT NOT NULL,
  `reporter_user_id` BIGINT NOT NULL,
  `target` VARCHAR(255) NOT NULL CHECK (target IN ('driver','customer')),
  `reason` TEXT NOT NULL,
  `details` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `pharmacies` ADD COLUMN `country_id` BIGINT;

ALTER TABLE `pharmacies` ADD COLUMN `city` VARCHAR(255);

ALTER TABLE `pharmacies` ADD COLUMN `lat` DOUBLE;

ALTER TABLE `pharmacies` ADD COLUMN `lng` DOUBLE;

ALTER TABLE `pharmacies` ADD COLUMN `logo_path` VARCHAR(255);

ALTER TABLE `pharmacies` ADD COLUMN `manager_user_id` BIGINT;

ALTER TABLE `pharmacies` ADD COLUMN `appointments_enabled` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `pharmacies` ADD COLUMN `opening_hours` VARCHAR(255);

ALTER TABLE `pharmacies` ADD COLUMN `public_listed` BIGINT NOT NULL DEFAULT 1;

ALTER TABLE `users` ADD COLUMN `is_primary` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `users` ADD COLUMN `avatar_path` VARCHAR(255);

ALTER TABLE `users` ADD COLUMN `is_guest` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `users` ADD COLUMN `created_by` BIGINT;

ALTER TABLE `notifications` ADD COLUMN `link` VARCHAR(255);

ALTER TABLE `prescriptions` ADD COLUMN `subject` VARCHAR(255);

ALTER TABLE `drivers` ADD COLUMN `user_id` BIGINT;

ALTER TABLE `drivers` ADD COLUMN `availability` VARCHAR(255) NOT NULL DEFAULT 'offline';

ALTER TABLE `drivers` ADD COLUMN `vehicle_type` VARCHAR(255) NOT NULL DEFAULT 'moto';

ALTER TABLE `drivers` ADD COLUMN `plate` VARCHAR(255);

ALTER TABLE `drivers` ADD COLUMN `base_fee` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `drivers` ADD COLUMN `per_km` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `drivers` ADD COLUMN `speed_kmh` BIGINT NOT NULL DEFAULT 25;

ALTER TABLE `drivers` ADD COLUMN `wait_min` BIGINT NOT NULL DEFAULT 15;

ALTER TABLE `drivers` ADD COLUMN `lat` DOUBLE;

ALTER TABLE `drivers` ADD COLUMN `lng` DOUBLE;

ALTER TABLE `drivers` ADD COLUMN `loc_at` DATETIME NULL DEFAULT NULL;

ALTER TABLE `drivers` ADD COLUMN `rating_sum` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `drivers` ADD COLUMN `rating_count` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `deliveries` ADD COLUMN `dest_lat` DOUBLE;

ALTER TABLE `deliveries` ADD COLUMN `dest_lng` DOUBLE;

ALTER TABLE `deliveries` ADD COLUMN `distance_m` BIGINT;

ALTER TABLE `deliveries` ADD COLUMN `eta_min` BIGINT;

ALTER TABLE `deliveries` ADD COLUMN `eta_max` BIGINT;

ALTER TABLE `deliveries` ADD COLUMN `driver_response` VARCHAR(255) NOT NULL DEFAULT 'none';

ALTER TABLE `deliveries` ADD COLUMN `cancelled_by` VARCHAR(255);

ALTER TABLE `deliveries` ADD COLUMN `cancel_reason` VARCHAR(255);

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
