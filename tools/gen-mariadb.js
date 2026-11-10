// Génère database/mariadb/Gestion_pharmacie.sql (MariaDB 10.6+, InnoDB, utf8mb4) à partir de server/schema.sql.
// Usage : npm run gen:mariadb
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let src = readFileSync(resolve(root, 'server/schema.sql'), 'utf8');
// Migrations (server/migrations/*.sql) : tables/index ajoutés tels quels ; « ALTER TABLE … ADD COLUMN » est intégré à la définition de la table ; les UPDATE de reprise de données ne concernent pas une base neuve.
for (const f of readdirSync(resolve(root, 'server/migrations')).filter((x) => x.endsWith('.sql')).sort()) src += '\n' + readFileSync(resolve(root, 'server/migrations', f), 'utf8');
for (const a of [...src.matchAll(/^ALTER TABLE (\w+) ADD COLUMN (.+);$/gm)]) {
  const re = new RegExp(`(CREATE TABLE ${a[1]} \\(\\n[\\s\\S]*?)\\n\\);`);
  if (!re.test(src)) throw new Error('table inconnue pour ' + a[0]);
  src = src.replace(re, (x, body) => body + ',\n  ' + a[2] + '\n);').replace(a[0], '');
}
src = src.replace(/^UPDATE .*;$/gm, '');

const LONG = /^(notes|address|legal_notice|old_json|new_json|body|reason|status_reason|difference_reason|posology|delivery_address|storage_conditions)$/;
const DATE_ONLY = /^(exp_date|mfg_date|birth_date|prescription_date|valid_until|expected_date)$/;
const DATETIME = /(_at|_until)$/;
const q = (s) => '`' + s + '`';
function colType(name, type) {
  if (type === 'INTEGER') return 'BIGINT'; if (type === 'REAL' || type === 'DOUBLE') return 'DOUBLE'; if (type === 'BLOB') return 'LONGBLOB';
  if (DATE_ONLY.test(name)) return 'DATE'; if (DATETIME.test(name)) return 'DATETIME';
  if (LONG.test(name)) return 'TEXT'; if (name === 'svalue') return 'VARCHAR(1000)';
  return 'VARCHAR(255)';
}
const fks = [], out = [];
// Convertit une définition de colonne SQLite en MariaDB ; renvoie null pour une ligne sans colonne.
function convLine(table, line, fkList) {
  line = line.trim().replace(/,$/, ''); if (!line) return null;
  if (/^(PRIMARY KEY|UNIQUE|CHECK)\b/.test(line)) return line.replace(/\((.*?)\)/, (x, cols) => (/^(PRIMARY KEY|UNIQUE)/.test(line) ? '(' + cols.split(',').map((c) => q(c.trim())).join(', ') + ')' : x));
  const cm = /^(\w+) (INTEGER|TEXT|REAL|DOUBLE|BLOB)(.*)$/.exec(line); if (!cm) throw new Error('ligne non reconnue : ' + line);
  let [, name, type, rest] = cm;
  let t = table === 'period_locks' && name === 'locked_until' ? 'DATE' : colType(name, type);
  rest = rest.replace(/ REFERENCES (\w+)\((\w+)\)( ON DELETE (?:CASCADE|SET NULL|RESTRICT))?/, (x, rt, rc, od) => { fkList.push(`ALTER TABLE ${q(table)} ADD CONSTRAINT ${q('fk_' + table + '_' + name)} FOREIGN KEY (${q(name)}) REFERENCES ${q(rt)} (${q(rc)})${od || ''};`); return ''; });
  if (/PRIMARY KEY AUTOINCREMENT/.test(rest)) return `${q(name)} BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY`;
  rest = rest.replace(/ DEFAULT \(datetime\('now'\)\)/, ' DEFAULT CURRENT_TIMESTAMP');
  if (t === 'DATETIME' && !/NOT NULL/.test(rest) && !/DEFAULT/.test(rest)) rest += ' NULL DEFAULT NULL';
  return `${q(name)} ${t}${rest}`;
}
const tableRe = /CREATE TABLE (\w+) \(\n([\s\S]*?)\n\);/g; let m;
while ((m = tableRe.exec(src))) {
  const [, table, body] = m; const defs = body.split('\n').map((l) => convLine(table, l, fks)).filter(Boolean);
  out.push(`CREATE TABLE ${q(table)} (\n  ${defs.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
}
const idx = [...src.matchAll(/CREATE INDEX (\w+) ON (\w+)\((.*?)\);/g)].map((x) => `CREATE INDEX ${q(x[1])} ON ${q(x[2])} (${x[3].split(',').map((c) => q(c.trim())).join(', ')});`);
const trig = ['audit_logs', 'stock_movements'].flatMap((t) => ['UPDATE', 'DELETE'].map((op) => `CREATE TRIGGER ${q(t + '_no_' + op.toLowerCase())} BEFORE ${op} ON ${q(t)} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${t} est en ajout seul';`))
  .concat(['sales', 'sale_lines'].map((t) => `CREATE TRIGGER ${q(t + '_no_delete')} BEFORE DELETE ON ${q(t)} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'une vente validée ne peut pas être supprimée (utiliser un remboursement)';`));
const sql = `-- Gestion_pharmacie — schéma MariaDB 10.6+ (InnoDB, utf8mb4). GÉNÉRÉ par tools/gen-mariadb.js — ne pas modifier à la main.
-- ⚠ Non exécuté sur un serveur MariaDB dans l'environnement de développement initial : valider sur une instance de test (voir docs/MISE_EN_LIGNE.md).
-- Montants : BIGINT en plus petite unité monétaire (ex. millimes pour TND).
SET FOREIGN_KEY_CHECKS = 0;

${out.join('\n\n')}

SET FOREIGN_KEY_CHECKS = 1;

-- Clés étrangères
${fks.join('\n')}

-- Index
${idx.join('\n')}

-- Tables en ajout seul / suppression interdite des pièces validées
${trig.join('\n')}
`;
writeFileSync(resolve(root, 'database/mariadb/Gestion_pharmacie.sql'), sql);

// Scripts d'évolution d'une base MariaDB déjà installée (une version plus ancienne) : un fichier par migration, appliqué seulement s'il manque dans schema_migrations.
import { mkdirSync } from 'node:fs';
mkdirSync(resolve(root, 'database/mariadb/migrations'), { recursive: true });
let nmig = 0;
for (const f of readdirSync(resolve(root, 'server/migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  const t = readFileSync(resolve(root, 'server/migrations', f), 'utf8'), parts = [], pf = [];
  for (const mm of t.matchAll(/CREATE TABLE (\w+) \(\n([\s\S]*?)\n\);/g)) parts.push(`CREATE TABLE ${q(mm[1])} (\n  ${mm[2].split('\n').map((l) => convLine(mm[1], l, pf)).filter(Boolean).join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
  for (const mm of t.matchAll(/^ALTER TABLE (\w+) ADD COLUMN (.+);$/gm)) parts.push(`ALTER TABLE ${q(mm[1])} ADD COLUMN ${convLine(mm[1], mm[2], pf)};`);
  parts.push(...pf, ...[...t.matchAll(/CREATE INDEX (\w+) ON (\w+)\((.*?)\);/g)].map((x) => `CREATE INDEX ${q(x[1])} ON ${q(x[2])} (${x[3].split(',').map((c) => q(c.trim())).join(', ')});`));
  parts.push(...[...t.matchAll(/^(UPDATE [^;]*;)$/gm)].map((x) => x[1]));
  const ins = t.match(/^INSERT INTO[\s\S]*?;\s*$/m); if (ins) parts.push(ins[0].trim());
  writeFileSync(resolve(root, 'database/mariadb/migrations', f), '-- GÉNÉRÉ par tools/gen-mariadb.js\n' + parts.join('\n\n') + '\n'); nmig++;
}
console.log(`${nmig} scripts d'évolution MariaDB générés`);
console.log(`OK : ${out.length} tables, ${fks.length} clés étrangères, ${idx.length} index, ${trig.length} triggers`);
