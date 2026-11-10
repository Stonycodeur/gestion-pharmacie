// Traduction du SQL « SQLite » écrit dans le code métier vers MariaDB. Pur et testé (tests/dialect.test.js).
// Seules les constructions réellement utilisées par l'application sont prises en charge ; toute autre doit être ajoutée ICI avec un test.
export function toMariaDb(sql) {
  let s = sql;
  s = s.replace(/CAST\(julianday\(([^()]+)\) - julianday\(date\('now'\)\) AS INTEGER\)/g, 'DATEDIFF($1, UTC_DATE())');
  s = s.replace(/CAST\(([^()]+(?:\([^()]*\))?[^()]*) AS INTEGER\)/g, 'CAST($1 AS SIGNED)');
  s = s.replace(/datetime\('now', *'([-+])(\d+) (day|days|hour|hours|minute|minutes)'\)/g, (m, sg, n, u) => `DATE_${sg === '-' ? 'SUB' : 'ADD'}(UTC_TIMESTAMP(), INTERVAL ${n} ${u.replace(/s$/, '').toUpperCase()})`);
  s = s.replace(/datetime\('now'\)/g, 'UTC_TIMESTAMP()').replace(/date\('now'\)/g, 'UTC_DATE()');
  s = s.replace(/strftime\('([^']+)', *([a-zA-Z_.]+)\)/g, "DATE_FORMAT($2, '$1')");
  s = s.replace(/\bINSERT OR IGNORE INTO\b/g, 'INSERT IGNORE INTO');
  if (/ON CONFLICT\([^)]*\) DO NOTHING/.test(s)) s = s.replace(/^(\s*)INSERT INTO\b/, '$1INSERT IGNORE INTO').replace(/\s*ON CONFLICT\([^)]*\) DO NOTHING/, '');
  s = s.replace(/ON CONFLICT\([^)]*\) DO UPDATE SET (.+)$/s, (m, set) => 'ON DUPLICATE KEY UPDATE ' + set.replace(/excluded\.(\w+)/g, 'VALUES($1)'));
  s = s.replace(/\bMAX\(0, /g, 'GREATEST(0, ');
  s = s.replace(/\) lines(?=,| FROM)/g, ') `lines`'); // LINES est un mot réservé MariaDB
  return s;
}
// Erreurs MariaDB → messages équivalents à ceux de SQLite, pour que la gestion d'erreurs de l'API soit unique.
export function normalizeMariaError(e) {
  const msg = String(e?.message || '');
  if (e?.errno === 1062) { const k = /for key '([^']+)'/.exec(msg)?.[1] || ''; e.message = `UNIQUE constraint failed: ${k}`; }
  else if (e?.errno === 1451 || e?.errno === 1452) e.message = 'FOREIGN KEY constraint failed';
  else if (e?.errno === 4025 || e?.errno === 3819) e.message = `CHECK constraint failed: ${/`([\w.]+)`/.exec(msg)?.[1] || ''} ${/stock_levels/.test(msg) ? 'qty_available' : ''}`;
  return e;
}
