// Pilote MariaDB 10.6+ (production). Passerelle SYNCHRONE : un thread dédié détient la connexion mysql2, le thread principal attend la réponse.
// Conséquence assumée : les requêtes SQL de l'application sont sérialisées dans un processus (comme avec SQLite) ; la base elle-même peut être sur un autre serveur,
// répliquée, sauvegardée à chaud. Voir docs/MARIADB.md.
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMariaDb, normalizeMariaError } from './sql-dialect.js';

export const kind = 'mariadb';
const here = dirname(fileURLToPath(import.meta.url));
export const databaseName = process.env.MARIADB_DATABASE || 'Gestion_pharmacie';
if (!/^[A-Za-z0-9_]{1,64}$/.test(databaseName)) throw new Error('MARIADB_DATABASE invalide');
const cfg = { host: process.env.MARIADB_HOST || '127.0.0.1', port: parseInt(process.env.MARIADB_PORT) || 3306, user: process.env.MARIADB_USER || 'root', password: process.env.MARIADB_PASSWORD || '', database: databaseName, ssl: process.env.MARIADB_SSL === 'true', sslRejectUnauthorized: process.env.MARIADB_SSL_INSECURE !== 'true' };
const TIMEOUT = parseInt(process.env.MARIADB_TIMEOUT_MS) || 30000;

const sab = new SharedArrayBuffer(4), flag = new Int32Array(sab);
const { port1, port2 } = new MessageChannel();
const adapter = new URL(process.env.MARIADB_ADAPTER || './mariadb-adapter.js', import.meta.url).href;
const worker = new Worker(new URL('./mariadb-worker.js', import.meta.url), { workerData: { cfg, sab, port: port2, adapter }, transferList: [port2] });
worker.unref(); worker.on('error', (e) => { console.error('[mariadb-worker]', e); });

function call(op, sql, params) {
  Atomics.store(flag, 0, 0);
  worker.postMessage({ op, sql, params: params?.map((v) => (v === undefined ? null : v)) });
  if (Atomics.wait(flag, 0, 0, TIMEOUT) === 'timed-out') throw new Error(`MariaDB : délai dépassé (${TIMEOUT} ms)`);
  const m = receiveMessageOnPort(port1)?.message;
  if (!m) throw new Error('MariaDB : réponse vide');
  if (m.error) { const e = new Error(m.error.message); Object.assign(e, m.error); throw normalizeMariaError(e); }
  return m.result;
}
call('connect');

export const raw = null;
const bufs = (rows) => { for (const r of rows) for (const k in r) if (r[k] instanceof Uint8Array && !Buffer.isBuffer(r[k])) r[k] = Buffer.from(r[k].buffer, r[k].byteOffset, r[k].byteLength); return rows; };
export const query = (sql, p) => bufs(call('query', toMariaDb(sql), p));
export const exec = (sql, p) => call('exec', toMariaDb(sql), p);
export const script = (sql) => call('script', sql);
export const begin = () => call('script', 'START TRANSACTION');
export const commit = () => call('script', 'COMMIT');
export const rollback = () => call('script', 'ROLLBACK');
export const savepoint = (n) => call('script', `SAVEPOINT ${n}`);
export const release = (n) => call('script', `RELEASE SAVEPOINT ${n}`);
export const rollbackTo = (n) => call('script', `ROLLBACK TO SAVEPOINT ${n}`);
export const hasTable = (t) => call('query', 'SELECT 1 x FROM information_schema.tables WHERE table_schema=? AND table_name=?', [databaseName, t]).length > 0;
export const normalizeError = (e) => e;
export const close = () => { try { call('close'); } catch {} };
export const dropDatabase = () => call('script', `DROP DATABASE IF EXISTS \`${databaseName}\``);
// Schéma initial : fichier généré (npm run gen:mariadb), avec le nom de base configuré.
export const baselineSql = () => readFileSync(resolve(here, '../database/mariadb/Gestion_pharmacie.sql'), 'utf8').replace(/`Gestion_pharmacie`/g, `\`${databaseName}\``);
