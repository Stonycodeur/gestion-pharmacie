// Sauvegarde chiffrée (AES-256-GCM) + restauration vérifiée dans un emplacement isolé. SQLite (dev) et MariaDB (production).
//   BACKUP_KEY=<64 hex> node tools/backup.js backup  [dossier]     → data/backups/gp-AAAAMMJJ-HHMMSS.{sqlite|sql}.enc
//   BACKUP_KEY=<64 hex> node tools/backup.js verify  <fichier.enc>  → restaure dans une base/un dossier temporaire et contrôle l'intégrité
// MariaDB : nécessite les clients `mariadb-dump` et `mariadb` (ou mysqldump/mysql) ; variables MARIADB_HOST/PORT/USER/PASSWORD/DATABASE (comme l'application).
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const [cmd, arg] = process.argv.slice(2);
const key = Buffer.from(process.env.BACKUP_KEY || '', 'hex');
if (key.length !== 32) { console.error('BACKUP_KEY requis : 64 caractères hexadécimaux (openssl rand -hex 32)'); process.exit(1); }
const maria = process.env.DB_DRIVER === 'mariadb';
const dbFile = resolve(process.cwd(), process.env.DB_FILE || './data/dev.sqlite');
const M = { host: process.env.MARIADB_HOST || '127.0.0.1', port: process.env.MARIADB_PORT || '3306', user: process.env.MARIADB_USER || 'root', db: process.env.MARIADB_DATABASE || 'Gestion_pharmacie' };
const env = { ...process.env, MYSQL_PWD: process.env.MARIADB_PASSWORD || '' };
const bin = (a, b) => (spawnSync(a, ['--version']).status === 0 ? a : spawnSync(b, ['--version']).status === 0 ? b : null);
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})/, '$1-');
const seal = (magic, data) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv), enc = Buffer.concat([c.update(data), c.final()]); return Buffer.concat([Buffer.from(magic), iv, c.getAuthTag(), enc]); };
const open = (buf, magic) => { if (buf.subarray(0, 4).toString() !== magic) throw new Error('Format inconnu'); const d = createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16)); d.setAuthTag(buf.subarray(16, 32)); return Buffer.concat([d.update(buf.subarray(32)), d.final()]); };
const cli = (b, args, input) => spawnSync(b, ['-h', M.host, '-P', M.port, '-u', M.user, ...args], { env, input, maxBuffer: 1 << 30 });

if (cmd === 'backup') {
  const dir = resolve(process.cwd(), arg || './data/backups'); mkdirSync(dir, { recursive: true });
  if (maria) {
    const dump = bin('mariadb-dump', 'mysqldump'); if (!dump) { console.error('mariadb-dump / mysqldump introuvable'); process.exit(1); }
    const r = cli(dump, ['--single-transaction', '--routines', '--triggers', '--hex-blob', '--default-character-set=utf8mb4', M.db]); // instantané cohérent InnoDB, sans verrouiller l'application
    if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1); }
    const name = `gp-${stamp()}.sql.enc`; writeFileSync(join(dir, name), seal('GPB2', r.stdout), { mode: 0o600 }); console.log('Sauvegarde chiffrée :', join(dir, name));
  } else {
    const tmp = join(mkdtempSync(join(tmpdir(), 'gp-bk-')), 'snap.sqlite');
    const db = new DatabaseSync(dbFile); db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); db.close(); // instantané cohérent, sans arrêter l'application
    const name = `gp-${stamp()}.sqlite.enc`; writeFileSync(join(dir, name), seal('GPB1', readFileSync(tmp)), { mode: 0o600 }); rmSync(resolve(tmp, '..'), { recursive: true });
    console.log('Sauvegarde chiffrée :', join(dir, name));
  }
} else if (cmd === 'verify' && arg) {
  const buf = readFileSync(resolve(arg));
  if (buf.subarray(0, 4).toString() === 'GPB2') {
    const plain = open(buf, 'GPB2'); const sql = plain.toString('utf8');
    const tables = (sql.match(/^CREATE TABLE /gm) || []).length, hasEnd = /-- Dump completed/.test(sql);
    const client = bin('mariadb', 'mysql'); let restored = 'non testée (client mariadb absent)', ok = tables > 40 && hasEnd;
    if (client) {
      const tmpDb = 'gp_verify_' + randomBytes(4).toString('hex');
      try {
        cli(client, ['-e', `CREATE DATABASE \`${tmpDb}\``]);
        const r = cli(client, [tmpDb], sql.replace(/^USE .*$/gm, '').replace(/^CREATE DATABASE .*$/gm, ''));
        const n = cli(client, ['-N', '-e', `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${tmpDb}'`]);
        restored = r.status === 0 ? `${String(n.stdout).trim()} tables restaurées` : 'ÉCHEC : ' + String(r.stderr).slice(0, 200); ok = ok && r.status === 0;
      } finally { cli(client, ['-e', `DROP DATABASE IF EXISTS \`${tmpDb}\``]); }
    }
    console.log('Restauration isolée :', ok ? 'OK' : 'ÉCHEC', { tables_dans_le_dump: tables, dump_complet: hasEnd, restauration: restored }); process.exit(ok ? 0 : 2);
  } else {
    const plain = open(buf, 'GPB1'); const dir = mkdtempSync(join(tmpdir(), 'gp-restore-')); const f = join(dir, 'restored.sqlite'); writeFileSync(f, plain);
    const db = new DatabaseSync(f); const ok = db.prepare('PRAGMA integrity_check').get().integrity_check; const fk = db.prepare('PRAGMA foreign_key_check').all().length;
    const n = Object.fromEntries(['sales', 'products', 'stock_movements', 'audit_logs', 'users'].map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])); db.close(); rmSync(dir, { recursive: true });
    console.log('Restauration isolée :', ok === 'ok' && fk === 0 ? 'OK' : 'ÉCHEC', { integrity: ok, fk_errors: fk, ...n }); process.exit(ok === 'ok' && fk === 0 ? 0 : 2);
  }
} else { console.error('Usage : backup [dossier] | verify <fichier.enc>'); process.exit(1); }
