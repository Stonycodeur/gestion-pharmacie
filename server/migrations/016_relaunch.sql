-- Relance d'une livraison annulée : demande du client (motif), validation par la pharmacie.
ALTER TABLE deliveries ADD COLUMN relaunch_status TEXT;
ALTER TABLE deliveries ADD COLUMN relaunch_reason TEXT;
ALTER TABLE deliveries ADD COLUMN relaunch_requested_at TEXT;
