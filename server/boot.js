// Initialisations idempotentes au démarrage : pays, catalogues par pharmacie, super-admin principal, corbeille.
import { get, all, run } from './db.js';
import { purgeExpired } from './routes/network.js';
import { seedCountries } from './phone.js';

export function purgeTrash() {
  purgeExpired();
  // sessions invité de plus de 2 jours : supprimées si elles n'ont laissé aucune commande
  for (const g of all("SELECT id FROM users WHERE is_guest=1 AND created_at < datetime('now','-2 days')")) {
    try {
      run('DELETE FROM refresh_tokens WHERE user_id=?', g.id);
      run('DELETE FROM customers WHERE user_id=? AND NOT EXISTS (SELECT 1 FROM customer_orders o WHERE o.customer_id=customers.id)', g.id);
      if (!get('SELECT 1 FROM customers WHERE user_id=?', g.id)) run('DELETE FROM users WHERE id=?', g.id);
    } catch { /* référencé : conservé */ }
  }
}
export function bootNetwork() {
  seedCountries();
  if (!get("SELECT 1 FROM settings WHERE pharmacy_id=0 AND skey='catalog_backfilled'") && get('SELECT 1 FROM pharmacies LIMIT 1') && get('SELECT 1 FROM products LIMIT 1')) {
    run('INSERT OR IGNORE INTO pharmacy_catalog(pharmacy_id,product_id) SELECT ph.id, p.id FROM pharmacies ph CROSS JOIN products p');
    run("INSERT INTO settings(pharmacy_id,skey,svalue) VALUES (0,'catalog_backfilled','1')");
  }
  run('UPDATE pharmacies SET country_id=(SELECT id FROM countries WHERE iso2=\'TN\') WHERE country_id IS NULL');
  if (!get("SELECT 1 FROM users WHERE is_primary=1 AND role_code='super_admin'")) {
    const first = get("SELECT id FROM users WHERE role_code='super_admin' ORDER BY id LIMIT 1");
    if (first) run('UPDATE users SET is_primary=1 WHERE id=?', first.id);
  }
  purgeTrash();
}
