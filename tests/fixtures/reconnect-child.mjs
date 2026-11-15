// Processus enfant du test mariadb-reconnect : scénario « connexion fermée par l'hébergeur ».
const d = await import('../../server/driver-mariadb.js');
const out = [];
out.push(d.query('SELECT 1 x')[0].x);
out.push(d.query('SELECT 1 x')[0].x);          // 4e requête : « closed state » → reconnexion + nouvel essai
d.begin(); out.push(d.exec('INSERT INTO t VALUES (1)').lastId); d.commit();
out.push(d.query('SELECT connects c')[0].c);   // connexions ouvertes
console.log(JSON.stringify(out));
process.exit(0);
