import { remindScheduled } from './delivery_config.js';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, all } from './db.js';
import { seedRbac } from './rbac.js';
import { bootNetwork, purgeTrash } from './boot.js';
import { handleApi, securityHeaders, config, notify } from './http.js';
import './routes/i18n.js'; import './routes/filemanager.js'; import './routes/auth.js'; import './routes/catalog.js'; import './routes/stock.js'; import './routes/sales.js'; import './routes/clients.js'; import './routes/admin.js'; import './routes/reports.js'; import './routes/features.js'; import './routes/accounts.js'; import './routes/payments.js'; import './routes/payments2.js'; import './routes/delivery.js'; import './routes/me.js'; import './routes/rfq.js'; import './routes/accounting.js'; import './routes/forecast.js'; import './routes/countries.js'; import './routes/network.js'; import './routes/discover.js'; import './routes/help.js'; import './routes/drivers.js'; import './routes/dispatch.js'; import { runSubscriptions } from './routes/finance2.js'; import './routes/appointments.js';
import { expireOrders } from './routes/clients.js';
import { refreshAll } from './alerts.js';

seedRbac();
bootNetwork();
const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, '../web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

// Service worker généré : liste des fichiers de la coque + empreinte → mise à jour automatique des clients à chaque changement
function walk(dir, base = '') { return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(resolve(dir, d.name), base + '/' + d.name) : [base + '/' + d.name])); }
// Manifeste dynamique : le nom et la couleur de l'application installée suivent la personnalisation du super-administrateur.
function serveManifest(res) {
  const base = JSON.parse(readFileSync(resolve(WEB, 'manifest.webmanifest'), 'utf8'));
  try {
    const ph = get("SELECT id,name FROM pharmacies WHERE status='active' ORDER BY id LIMIT 1");
    const v = (k) => get('SELECT svalue v FROM settings WHERE pharmacy_id IN (0,?) AND skey=? ORDER BY pharmacy_id DESC LIMIT 1', ph?.id ?? 0, k)?.v;
    const name = (v('brand_name') || ph?.name || base.name).slice(0, 45); base.name = name; base.short_name = name.length <= 12 ? name : (name.split(/\s+/).reduce((a, w) => ((a + ' ' + w).trim().length <= 12 ? (a + ' ' + w).trim() : a), '') || name.slice(0, 12));
    if (/^#[0-9a-fA-F]{6}$/.test(v('brand_color') || '')) base.theme_color = v('brand_color');
  } catch { /* base non prête : valeurs par défaut */ }
  base.id = '/'; base.shortcuts = [{ name: 'Pharmacies', url: '/#/discover' }, { name: 'Mon espace', url: '/#/portal' }];
  res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }); res.end(JSON.stringify(base));
}
function serveSw(res) {
  const files = walk(WEB).filter((f) => !/\/(sw\.js|api-docs\.(html|js))$/.test(f) && !f.endsWith('.map'));
  const h = createHash('sha1'); for (const f of files.sort()) h.update(f + statSync(resolve(WEB, '.' + f)).mtimeMs + statSync(resolve(WEB, '.' + f)).size);
  const list = ['/', ...files.map((f) => (f === '/index.html' ? '/index.html' : f))];
  const src = readFileSync(resolve(WEB, 'sw.js'), 'utf8').replace('__VERSION__', h.digest('hex').slice(0, 12)).replace('__ASSETS__', JSON.stringify(list));
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Service-Worker-Allowed', '/'); res.end(src);
}

export function createApp() {
  return createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
      res.setHeader('Content-Type', 'application/json');
      // Diagnostic détaillé réservé à qui connaît SETUP_TOKEN : /health?token=…  (aucun mot de passe n'est jamais affiché)
      if (process.env.SETUP_TOKEN && url.searchParams.get('token') === process.env.SETUP_TOKEN) {
        const chk = (f) => { try { return { ok: true, value: f() }; } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 400), code: e.code, errno: e.errno }; } };
        return res.end(JSON.stringify({ status: 'diagnostic', driver: process.env.DB_DRIVER || 'sqlite', node: process.version, prod: config.prod, database: process.env.DB_DRIVER === 'mariadb' ? { host: process.env.MARIADB_HOST, port: process.env.MARIADB_PORT || 3306, name: process.env.MARIADB_DATABASE, user: process.env.MARIADB_USER } : { file: process.env.DB_FILE },
          ping: chk(() => get('SELECT 1 x').x), users: chk(() => get('SELECT COUNT(*) n FROM users').n), migrations: chk(() => all('SELECT name FROM schema_migrations ORDER BY name').map((r) => r.name)), countries: chk(() => get('SELECT COUNT(*) n FROM countries').n), settings: chk(() => get('SELECT COUNT(*) n FROM settings').n) }, null, 1));
      }
      return res.end('{"status":"ok"}');
    }
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
    if (url.pathname === '/sw.js') return serveSw(res);
    if (url.pathname === '/manifest.webmanifest') return serveManifest(res);
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p === '/' || p === '\\') p = '/index.html';
    if (p === '/api-docs') p = '/api-docs.html';
    let file = resolve(WEB, '.' + p);
    if (!file.startsWith(WEB)) { res.statusCode = 403; return res.end(); }
    if (!existsSync(file) || !statSync(file).isFile()) { if (extname(p)) { res.statusCode = 404; return res.end('Not found'); } file = resolve(WEB, 'index.html'); }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', config.prod && file.includes('/assets/') ? 'public, max-age=86400' : 'no-cache');
    res.end(readFileSync(file));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = parseInt(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`Gestion_pharmacie ${config.prod ? '[PRODUCTION]' : '[DEV]'} → http://localhost:${port}   (API: /api/v1, doc: /api-docs)`);
  });
  setInterval(() => { try { expireOrders(); refreshAll(); purgeTrash(); runSubscriptions(); } catch (e) { console.error('[job]', e); } }, 10 * 60 * 1000).unref();
  setInterval(() => { try { remindScheduled(notify); } catch (e) { console.error('[rappel]', e); } }, 60 * 1000).unref();
  try { expireOrders(); refreshAll(); } catch (e) { console.error('[job]', e); }
}
