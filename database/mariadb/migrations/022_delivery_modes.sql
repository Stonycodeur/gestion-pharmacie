-- GÉNÉRÉ par tools/gen-mariadb.js
ALTER TABLE `deliveries` ADD COLUMN `mode` VARCHAR(255) NOT NULL DEFAULT 'standard';

ALTER TABLE `deliveries` ADD COLUMN `scheduled_at` DATETIME NULL DEFAULT NULL;

ALTER TABLE `deliveries` ADD COLUMN `reminder_sent` BIGINT NOT NULL DEFAULT 0;
