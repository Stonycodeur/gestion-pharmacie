// Faux « mysql2 » pour tester la passerelle synchrone sans serveur MariaDB : SQLite en mémoire derrière la même interface (query → [rows|ResultSetHeader]).
import { DatabaseSync } from 'node:sqlite';
export async function connect() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  const fmt = (sql, params = []) => { let i = 0; return sql.replace(/\?\?/g, () => '?').replace(/\?/g, () => '?'); };
  return {
    async query(sql, params = []) {
      if (/^\s*(CREATE DATABASE|USE\b|SET time_zone)/i.test(sql)) return [{ affectedRows: 0, insertId: 0 }];
      if (/^\s*(START TRANSACTION)/i.test(sql)) { db.exec('BEGIN'); return [{ affectedRows: 0, insertId: 0 }]; }
      if (/^\s*(SELECT|WITH)/i.test(sql)) return [db.prepare(sql).all(...params), []];
      if (/^\s*(CREATE|DROP|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(sql)) { db.exec(sql.replace(/RELEASE SAVEPOINT/, 'RELEASE').replace(/ROLLBACK TO SAVEPOINT/, 'ROLLBACK TO')); return [{ affectedRows: 0, insertId: 0 }]; }
      const r = db.prepare(sql).run(...params); return [{ affectedRows: Number(r.changes), insertId: Number(r.lastInsertRowid) }];
    },
    async ping() {}, async end() { db.close(); },
  };
}
