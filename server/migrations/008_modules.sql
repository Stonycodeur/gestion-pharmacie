-- Livraison à domicile (chauffeurs, suivi), demandes de prix fournisseurs, comptabilité (plan comptable, écritures manuelles).
CREATE TABLE drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  name TEXT NOT NULL,
  matricule TEXT NOT NULL,
  phone TEXT,
  vehicle TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pharmacy_id, matricule)
);
CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  order_id INTEGER NOT NULL UNIQUE REFERENCES customer_orders(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  number TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  fee INTEGER NOT NULL DEFAULT 0,
  driver_id INTEGER REFERENCES drivers(id),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','received','in_progress','delivered','failed','cancelled')),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);
CREATE INDEX idx_deliveries_ph ON deliveries(pharmacy_id, status);
CREATE INDEX idx_deliveries_customer ON deliveries(customer_id);
CREATE TABLE delivery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  status TEXT NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  driver_name TEXT,
  driver_matricule TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_delivery_events ON delivery_events(delivery_id);
CREATE TABLE rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','closed','cancelled')),
  deadline TEXT,
  notes TEXT,
  po_id INTEGER REFERENCES purchase_orders(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE rfq_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0)
);
CREATE TABLE rfq_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','quoted','declined')),
  lead_days INTEGER,
  notes TEXT,
  sent_at TEXT,
  quoted_at TEXT,
  UNIQUE (rfq_id, supplier_id)
);
CREATE TABLE rfq_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_supplier_id INTEGER NOT NULL REFERENCES rfq_suppliers(id),
  rfq_line_id INTEGER NOT NULL REFERENCES rfq_lines(id),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  UNIQUE (rfq_supplier_id, rfq_line_id)
);
CREATE TABLE acc_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','expense','income')),
  is_system INTEGER NOT NULL DEFAULT 0,
  UNIQUE (pharmacy_id, code)
);
CREATE TABLE acc_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  number TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  label TEXT NOT NULL,
  reference TEXT,
  reversed_of INTEGER REFERENCES acc_entries(id),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_acc_entries ON acc_entries(pharmacy_id, entry_date);
CREATE TABLE acc_entry_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES acc_entries(id),
  account_code TEXT NOT NULL,
  debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo TEXT
);
CREATE INDEX idx_acc_lines ON acc_entry_lines(entry_id);
