-- Colonnes créées trop courtes (VARCHAR(255)) dans les anciennes versions : élargies pour les secrets chiffrés et les URL de paiement.
ALTER TABLE `payment_methods` MODIFY `config` TEXT, MODIFY `instructions` TEXT;
ALTER TABLE `online_payments` MODIFY `detail` TEXT, MODIFY `checkout_url` TEXT;
