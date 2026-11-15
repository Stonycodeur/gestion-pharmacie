-- Fonctions financières ouvertes : remboursement côté prestataire, abonnements, KYC, SMS, API externe + webhooks sortants, paramètres de plateforme.
ALTER TABLE payment_refunds ADD COLUMN gateway_status TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE payment_refunds ADD COLUMN gateway_ref TEXT;
ALTER TABLE payment_refunds ADD COLUMN gateway_error TEXT;
CREATE TABLE platform_settings (
  skey TEXT PRIMARY KEY,
  svalue TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  label TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'month',
  next_run TEXT NOT NULL,
  ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  method_code TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_subs_run ON subscriptions(status, next_run);
CREATE TABLE subscription_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  number TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  due_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'due',
  paid_at TEXT,
  method_code TEXT,
  reference TEXT,
  reminded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_subinv_cust ON subscription_invoices(customer_id);
CREATE TABLE kyc_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL UNIQUE REFERENCES pharmacies(id),
  holder_name TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  doc_number TEXT,
  doc_file TEXT NOT NULL,
  proof_file TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  submitted_by INTEGER REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER,
  user_id INTEGER,
  phone TEXT,
  body TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER REFERENCES pharmacies(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT 'payments:read',
  created_by INTEGER REFERENCES users(id),
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE webhook_endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER REFERENCES pharmacies(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT 'payment.paid,payment.refunded',
  active INTEGER NOT NULL DEFAULT 1,
  last_status TEXT,
  last_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
