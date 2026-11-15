-- Livraison : 4 modes (économique, standard, express, programmée) + date programmée et rappel.
ALTER TABLE deliveries ADD COLUMN mode TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE deliveries ADD COLUMN scheduled_at TEXT;
ALTER TABLE deliveries ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0;
