-- Modes de paiement paramétrables (super-administrateur) et paiements en ligne.
-- `kind` = famille comptable (cash|card|mobile|transfer|wallet) ; `code` = mode configuré, conservé sur chaque paiement.
CREATE TABLE payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cash','card','mobile','transfer','wallet')),
  provider TEXT NOT NULL DEFAULT 'manual',
  enabled INTEGER NOT NULL DEFAULT 1,
  channel_pos INTEGER NOT NULL DEFAULT 1,
  channel_online INTEGER NOT NULL DEFAULT 0,
  instructions TEXT,
  config TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO payment_methods(code,label,kind,provider,channel_pos,channel_online,sort_order,instructions) VALUES
 ('cash','Espèces','cash','manual',1,0,10,NULL),
 ('card','Carte bancaire (TPE)','card','manual',1,0,20,NULL),
 ('mobile','Paiement mobile','mobile','manual',1,0,30,NULL),
 ('transfer','Virement','transfer','manual',1,1,40,'Effectuez le virement puis la pharmacie confirmera sa réception.'),
 ('cheque','Chèque','transfer','manual',1,0,50,NULL),
 ('cod','Paiement à la livraison','cash','manual',0,1,60,'Vous réglez en espèces au livreur ou au retrait.');
ALTER TABLE payments ADD COLUMN method_code TEXT;
ALTER TABLE order_deposits ADD COLUMN method_code TEXT;
CREATE TABLE online_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  order_id INTEGER NOT NULL REFERENCES customer_orders(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  user_id INTEGER REFERENCES users(id),
  method_code TEXT NOT NULL,
  provider TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending',
  provider_ref TEXT,
  checkout_url TEXT,
  deposit_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE INDEX idx_onlinepay_order ON online_payments(order_id);
CREATE INDEX idx_onlinepay_ref ON online_payments(provider_ref);
