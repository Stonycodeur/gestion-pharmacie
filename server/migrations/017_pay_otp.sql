-- Code de confirmation SMS (à usage unique, durée réglable) avant un paiement en ligne.
ALTER TABLE payment_methods ADD COLUMN otp_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_methods ADD COLUMN otp_ttl INTEGER NOT NULL DEFAULT 120;
CREATE TABLE payment_otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,
  method_code TEXT NOT NULL,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payment_otps_user ON payment_otps(user_id, order_id, method_code);
