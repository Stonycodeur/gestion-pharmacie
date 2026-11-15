-- GÉNÉRÉ par tools/gen-mariadb.js
ALTER TABLE `delivery_ratings` ADD COLUMN `status` VARCHAR(255) NOT NULL DEFAULT 'pending';

ALTER TABLE `delivery_ratings` ADD COLUMN `reviewed_by` BIGINT;

ALTER TABLE `delivery_ratings` ADD COLUMN `reviewed_at` DATETIME NULL DEFAULT NULL;

UPDATE delivery_ratings SET status='approved';
