-- Pays : devises du pays, pays du client, autorisation « voir toutes les pharmacies » ; modes de paiement propres à chaque pharmacie ; mode de règlement choisi.
ALTER TABLE countries ADD COLUMN currencies TEXT;
ALTER TABLE pharmacies ADD COLUMN currencies TEXT;
ALTER TABLE users ADD COLUMN country_id INTEGER;
ALTER TABLE users ADD COLUMN see_all_countries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_orders ADD COLUMN wants_delivery INTEGER;
ALTER TABLE customer_orders ADD COLUMN pay_mode TEXT;
ALTER TABLE customer_orders ADD COLUMN pay_method_code TEXT;
CREATE TABLE pharmacy_payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  method_code TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  at_counter INTEGER NOT NULL DEFAULT 0,
  on_delivery INTEGER NOT NULL DEFAULT 0,
  online INTEGER NOT NULL DEFAULT 0,
  UNIQUE (pharmacy_id, method_code)
);
