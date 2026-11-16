-- GÉNÉRÉ par tools/gen-mariadb.js
ALTER TABLE `drivers` ADD COLUMN `accepted_modes` VARCHAR(255) NOT NULL DEFAULT 'economy,standard,express,scheduled';
