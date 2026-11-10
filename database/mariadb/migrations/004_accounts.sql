-- GÉNÉRÉ par tools/gen-mariadb.js
ALTER TABLE `users` ADD COLUMN `status_reason` TEXT;

ALTER TABLE `users` ADD COLUMN `suspended_until` DATETIME NULL DEFAULT NULL;

ALTER TABLE `users` ADD COLUMN `deleted_at` DATETIME NULL DEFAULT NULL;
