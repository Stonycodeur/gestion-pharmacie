// Pilote SQLite (développement et tests) — node:sqlite, synchrone.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.env.DB_FILE === ':memory:' ? ':memory:' : process.env.DB_FILE ? resolve(process.cwd(), process.env.DB_FILE) : resolve(here, '../data/dev.sqlite');
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
export const raw = new DatabaseSync(file);
raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
export const kind = 'sqlite';

import { appendFileSync } from 'node:fs';
const seen = new Set(); const DUMP = process.env.SQL_DUMP; // audit du dialecte : consigne chaque requête distincte (voir tools/check-dialect.js)
const note = (sql) => { if (DUMP && !seen.has(sql)) { seen.add(sql); appendFileSync(DUMP, JSON.stringify(sql) + '\n'); } };
const cache = new Map();
const prep = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
export const query = (sql, p) => { note(sql); return prep(sql).all(...p); };
export const exec = (sql, p) => { note(sql); const r = prep(sql).run(...p); return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) }; };
export const script = (sql) => raw.exec(sql);
export const begin = () => raw.exec('BEGIN IMMEDIATE');
export const commit = () => raw.exec('COMMIT');
export const rollback = () => raw.exec('ROLLBACK');
export const savepoint = (n) => raw.exec(`SAVEPOINT ${n}`);
export const release = (n) => raw.exec(`RELEASE ${n}`);
export const rollbackTo = (n) => raw.exec(`ROLLBACK TO ${n}`);
export const hasTable = (t) => !!raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
export const normalizeError = (e) => e;
export const close = () => raw.close();
