-- Ventes encaissées hors connexion : heure d'origine conservée (la vente est comptabilisée à la synchronisation).
ALTER TABLE sales ADD COLUMN offline_at TEXT;
