-- Paiements v2 : catalogue de moyens mondial, devises, commissions, reçus signés (QR), remboursements, analyses antivirus.
ALTER TABLE payment_methods ADD COLUMN countries TEXT;
ALTER TABLE payment_methods ADD COLUMN currencies TEXT;
ALTER TABLE payment_methods ADD COLUMN commission_bp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_methods ADD COLUMN commission_fixed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_methods ADD COLUMN family TEXT;
ALTER TABLE payment_methods ADD COLUMN fields TEXT;
ALTER TABLE payment_methods ADD COLUMN merchant_account TEXT;
ALTER TABLE payment_methods ADD COLUMN payout TEXT NOT NULL DEFAULT 'deferred';
ALTER TABLE online_payments ADD COLUMN currency TEXT;
ALTER TABLE online_payments ADD COLUMN commission INTEGER NOT NULL DEFAULT 0;
ALTER TABLE online_payments ADD COLUMN ip TEXT;
ALTER TABLE online_payments ADD COLUMN payer_ref TEXT;
ALTER TABLE online_payments ADD COLUMN refunded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE online_payments ADD COLUMN risk_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE online_payments ADD COLUMN risk_flags TEXT;
CREATE TABLE receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  number TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  online_payment_id INTEGER NOT NULL REFERENCES online_payments(id),
  order_id INTEGER REFERENCES customer_orders(id),
  customer_id INTEGER REFERENCES customers(id),
  payer_name TEXT,
  service TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  decimals INTEGER NOT NULL DEFAULT 2,
  method_label TEXT,
  reference TEXT,
  signature TEXT NOT NULL,
  emailed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_receipts_ph ON receipts(pharmacy_id);
CREATE INDEX idx_receipts_cust ON receipts(customer_id);
CREATE TABLE payment_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  online_payment_id INTEGER NOT NULL REFERENCES online_payments(id),
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE currency_rates (
  code TEXT PRIMARY KEY,
  per_eur REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO currency_rates(code,per_eur) VALUES ('EUR',1),('USD',1.08),('GBP',0.85),('CAD',1.47),('TND',3.35),('XOF',655.957),('XAF',655.957),('MAD',10.8),('DZD',146),('NGN',1650),('GHS',16),('KES',140),('EGP',52),('CHF',0.96);
CREATE TABLE file_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  mime TEXT,
  size INTEGER,
  sha256 TEXT,
  verdict TEXT NOT NULL,
  reason TEXT,
  engine TEXT,
  user_id INTEGER,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_filescans_v ON file_scans(verdict);
CREATE TABLE payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  reference TEXT,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payouts_ph ON payouts(pharmacy_id);
