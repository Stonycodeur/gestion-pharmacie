-- Chauffeur : modes de livraison acceptés (économique, standard, express, programmée). Par défaut : tous (comportement inchangé).
ALTER TABLE drivers ADD COLUMN accepted_modes TEXT NOT NULL DEFAULT 'economy,standard,express,scheduled';
