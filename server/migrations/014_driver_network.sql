-- Réseau de chauffeurs : multi-pharmacies avec point de départ, profil (photo, pièce d'identité), courses proposées à tous,
-- offres de prix, pièces jointes dans les messages et signalements.
ALTER TABLE drivers ADD COLUMN photo_file TEXT;
ALTER TABLE drivers ADD COLUMN id_doc_file TEXT;
ALTER TABLE drivers ADD COLUMN id_doc_type TEXT;
ALTER TABLE drivers ADD COLUMN id_doc_number TEXT;
ALTER TABLE drivers ADD COLUMN home_address TEXT;
ALTER TABLE deliveries ADD COLUMN offer_mode TEXT NOT NULL DEFAULT 'driver';
ALTER TABLE deliveries ADD COLUMN picked_up_at TEXT;
ALTER TABLE deliveries ADD COLUMN accepted_at TEXT;
ALTER TABLE deliveries ADD COLUMN standard_fee INTEGER;
ALTER TABLE delivery_messages ADD COLUMN file TEXT;
ALTER TABLE delivery_messages ADD COLUMN file_name TEXT;
ALTER TABLE delivery_reports ADD COLUMN file TEXT;
ALTER TABLE delivery_reports ADD COLUMN file_name TEXT;
CREATE TABLE driver_pharmacies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  depart_lat DOUBLE,
  depart_lng DOUBLE,
  depart_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (driver_id, pharmacy_id)
);
CREATE INDEX idx_driver_ph ON driver_pharmacies(pharmacy_id);
CREATE TABLE delivery_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard','counter')),
  price INTEGER NOT NULL CHECK (price >= 0),
  standard_price INTEGER NOT NULL,
  distance_m INTEGER,
  eta_min INTEGER,
  eta_max INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','chosen','rejected','withdrawn')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (delivery_id, driver_id)
);
CREATE INDEX idx_offers_delivery ON delivery_offers(delivery_id, status);
