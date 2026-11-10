// Vérifie que TOUT le SQL émis par la suite de tests, une fois traduit, ne contient plus de syntaxe propre à SQLite.
// Usage : npm run check:dialect
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toMariaDb } from '../server/sql-dialect.js';

const dir = mkdtempSync(join(tmpdir(), 'dialect-')), dump = join(dir, 'sql.log');
try { execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', 'tests/api.test.js', 'tests/features.test.js', 'tests/setup.test.js'], { env: { ...process.env, SQL_DUMP: dump }, stdio: 'pipe' }); }
catch (e) { console.error(String(e.stdout || e.message).slice(-1500)); process.exit(1); }
const sqls = [...new Set(readFileSync(dump, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))];
const BAD = [[/datetime\s*\(/i, 'datetime()'], [/\bdate\s*\('now'/i, "date('now')"], [/julianday/i, 'julianday'], [/strftime/i, 'strftime'], [/INSERT OR /i, 'INSERT OR …'], [/ON CONFLICT/i, 'ON CONFLICT'], [/excluded\./i, 'excluded.'], [/\bMAX\(\s*\d+\s*,/i, 'MAX scalaire'], [/AS INTEGER\)/i, 'CAST AS INTEGER'], [/\bRETURNING\b/i, 'RETURNING'], [/\bGLOB\b/i, 'GLOB'], [/\bIFNULL\b/i, 'IFNULL (ok mais à vérifier)'], [/\)\s+lines\b/, 'alias lines non protégé'], [/\browid\b/i, 'rowid']];
let bad = 0;
for (const s of sqls) { const t = toMariaDb(s); for (const [re, name] of BAD) if (re.test(t)) { bad++; console.error(`✗ ${name} : ${s.slice(0, 160).replace(/\s+/g, ' ')}`); } }
rmSync(dir, { recursive: true, force: true });
console.log(`${sqls.length} requêtes distinctes analysées - ${bad ? bad + ' problème(s)' : 'aucune syntaxe SQLite restante après traduction'}`);
process.exit(bad ? 1 : 0);
