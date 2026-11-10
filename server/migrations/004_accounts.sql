-- Gestion complète des comptes : motif d'un changement de statut, suspension temporaire, date de suppression logique.
ALTER TABLE users ADD COLUMN status_reason TEXT;
ALTER TABLE users ADD COLUMN suspended_until TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
