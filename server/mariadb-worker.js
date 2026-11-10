// Thread de travail : détient l'unique connexion MariaDB et exécute les requêtes demandées par le thread principal.
// Le thread principal se bloque (Atomics.wait) pendant l'exécution : le code métier reste synchrone et transactionnel, une requête HTTP à la fois.
import { parentPort, workerData } from 'node:worker_threads';
const { cfg, sab, port, adapter } = workerData;
const flag = new Int32Array(sab);
const { connect } = await import(adapter);
let conn;
const reply = (m) => { port.postMessage(m); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
const lost = (e) => ['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE'].includes(e?.code) || e?.errno === 2006 || e?.errno === 2013;
let inTx = false;
parentPort.on('message', async ({ op, sql, params }) => {
  if (params) params = params.map((v) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v)); // BLOB : le clonage entre threads donne un Uint8Array
  try {
    if (op === 'connect') { conn = await connect(cfg); if (cfg.database) { try { await conn.query('USE ??', [cfg.database]); } catch (e) { if (e.errno !== 1049) throw e; /* base absente : création (impossible sur un hébergement mutualisé : créez-la dans hPanel) */ await conn.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [cfg.database]); await conn.query('USE ??', [cfg.database]); } } return reply({ result: true }); }
    const doit = async () => {
      if (op === 'query') { const [rows] = await conn.query(sql, params); return Array.isArray(rows) ? rows.map((r) => ({ ...r })) : []; }
      if (op === 'exec') { const [r] = await conn.query(sql, params); return { changes: r.affectedRows ?? 0, lastId: Number(r.insertId ?? 0) }; }
      if (op === 'script') { await conn.query(sql); return true; }
      if (op === 'close') { await conn.end(); return true; }
      throw new Error('op inconnue ' + op);
    };
    if (/^\s*(START TRANSACTION|BEGIN)/i.test(sql || '')) inTx = true; else if (/^\s*(COMMIT|ROLLBACK)\s*$/i.test(sql || '')) inTx = false;
    let result;
    try { result = await doit(); }
    catch (e) { // connexion perdue hors transaction : reconnexion transparente, une seule fois
      if (lost(e) && !inTx) { conn = await connect(cfg); await conn.query('USE ??', [cfg.database]); result = await doit(); } else throw e;
    }
    reply({ result });
  } catch (e) { reply({ error: { message: e.message, code: e.code, errno: e.errno, sqlState: e.sqlState, sqlMessage: e.sqlMessage } }); }
});
setInterval(() => { if (conn && !inTx) conn.ping().catch(() => {}); }, 60000).unref();
