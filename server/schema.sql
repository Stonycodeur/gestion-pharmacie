-- Gestion_pharmacie : schéma source (SQLite en dev). Le schéma MariaDB est généré par tools/gen-mariadb.js
-- Montants : entiers en plus petite unité monétaire (ex. millimes pour TND). Dates : 'YYYY-MM-DD HH:MM:SS' (UTC).
-- Convention : une colonne par ligne, pas de commentaire dans les CREATE TABLE (parsé par le générateur).

CREATE TABLE pharmacies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  currency TEXT NOT NULL DEFAULT 'TND',
  currency_decimals INTEGER NOT NULL DEFAULT 3,
  timezone TEXT NOT NULL DEFAULT 'Africa/Tunis',
  invoice_prefix TEXT NOT NULL DEFAULT 'F',
  legal_notice TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  pharmacy_id INTEGER NOT NULL,
  skey TEXT NOT NULL,
  svalue TEXT NOT NULL,
  PRIMARY KEY (pharmacy_id, skey)
);

CREATE TABLE roles (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  privileged INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE permissions (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_code TEXT NOT NULL REFERENCES roles(code),
  permission_code TEXT NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role_code TEXT NOT NULL REFERENCES roles(code),
  pharmacy_id INTEGER REFERENCES pharmacies(id),
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  mfa_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  lang TEXT NOT NULL DEFAULT 'fr',
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  device TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  ip TEXT,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER,
  user_id INTEGER,
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  old_json TEXT,
  new_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'medicament'
);

CREATE TABLE manufacturers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  dci TEXT,
  dosage TEXT,
  form TEXT,
  route TEXT,
  packaging TEXT,
  manufacturer_id INTEGER REFERENCES manufacturers(id),
  category_id INTEGER REFERENCES categories(id),
  barcode TEXT UNIQUE,
  rx_status TEXT NOT NULL DEFAULT 'free' CHECK (rx_status IN ('free','prescription','controlled')),
  storage_conditions TEXT,
  cold_chain INTEGER NOT NULL DEFAULT 0,
  generic_group TEXT,
  min_stock INTEGER NOT NULL DEFAULT 0,
  critical_stock INTEGER NOT NULL DEFAULT 0,
  max_stock INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  purchase_price INTEGER NOT NULL DEFAULT 0,
  sale_price INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  purchase_price INTEGER NOT NULL,
  sale_price INTEGER NOT NULL,
  changed_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  legal_id TEXT,
  payment_terms TEXT,
  lead_days INTEGER NOT NULL DEFAULT 2,
  rating INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_no TEXT NOT NULL,
  mfg_date TEXT,
  exp_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','quarantine','recalled','blocked')),
  status_reason TEXT,
  supplier_id INTEGER REFERENCES suppliers(id),
  unit_cost INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, batch_no)
);

CREATE TABLE stock_levels (
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  location TEXT,
  qty_available INTEGER NOT NULL DEFAULT 0 CHECK (qty_available >= 0),
  qty_reserved INTEGER NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  qty_quarantine INTEGER NOT NULL DEFAULT 0 CHECK (qty_quarantine >= 0),
  qty_damaged INTEGER NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pharmacy_id, batch_id),
  CHECK (qty_reserved <= qty_available)
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  movement_type TEXT NOT NULL,
  qty INTEGER NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'available',
  reason TEXT,
  ref_type TEXT,
  ref_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partial','received','cancelled')),
  expected_date TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchase_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_ordered INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received INTEGER NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE goods_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  po_id INTEGER REFERENCES purchase_orders(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  number TEXT NOT NULL UNIQUE,
  supplier_invoice_ref TEXT,
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE goods_receipt_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id),
  po_line_id INTEGER REFERENCES purchase_order_lines(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE inventory_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','validated','cancelled')),
  created_by INTEGER REFERENCES users(id),
  validated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE inventory_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES inventory_sessions(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  expected_qty INTEGER NOT NULL,
  counted_qty INTEGER,
  reason TEXT,
  UNIQUE (session_id, batch_id)
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  birth_date TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE loyalty_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  sale_id INTEGER,
  points INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cash_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE cash_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  register_id INTEGER NOT NULL REFERENCES cash_registers(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  opening_float INTEGER NOT NULL DEFAULT 0,
  expected_cash INTEGER,
  counted_cash INTEGER,
  difference INTEGER,
  difference_reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  kind TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  amount INTEGER NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  patient_name TEXT NOT NULL,
  prescriber_name TEXT,
  prescription_date TEXT,
  valid_until TEXT,
  renewals_allowed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','to_verify','complement_requested','validated','partially_delivered','delivered','rejected')),
  file_name TEXT,
  file_path TEXT,
  file_mime TEXT,
  notes TEXT,
  status_reason TEXT,
  validated_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE prescription_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_prescribed INTEGER NOT NULL CHECK (qty_prescribed > 0),
  qty_delivered INTEGER NOT NULL DEFAULT 0,
  posology TEXT
);

CREATE TABLE prescription_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  prescription_id INTEGER REFERENCES prescriptions(id),
  order_id INTEGER,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  tax_total INTEGER NOT NULL,
  total INTEGER NOT NULL,
  paid INTEGER NOT NULL,
  change_given INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','partially_refunded','refunded')),
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sale_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  qty_refunded INTEGER NOT NULL DEFAULT 0,
  unit_price INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK (method IN ('cash','card','mobile','transfer','wallet')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  number TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  reason TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE refund_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id INTEGER NOT NULL REFERENCES refunds(id),
  sale_line_id INTEGER NOT NULL REFERENCES sale_lines(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  amount INTEGER NOT NULL
);

CREATE TABLE dispensing_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id),
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  qty INTEGER NOT NULL,
  pharmacist_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE customer_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  kind TEXT NOT NULL DEFAULT 'reservation' CHECK (kind IN ('reservation','order')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','preparing','ready','picked_up','cancelled','expired')),
  expires_at TEXT,
  delivery_address TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES customer_orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0)
);

CREATE TABLE stock_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_line_id INTEGER NOT NULL REFERENCES order_lines(id),
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  released INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES customer_orders(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER,
  user_id INTEGER,
  audience TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  dedupe_key TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE temperature_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
  location TEXT NOT NULL,
  celsius REAL NOT NULL,
  in_range INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE doc_counters (
  pharmacy_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_no INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pharmacy_id, doc_type, year)
);

CREATE INDEX idx_batches_product ON batches(product_id);
CREATE INDEX idx_batches_exp ON batches(exp_date);
CREATE INDEX idx_movements_ph ON stock_movements(pharmacy_id, created_at);
CREATE INDEX idx_movements_batch ON stock_movements(batch_id);
CREATE INDEX idx_sales_ph_date ON sales(pharmacy_id, created_at);
CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX idx_audit_ph_date ON audit_logs(pharmacy_id, created_at);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_dci ON products(dci);
CREATE INDEX idx_notif_user ON notifications(user_id, is_read);
CREATE INDEX idx_presc_ph ON prescriptions(pharmacy_id, status);
CREATE INDEX idx_orders_ph ON customer_orders(pharmacy_id, status);
CREATE INDEX idx_customers_ph ON customers(pharmacy_id, name);
