// Thread de travail : détient l'unique connexion MariaDB et exécute les requêtes demandées par le thread principal.
// Le thread principal se bloque (Atomics.wait) pendant l'exécution : le code métier reste synchrone et transactionnel, une requête HTTP à la fois.
import { parentPort, workerData } from 'node:worker_threads';
const { cfg, sab, port, adapter } = workerData;
const flag = new Int32Array(sab);
const { connect } = await import(adapter);
let conn;
const reply = (m) => { port.postMessage(m); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
const lost = (e) => ['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE'].includes(e?.code) || e?.errno === 2006 || e?.errno === 2013;
let inTx = false, dead = false;
// Ouvre (ou rouvre) la connexion et sélectionne la base. Un hébergeur ferme les connexions inactives : on détecte la fermeture et on se reconnecte.
async function open() {
  dead = false; try { conn?.destroy?.(); } catch { /* déjà fermée */ }
  conn = await connect(cfg);
  conn.on?.('error', () => { dead = true; }); conn.on?.('end', () => { dead = true; });
  if (cfg.database) { try { await conn.query('USE ??', [cfg.database]); } catch (e) { if (e.errno !== 1049) throw e; /* base absente : création (impossible sur un hébergement mutualisé : créez-la dans hPanel) */ await conn.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [cfg.database]); await conn.query('USE ??', [cfg.database]); } }
}
const gone = (e) => lost(e) || /closed state|connection lost|server has gone away|ECONNRESET|EPIPE|ETIMEDOUT|read ECONN|Connection.*(closed|ended)/i.test(String(e?.message || '')) || e?.fatal === true;
parentPort.on('message', async ({ op, sql, params }) => {
  if (params) params = params.map((v) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v)); // BLOB : le clonage entre threads donne un Uint8Array
  try {
    if (op === 'connect') { await open(); return reply({ result: true }); }
    const doit = async () => {
      if (op === 'query') { const [rows] = await conn.query(sql, params); return Array.isArray(rows) ? rows.map((r) => ({ ...r })) : []; }
      if (op === 'exec') { const [r] = await conn.query(sql, params); return { changes: r.affectedRows ?? 0, lastId: Number(r.insertId ?? 0) }; }
      if (op === 'script') { await conn.query(sql); return true; }
      if (op === 'close') { await conn.end(); return true; }
      throw new Error('op inconnue ' + op);
    };
    const starts = /^\s*(START TRANSACTION|BEGIN)/i.test(sql || ''), ends = /^\s*(COMMIT|ROLLBACK)\s*$/i.test(sql || '');
    if ((dead || !conn) && !inTx && op !== 'close') await open(); // connexion fermée par le serveur pendant l'inactivité
    let result;
    try { result = await doit(); }
    catch (e) { // connexion perdue : reconnexion transparente et nouvel essai, sauf au milieu d'une transaction (qui doit alors échouer proprement)
      if (gone(e) && !inTx && op !== 'close') { await open(); result = await doit(); }
      else { if (gone(e)) { dead = true; inTx = false; } throw e; }
    }
    if (starts) inTx = true; else if (ends) inTx = false;
    reply({ result });
  } catch (e) { reply({ error: { message: e.message, code: e.code, errno: e.errno, sqlState: e.sqlState, sqlMessage: e.sqlMessage } }); }
});
setInterval(() => { if (conn && !inTx && !dead) conn.ping().catch(() => { dead = true; }); }, 15000).unref(); // maintien de la connexion (les hébergeurs coupent souvent après 30-60 s)
