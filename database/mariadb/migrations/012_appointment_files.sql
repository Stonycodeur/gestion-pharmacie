-- GÉNÉRÉ par tools/gen-mariadb.js
ALTER TABLE `appointments` ADD COLUMN `file_path` VARCHAR(255);

ALTER TABLE `appointments` ADD COLUMN `file_name` VARCHAR(255);

ALTER TABLE `appointments` ADD COLUMN `file_mime` VARCHAR(255);
