-- Réseau d'établissements : pays/indicatifs/drapeaux, géolocalisation, catalogue par pharmacie, invités, corbeille, centre d'aide, fichiers,
-- chauffeurs suivis en direct (tarifs, notes, messages, signalements), rendez-vous médecin.
CREATE TABLE countries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iso2 TEXT NOT NULL UNIQUE,
  name_fr TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT,
  dial_code TEXT NOT NULL,
  flag_svg TEXT,
  phone_min INTEGER NOT NULL DEFAULT 6,
  phone_max INTEGER NOT NULL DEFAULT 12,
  active INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE pharmacies ADD COLUMN country_id INTEGER;
ALTER TABLE pharmacies ADD COLUMN city TEXT;
ALTER TABLE pharmacies ADD COLUMN lat DOUBLE;
ALTER TABLE pharmacies ADD COLUMN lng DOUBLE;
ALTER TABLE pharmacies ADD COLUMN logo_path TEXT;
ALTER TABLE pharmacies ADD COLUMN manager_user_id INTEGER;
ALTER TABLE pharmacies ADD COLUMN appointments_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pharmacies ADD COLUMN opening_hours TEXT;
ALTER TABLE pharmacies ADD COLUMN public_listed INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN avatar_path TEXT;
ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN created_by INTEGER;
ALTER TABLE notifications ADD COLUMN link TEXT;
ALTER TABLE prescriptions ADD COLUMN subject TEXT;
CREATE TABLE pharmacy_catalog (
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pharmacy_id, product_id)
);
CREATE INDEX idx_catalog_product ON pharmacy_catalog(product_id);
CREATE TABLE trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  data TEXT NOT NULL,
  deleted_by INTEGER,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
  purge_at TEXT NOT NULL
);
CREATE INDEX idx_trash_purge ON trash(purge_at);
CREATE TABLE help_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message','claim','interpharmacy')),
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  from_pharmacy_id INTEGER REFERENCES pharmacies(id),
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tickets_ph ON help_tickets(pharmacy_id, status);
CREATE INDEX idx_tickets_user ON help_tickets(from_user_id);
CREATE TABLE help_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES help_tickets(id),
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  from_staff INTEGER NOT NULL DEFAULT 0,
  reply_as TEXT NOT NULL DEFAULT 'user' CHECK (reply_as IN ('user','pharmacy')),
  signature TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_help_msgs ON help_messages(ticket_id);
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  recipient_user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','saved','rejected')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attach_owner ON attachments(owner_type, owner_id);
CREATE INDEX idx_attach_ph ON attachments(pharmacy_id, status);
ALTER TABLE drivers ADD COLUMN user_id INTEGER;
ALTER TABLE drivers ADD COLUMN availability TEXT NOT NULL DEFAULT 'offline';
ALTER TABLE drivers ADD COLUMN vehicle_type TEXT NOT NULL DEFAULT 'moto';
ALTER TABLE drivers ADD COLUMN plate TEXT;
ALTER TABLE drivers ADD COLUMN base_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN per_km INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN speed_kmh INTEGER NOT NULL DEFAULT 25;
ALTER TABLE drivers ADD COLUMN wait_min INTEGER NOT NULL DEFAULT 15;
ALTER TABLE drivers ADD COLUMN lat DOUBLE;
ALTER TABLE drivers ADD COLUMN lng DOUBLE;
ALTER TABLE drivers ADD COLUMN loc_at TEXT;
ALTER TABLE drivers ADD COLUMN rating_sum INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN dest_lat DOUBLE;
ALTER TABLE deliveries ADD COLUMN dest_lng DOUBLE;
ALTER TABLE deliveries ADD COLUMN distance_m INTEGER;
ALTER TABLE deliveries ADD COLUMN eta_min INTEGER;
ALTER TABLE deliveries ADD COLUMN eta_max INTEGER;
ALTER TABLE deliveries ADD COLUMN driver_response TEXT NOT NULL DEFAULT 'none';
ALTER TABLE deliveries ADD COLUMN cancelled_by TEXT;
ALTER TABLE deliveries ADD COLUMN cancel_reason TEXT;
CREATE TABLE driver_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  delivery_id INTEGER REFERENCES deliveries(id),
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_driver_loc ON driver_locations(delivery_id, id);
CREATE TABLE delivery_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  sender_user_id INTEGER NOT NULL REFERENCES users(id),
  sender_role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_dmsg ON delivery_messages(delivery_id);
CREATE TABLE delivery_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  rater_user_id INTEGER NOT NULL REFERENCES users(id),
  target TEXT NOT NULL CHECK (target IN ('driver','customer')),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (delivery_id, target)
);
CREATE TABLE delivery_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  reporter_user_id INTEGER NOT NULL REFERENCES users(id),
  target TEXT NOT NULL CHECK (target IN ('driver','customer')),
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE appointment_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  doctor_user_id INTEGER NOT NULL REFERENCES users(id),
  starts_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 20,
  online_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','cancelled'))
);
CREATE INDEX idx_slots ON appointment_slots(pharmacy_id, starts_at);
CREATE TABLE appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  slot_id INTEGER NOT NULL REFERENCES appointment_slots(id),
  customer_user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','refused','cancelled','done')),
  doctor_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_appt_user ON appointments(customer_user_id);
