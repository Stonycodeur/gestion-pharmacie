-- GÉNÉRÉ par tools/gen-mariadb.js
ALTER TABLE `deliveries` ADD COLUMN `relaunch_status` VARCHAR(255);

ALTER TABLE `deliveries` ADD COLUMN `relaunch_reason` VARCHAR(255);

ALTER TABLE `deliveries` ADD COLUMN `relaunch_requested_at` DATETIME NULL DEFAULT NULL;
