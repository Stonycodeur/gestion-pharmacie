// Traduction SQLite → MariaDB : cas unitaires + balayage de TOUT le SQL réellement émis par la suite de tests (voir tools/check-dialect.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMariaDb, normalizeMariaError } from '../server/sql-dialect.js';

const cases = [
  ["UPDATE t SET updated_at = datetime('now') WHERE id=?", 'UPDATE t SET updated_at = UTC_TIMESTAMP() WHERE id=?'],
  ["SELECT * FROM batches b WHERE b.exp_date >= date('now')", 'SELECT * FROM batches b WHERE b.exp_date >= UTC_DATE()'],
  ["SELECT CAST(julianday(b.exp_date) - julianday(date('now')) AS INTEGER) days_left FROM b", 'SELECT DATEDIFF(b.exp_date, UTC_DATE()) days_left FROM b'],
  ["SELECT strftime('%Y-%m', s.created_at) period FROM s", "SELECT DATE_FORMAT(s.created_at, '%Y-%m') period FROM s"],
  ['INSERT OR IGNORE INTO permissions(code,label) VALUES (?,?)', 'INSERT IGNORE INTO permissions(code,label) VALUES (?,?)'],
  ['INSERT INTO stock_levels(pharmacy_id,batch_id) VALUES (?,?) ON CONFLICT(pharmacy_id,batch_id) DO NOTHING', 'INSERT IGNORE INTO stock_levels(pharmacy_id,batch_id) VALUES (?,?)'],
  ['INSERT INTO settings(pharmacy_id,skey,svalue) VALUES (?,?,?) ON CONFLICT(pharmacy_id,skey) DO UPDATE SET svalue=excluded.svalue', 'INSERT INTO settings(pharmacy_id,skey,svalue) VALUES (?,?,?) ON DUPLICATE KEY UPDATE svalue=VALUES(svalue)'],
  ['UPDATE l SET qty_delivered = MAX(0, qty_delivered - ?) WHERE id=?', 'UPDATE l SET qty_delivered = GREATEST(0, qty_delivered - ?) WHERE id=?'],
  ['SELECT (SELECT COUNT(*) FROM order_lines WHERE order_id=o.id) lines FROM customer_orders o', 'SELECT (SELECT COUNT(*) FROM order_lines WHERE order_id=o.id) `lines` FROM customer_orders o'],
  ['SELECT CAST(x AS INTEGER) FROM t', 'SELECT CAST(x AS SIGNED) FROM t'],
];
for (const [i, o] of cases) test('dialecte : ' + i.slice(0, 60), () => assert.equal(toMariaDb(i), o));
test('erreurs MariaDB normalisées', () => {
  assert.match(normalizeMariaError(Object.assign(new Error("Duplicate entry 'a@b' for key 'email'"), { errno: 1062 })).message, /UNIQUE constraint failed: email/);
  assert.match(normalizeMariaError(Object.assign(new Error('Cannot add or update a child row'), { errno: 1452 })).message, /FOREIGN KEY constraint failed/);
  assert.match(normalizeMariaError(Object.assign(new Error("CONSTRAINT `stock_levels.CONSTRAINT_1` failed for `x`.`stock_levels`"), { errno: 4025 })).message, /CHECK constraint failed: .*qty_available/);
});

test('datetime(now, ±N unité) → DATE_SUB/DATE_ADD', () => {
  assert.equal(toMariaDb("SELECT 1 WHERE a < datetime('now','-2 days')"), 'SELECT 1 WHERE a < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY)');
  assert.equal(toMariaDb("SELECT 1 WHERE a >= datetime('now', '+1 hour')"), 'SELECT 1 WHERE a >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR)');
});

test('SQL MariaDB généré : aucune construction SQLite ni clause orpheline', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const files = ['database/mariadb/Gestion_pharmacie.sql', ...readdirSync('database/mariadb/migrations').map((f) => 'database/mariadb/migrations/' + f)];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.ok(!/AUTOINCREMENT|datetime\('now'\)|INSERT OR|PRAGMA|\b(INTEGER|REAL)\b/.test(t), 'SQLite restant dans ' + f);
    assert.ok(!/^\s+`\w+` [A-Z]+(\(\d+\))?[^\n]* ON DELETE/m.test(t), 'ON DELETE dans une définition de colonne : ' + f);
    assert.ok(!/CREATE DATABASE|^USE /m.test(t), 'CREATE DATABASE/USE interdit (hébergement mutualisé) : ' + f);
  }
});
