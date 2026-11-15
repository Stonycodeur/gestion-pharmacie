// Accès base de données (SQLite en dev, MariaDB en production). Toutes les opérations métier critiques passent par tx().
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './util.js';

const here = dirname(fileURLToPath(import.meta.url));
// DB_DRIVER=sqlite (défaut : développement / tests) | mariadb (production). Le code métier est identique : seule cette couche change.
const driver = process.env.DB_DRIVER === 'mariadb' ? await import('./driver-mariadb.js') : await import('./driver-sqlite.js');
export const DRIVER = driver.kind;
export const db = driver.raw; // SQLite uniquement (tests / outils)
export const rawExec = (sql) => driver.script(sql); // exécution brute (tests, outils)
export const dropDatabase = () => driver.dropDatabase?.();

const AUDIT_TRIGGERS = `
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs est en ajout seul'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs est en ajout seul'); END;
CREATE TRIGGER movements_no_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT, 'stock_movements est en ajout seul'); END;
CREATE TRIGGER movements_no_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT, 'stock_movements est en ajout seul'); END;
CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT, 'une vente validée ne peut pas être supprimée (utiliser un remboursement)'); END;
CREATE TRIGGER sale_lines_no_delete BEFORE DELETE ON sale_lines BEGIN SELECT RAISE(ABORT, 'ligne de vente non supprimable'); END;
`;
export const AUDIT_TRIGGERS_SQL = AUDIT_TRIGGERS;

// Migrations versionnées : ajouter un fichier SQL/une entrée ici pour toute évolution de schéma.
const MIGRATIONS = [
  { name: '001_init', inBaseline: true, sql: () => readFileSync(resolve(here, 'schema.sql'), 'utf8') + AUDIT_TRIGGERS },
  { name: '002_features', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/002_features.sql'), 'utf8') },
  { name: '003_offline', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/003_offline.sql'), 'utf8') },
  { name: '004_accounts', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/004_accounts.sql'), 'utf8') },
  { name: '005_password_reset', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/005_password_reset.sql'), 'utf8') },
  { name: '006_permissions_prefs', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/006_permissions_prefs.sql'), 'utf8') },
  { name: '007_payments', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/007_payments.sql'), 'utf8') },
  { name: '008_modules', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/008_modules.sql'), 'utf8') },
  { name: '009_network', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/009_network.sql'), 'utf8') },
  { name: '010_stored_files', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/010_stored_files.sql'), 'utf8') },
  { name: '011_cities', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/011_cities.sql'), 'utf8') },
  { name: '012_appointment_files', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/012_appointment_files.sql'), 'utf8') },
  { name: '013_payments_v2', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/013_payments_v2.sql'), 'utf8') },
  { name: '014_driver_network', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/014_driver_network.sql'), 'utf8') },
  { name: '015_finance_open', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/015_finance_open.sql'), 'utf8') },
  { name: '016_relaunch', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/016_relaunch.sql'), 'utf8') },
  { name: '017_pay_otp', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/017_pay_otp.sql'), 'utf8') },
  { name: '018_rating_moderation', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/018_rating_moderation.sql'), 'utf8') },
  { name: '019_audit_origin', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/019_audit_origin.sql'), 'utf8') },
  { name: '020_file_manager', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/020_file_manager.sql'), 'utf8') },
  { name: '021_country_methods', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/021_country_methods.sql'), 'utf8') },
  { name: '022_delivery_modes', inBaseline: true, sql: () => readFileSync(resolve(here, 'migrations/022_delivery_modes.sql'), 'utf8') },
];
// Scripts MariaDB d'évolution (générés par tools/gen-mariadb.js) pour une base déjà installée avec une version plus ancienne
for (const m of MIGRATIONS) { const f = resolve(here, '../database/mariadb/migrations', m.name + '.sql'); if (existsSync(f)) m.mariadb = () => readFileSync(f, 'utf8'); }
export function migrate() {
  if (driver.kind === 'mariadb') {
    // Base neuve : le fichier généré contient l'état final de toutes les migrations. Ensuite, chaque nouvelle migration doit fournir son SQL MariaDB (champ `mariadb`).
    const fresh = !driver.hasTable('schema_migrations');
    if (fresh) {
      // Les triggers (journal et mouvements en ajout seul) sont créés à part : certains hébergeurs mutualisés refusent CREATE TRIGGER (droit TRIGGER / SUPER).
      const lines = driver.baselineSql().split('\n'), isTrig = (l) => /^CREATE TRIGGER /.test(l);
      driver.script(lines.filter((l) => !isTrig(l)).join('\n'));
      for (const l of lines.filter(isTrig)) {
        try { driver.script(l); }
        catch (e) {
          if (process.env.MARIADB_REQUIRE_TRIGGERS === 'true') throw new Error(`Création des triggers refusée par MariaDB (${e.message}). Demandez le droit TRIGGER à l'hébergeur ou retirez MARIADB_REQUIRE_TRIGGERS.`);
          console.warn(`[ATTENTION] Trigger non créé : ${e.message}. Le journal d'audit et les mouvements de stock ne sont plus protégés contre la modification directe en base.`);
        }
      }
      driver.script('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
      for (const m of MIGRATIONS.filter((x) => x.inBaseline)) driver.exec('INSERT INTO schema_migrations(name) VALUES (?)', [m.name]);
    }
    try { const n = Number(driver.query('SELECT COUNT(*) c FROM information_schema.triggers WHERE trigger_schema=DATABASE()', [])[0]?.c || 0); if (n < 6) console.warn(`[ATTENTION] ${n}/6 triggers de protection présents : journal d'audit et mouvements de stock modifiables directement en base.`); } catch { /* information_schema inaccessible */ }
    for (const m of MIGRATIONS) {
      if (driver.query('SELECT 1 x FROM schema_migrations WHERE name=?', [m.name]).length) continue;
      if (!m.mariadb) throw new Error(`Migration ${m.name} : script MariaDB manquant (voir docs/MARIADB.md)`);
      driver.script(m.mariadb()); driver.exec('INSERT INTO schema_migrations(name) VALUES (?)', [m.name]);
    }
    return;
  }
  driver.script("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  for (const m of MIGRATIONS) {
    if (driver.query('SELECT 1 FROM schema_migrations WHERE name=?', [m.name]).length) continue;
    driver.begin();
    try { driver.script(m.sql()); driver.exec('INSERT INTO schema_migrations(name) VALUES (?)', [m.name]); driver.commit(); }
    catch (e) { driver.rollback(); throw e; }
  }
}
migrate();

export const get = (sql, ...p) => driver.query(sql, p)[0] ?? null;
export const all = (sql, ...p) => driver.query(sql, p);
export const run = (sql, ...p) => driver.exec(sql, p);
export const insert = (sql, ...p) => driver.exec(sql, p).lastId;

let depth = 0;
// Transaction atomique (savepoints si imbriquée). Le code est synchrone : pas d'entrelacement entre requêtes.
export function tx(fn) {
  const name = `sp${depth}`;
  if (depth === 0) driver.begin(); else driver.savepoint(name);
  depth++;
  try {
    const r = fn();
    depth--;
    if (depth === 0) driver.commit(); else driver.release(name);
    return r;
  } catch (e) {
    depth--;
    if (depth === 0) driver.rollback(); else { driver.rollbackTo(name); driver.release(name); }
    if (e && /CHECK constraint failed: .*qty_(available|reserved|quarantine|damaged)/.test(e.message)) throw new HttpError(409, 'INSUFFICIENT_STOCK', 'Stock insuffisant');
    throw e;
  }
}

// Numérotation séquentielle par établissement / type / année (sans trou dans une transaction réussie).
export function nextNumber(pharmacyId, type, prefix) {
  const year = new Date().getUTCFullYear();
  run('INSERT INTO doc_counters(pharmacy_id,doc_type,year,last_no) VALUES (?,?,?,0) ON CONFLICT(pharmacy_id,doc_type,year) DO NOTHING', pharmacyId, type, year);
  run('UPDATE doc_counters SET last_no = last_no + 1 WHERE pharmacy_id=? AND doc_type=? AND year=?', pharmacyId, type, year);
  const n = get('SELECT last_no FROM doc_counters WHERE pharmacy_id=? AND doc_type=? AND year=?', pharmacyId, type, year).last_no;
  return `${prefix}${pharmacyId > 1 ? 'P' + pharmacyId + '-' : '-'}${year}-${String(n).padStart(6, '0')}`;
}

export function getSetting(pharmacyId, key, def) {
  const r = get('SELECT svalue FROM settings WHERE pharmacy_id=? AND skey=?', pharmacyId, key)
    ?? get('SELECT svalue FROM settings WHERE pharmacy_id=0 AND skey=?', key);
  if (!r) return def;
  const v = r.svalue;
  return typeof def === 'number' ? Number(v) : typeof def === 'boolean' ? v === 'true' : v;
}
