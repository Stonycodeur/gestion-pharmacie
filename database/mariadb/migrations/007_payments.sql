-- GÉNÉRÉ par tools/gen-mariadb.js
CREATE TABLE `payment_methods` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(255) NOT NULL UNIQUE,
  `label` VARCHAR(255) NOT NULL,
  `kind` VARCHAR(255) NOT NULL CHECK (kind IN ('cash','card','mobile','transfer','wallet')),
  `provider` VARCHAR(255) NOT NULL DEFAULT 'manual',
  `enabled` BIGINT NOT NULL DEFAULT 1,
  `channel_pos` BIGINT NOT NULL DEFAULT 1,
  `channel_online` BIGINT NOT NULL DEFAULT 0,
  `instructions` VARCHAR(255),
  `config` VARCHAR(255),
  `sort_order` BIGINT NOT NULL DEFAULT 100,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  `checkout_url` VARCHAR(255),
  `deposit_id` BIGINT,
  `detail` VARCHAR(255),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` DATETIME NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `payments` ADD COLUMN `method_code` VARCHAR(255);

ALTER TABLE `order_deposits` ADD COLUMN `method_code` VARCHAR(255);

ALTER TABLE `online_payments` ADD CONSTRAINT `fk_online_payments_pharmacy_id` FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacies` (`id`);

ALTER TABLE `online_payments` ADD CONSTRAINT `fk_online_payments_order_id` FOREIGN KEY (`order_id`) REFERENCES `customer_orders` (`id`);

ALTER TABLE `online_payments` ADD CONSTRAINT `fk_online_payments_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`);

ALTER TABLE `online_payments` ADD CONSTRAINT `fk_online_payments_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

CREATE INDEX `idx_onlinepay_order` ON `online_payments` (`order_id`);

CREATE INDEX `idx_onlinepay_ref` ON `online_payments` (`provider_ref`);

INSERT INTO payment_methods(code,label,kind,provider,channel_pos,channel_online,sort_order,instructions) VALUES
 ('cash','Espèces','cash','manual',1,0,10,NULL),
 ('card','Carte bancaire (TPE)','card','manual',1,0,20,NULL),
 ('mobile','Paiement mobile','mobile','manual',1,0,30,NULL),
 ('transfer','Virement','transfer','manual',1,1,40,'Effectuez le virement puis la pharmacie confirmera sa réception.'),
 ('cheque','Chèque','transfer','manual',1,0,50,NULL),
 ('cod','Paiement à la livraison','cash','manual',0,1,60,'Vous réglez en espèces au livreur ou au retrait.');
