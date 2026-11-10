// Passerelle synchrone MariaDB : requêtes, transactions, erreurs et délais, vérifiés avec un faux serveur (SQLite en mémoire derrière l'interface mysql2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

process.env.MARIADB_ADAPTER = pathToFileURL(resolve('tests/fixtures/fake-mariadb-adapter.js')).href;
process.env.MARIADB_DATABASE = 'bridge_test';
const d = await import('../server/driver-mariadb.js');

test('requêtes synchrones : DDL, insertion, lecture, mise à jour', () => {
  d.script('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v INTEGER NOT NULL CHECK (v >= 0), s TEXT UNIQUE)');
  const a = d.exec('INSERT INTO t(v,s) VALUES (?,?)', [5, 'a']); assert.equal(a.lastId, 1);
  assert.equal(d.exec('INSERT INTO t(v,s) VALUES (?,?)', [7, undefined]).lastId, 2, 'undefined → NULL');
  assert.deepEqual(d.query('SELECT id, v FROM t ORDER BY id', []), [{ id: 1, v: 5 }, { id: 2, v: 7 }]);
  assert.equal(d.exec('UPDATE t SET v = v + 1 WHERE v > ?', [0]).changes, 2);
});
test('transaction : rollback complet, savepoints imbriqués', () => {
  d.begin(); d.exec('INSERT INTO t(v,s) VALUES (?,?)', [1, 'x']); d.savepoint('sp1'); d.exec('INSERT INTO t(v,s) VALUES (?,?)', [2, 'y']); d.rollbackTo('sp1'); d.release('sp1'); d.commit();
  assert.deepEqual(d.query('SELECT s FROM t WHERE s IN (?,?) ORDER BY s', ['x', 'y']).map((r) => r.s), ['x']);
  d.begin(); d.exec('INSERT INTO t(v,s) VALUES (?,?)', [9, 'z']); d.rollback();
  assert.equal(d.query('SELECT 1 FROM t WHERE s=?', ['z']).length, 0);
});
test('erreurs : propagées et réutilisables ensuite', () => {
  assert.throws(() => d.exec('INSERT INTO t(v,s) VALUES (?,?)', [-1, 'neg']), /CHECK|constraint/i);
  assert.throws(() => d.exec('INSERT INTO t(v,s) VALUES (?,?)', [1, 'a']), /UNIQUE|constraint/i);
  assert.equal(d.query('SELECT COUNT(*) n FROM t', [])[0].n >= 3, true, 'la connexion reste utilisable');
});
test('débit : 2000 requêtes séquentielles', () => {
  const t0 = Date.now(); for (let i = 0; i < 2000; i++) d.query('SELECT 1 x', []); assert.equal(Date.now() - t0 < 5000, true, `trop lent : ${Date.now() - t0} ms`);
});
