// Diagnostic de la base MariaDB AVANT le premier démarrage : npm run check:mariadb
// Lit les variables MARIADB_* (ex. : node --env-file=.env tools/mariadb-doctor.js). N'écrit que dans une table temporaire qu'il supprime.
const E = process.env, out = [];
const ok = (m) => { out.push('  OK  ' + m); }, ko = (m, fix) => { out.push('  ÉCHEC ' + m + (fix ? '\n        → ' + fix : '')); process.exitCode = 1; }, info = (m) => out.push('  ·   ' + m);
let mysql;
try { mysql = (await import('mysql2/promise')).default; } catch { console.error("Paquet mysql2 absent : npm install"); process.exit(1); }
const cfg = { host: E.MARIADB_HOST, port: parseInt(E.MARIADB_PORT) || 3306, user: E.MARIADB_USER, password: E.MARIADB_PASSWORD, database: E.MARIADB_DATABASE, connectTimeout: 10000, ssl: E.MARIADB_SSL === 'true' ? { rejectUnauthorized: true } : undefined };
console.log(`Connexion à ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database} (SSL ${cfg.ssl ? 'oui' : 'non'})`);
if (!cfg.host || !cfg.user || !cfg.database) { console.error('MARIADB_HOST, MARIADB_USER et MARIADB_DATABASE sont obligatoires.'); process.exit(1); }
let c;
try { c = await mysql.createConnection(cfg); ok('connexion établie'); }
catch (e) {
  const hint = { ECONNREFUSED: 'Serveur injoignable : mauvais hôte/port, ou accès distant non autorisé.', ETIMEDOUT: "Délai dépassé : le pare-feu bloque. Hostinger → MySQL distant : autorisez l'adresse IP de sortie de votre hébergeur.", ENOTFOUND: "Nom d'hôte introuvable.", ER_ACCESS_DENIED_ERROR: "Identifiants refusés, ou cette IP n'est pas autorisée pour cet utilisateur.", ER_DBACCESS_DENIED_ERROR: "L'utilisateur n'a pas accès à cette base (hPanel : l'associer à la base).", ER_BAD_DB_ERROR: 'Base introuvable : créez-la dans hPanel.' }[e.code];
  ko(`${e.code || ''} ${e.message}`, hint); console.log(out.join('\n')); process.exit(1);
}
const q = async (sql, p) => (await c.query(sql, p))[0];
try {
  const v = (await q('SELECT VERSION() v'))[0].v; info('version : ' + v); const m = /^(\d+)\.(\d+)/.exec(v);
  if (/mariadb/i.test(v) && m && (+m[1] < 10 || (+m[1] === 10 && +m[2] < 6))) ko('MariaDB < 10.6', 'Version 10.6 ou plus récente requise'); else ok('version compatible');
  const g = (await q("SHOW VARIABLES WHERE Variable_name IN ('max_allowed_packet','character_set_server','log_bin','log_bin_trust_function_creators')")).reduce((a, r) => (a[r.Variable_name] = r.Value, a), {});
  const mb = Number(g.max_allowed_packet) / 1048576; info(`max_allowed_packet : ${mb.toFixed(0)} Mo · log_bin : ${g.log_bin} · log_bin_trust_function_creators : ${g.log_bin_trust_function_creators}`);
  if (mb < 16) ko(`max_allowed_packet = ${mb.toFixed(0)} Mo : les fichiers de plus de ~${Math.floor(mb / 2)} Mo seront refusés`, 'Demandez 16 Mo ou plus à l’hébergeur, ou réduisez la taille des fichiers'); else ok('max_allowed_packet suffisant pour les ordonnances (≤ 5 Mo)');
  const tables = (await q('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE()'))[0].n; info(`tables existantes dans la base : ${tables}${tables ? ' (base déjà initialisée ou non vide)' : ' (vide : le schéma sera créé au premier démarrage)'}`);
  // Droits : création de table, d'index, de trigger ; écriture et lecture binaire
  await q('DROP TABLE IF EXISTS gp_doctor_tmp'); await q('CREATE TABLE gp_doctor_tmp (id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(255) NOT NULL, data LONGBLOB NOT NULL, n BIGINT NOT NULL DEFAULT 0, UNIQUE KEY u_name (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'); ok('CREATE TABLE / INDEX autorisés');
  const bin = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256)); await c.query('INSERT INTO gp_doctor_tmp(name,data) VALUES (?,?)', ['é-test', bin]);
  const back = (await q('SELECT data FROM gp_doctor_tmp WHERE name=?', ['é-test']))[0].data; Buffer.compare(back, bin) === 0 ? ok('fichier binaire écrit puis relu à l’octet près') : ko('fichier binaire altéré à la relecture');
  const big = Buffer.alloc(Math.min(5 * 1024 * 1024, Math.floor(Number(g.max_allowed_packet) / 2.2)), 7); await c.query('INSERT INTO gp_doctor_tmp(name,data) VALUES (?,?)', ['gros', big]); ok(`fichier de ${(big.length / 1048576).toFixed(1)} Mo accepté`);
  try { await q("CREATE TRIGGER gp_doctor_trg BEFORE DELETE ON gp_doctor_tmp FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test'"); let blocked = false; try { await q('DELETE FROM gp_doctor_tmp WHERE name=?', ['gros']); } catch { blocked = true; } blocked ? ok('triggers autorisés et actifs (journal en ajout seul protégé)') : ko('trigger créé mais inactif'); await q('DROP TRIGGER gp_doctor_trg'); }
  catch (e) { ko(`CREATE TRIGGER refusé : ${e.message}`, "L'application démarrera quand même (avertissement), sans protection anti-modification du journal. Pour l'exiger : MARIADB_REQUIRE_TRIGGERS=true. Pour l'avoir : droit TRIGGER (et log_bin_trust_function_creators=1 si le journal binaire est actif), ou un VPS."); }
  await q('DROP TABLE IF EXISTS gp_doctor_tmp'); ok('table temporaire supprimée');
} catch (e) { ko(e.message); try { await q('DROP TABLE IF EXISTS gp_doctor_tmp'); } catch {} }
await c.end(); console.log(out.join('\n')); console.log(process.exitCode ? '\nRésultat : à corriger avant de démarrer (voir ci-dessus).' : '\nRésultat : la base est prête.');
