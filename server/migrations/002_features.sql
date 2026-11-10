-- 002 : transferts inter-établissements, retours/avoirs/paiements fournisseurs, ventes à crédit & acomptes, verrouillage de période.
-- Même convention que schema.sql (une colonne par ligne) : lu aussi par tools/gen-mariadb.js.

CREATE TABLE transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  from_pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  to_pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','shipped','received','cancelled','rejected')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  shipped_by INTEGER REFERENCES users(id),
  received_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  shipped_at TEXT,
  received_at TEXT
);

CREATE TABLE transfer_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES transfers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  qty_received INTEGER
);

CREATE TABLE supplier_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  number TEXT NOT NULL UNIQUE,
  receipt_id INTEGER REFERENCES goods_receipts(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','credited','cancelled')),
  credit_amount INTEGER,
  credit_note_ref TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  credited_at TEXT
);

CREATE TABLE supplier_return_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES supplier_returns(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  bucket TEXT NOT NULL DEFAULT 'available',
  unit_cost INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'transfer',
  reference TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES customer_orders(id),
  method TEXT NOT NULL CHECK (method IN ('cash','card','mobile','transfer','wallet')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  session_id INTEGER REFERENCES cash_sessions(id),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','applied','refunded')),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE period_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  locked_until TEXT NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE refunds ADD COLUMN cash_amount INTEGER NOT NULL DEFAULT 0;
UPDATE refunds SET cash_amount = amount;

CREATE INDEX idx_transfers_from ON transfers(from_pharmacy_id, status);
CREATE INDEX idx_transfers_to ON transfers(to_pharmacy_id, status);
CREATE INDEX idx_supplier_payments ON supplier_payments(supplier_id);
CREATE INDEX idx_locks_ph ON period_locks(pharmacy_id, locked_until);
