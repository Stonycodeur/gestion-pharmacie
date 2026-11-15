import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test("MariaDB : connexion fermée par l'hébergeur → reconnexion transparente, y compris au début d'une transaction", () => {
  const env = { ...process.env, MARIADB_HOST: 'x', MARIADB_USER: 'u', MARIADB_DATABASE: 'db', MARIADB_ADAPTER: new URL('./fixtures/flaky-mariadb-adapter.js', import.meta.url).href, MARIADB_TIMEOUT_MS: '5000' };
  delete env.NODE_TEST_CONTEXT;
  const r = execFileSync(process.execPath, [new URL('./fixtures/reconnect-child.mjs', import.meta.url).pathname], { env, encoding: 'utf8', timeout: 20000 });
  assert.deepEqual(JSON.parse(r.trim().split('\n').pop()), [1, 1, 7, 2]);
});
