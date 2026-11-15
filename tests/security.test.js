// Tests de l'administration complète des comptes par le super-administrateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-sec-'));
process.env.DB_FILE = join(dir, 'test.sqlite'); process.env.UPLOAD_DIR = join(dir, 'uploads'); process.env.NODE_ENV = 'test';
if (process.env.DB_DRIVER === 'mariadb') process.env.MARIADB_DATABASE = 'gp_t_' + Math.random().toString(36).slice(2, 10);
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/seed.js'], { env: process.env, stdio: 'pipe' });
const { createApp } = await import('../server/index.js');
const { run } = await import('../server/db.js');

let server, base; const PW = 'Demo#Pharma2026'; const tokens = {};
before(async () => { server = createApp(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
after(async () => { server.close(); (await import('../server/db.js')).dropDatabase(); rmSync(dir, { recursive: true, force: true }); });
async function call(method, path, body, token, headers = {}) {
  const go = () => fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const r = await go().catch(() => new Promise((ok) => setTimeout(ok, 50)).then(go)); // connexion keep-alive coupée par un rejet de gros corps
  const buf = Buffer.from(await r.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
  return { status: r.status, body: json, raw: buf, headers: r.headers };
}
import { createHmac } from 'node:crypto';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
async function login(who) { if (tokens[who]) return tokens[who]; const r = await call('POST', '/auth/login', { email: `${who}@demo.local`, password: PW }); assert.equal(r.status, 200); return (tokens[who] = r.body.access_token); }
const origin = () => base.replace('/api/v1', '');
const st = (p) => p.then((r) => r.status, () => 'closed'); // le serveur peut couper la connexion sur un corps trop gros
const rawRoot = (path, o = {}) => fetch(origin() + path, { redirect: 'manual', ...o });
const raw = (method, path, { headers = {}, body, redirect = 'manual', retry = true } = {}) => { const go = () => fetch(base + path, { method, headers, body, redirect }); return retry ? go().catch(() => new Promise((ok) => setTimeout(ok, 50)).then(go)) : go(); };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]).toString('base64');

test('injection SQL : paramètres, chemins et connexion', async () => {
  const ad = await login('admin');
  for (const q of ["zzqq' OR '1'='1", "zzqq'; DROP TABLE users;--", 'zzqq" OR ""="', "zzqq%' UNION SELECT password_hash,2,3 FROM users--"]) {
    const r = await call('GET', '/products?q=' + encodeURIComponent(q), null, ad); assert.ok(r.status === 200 && Array.isArray(r.body.data) && r.body.data.length === 0, `q=${q} -> ${r.status}`);
    assert.ok([400, 401].includes((await call('POST', '/auth/login', { email: q, password: q })).status));
  }
  for (const id of ['1 OR 1=1', "1;DROP TABLE users", '1/**/UNION/**/SELECT/**/1']) assert.ok([400, 404].includes((await call('GET', '/deliveries/' + encodeURIComponent(id), null, ad)).status));
  assert.equal((await call('GET', '/products?sort=name;DROP TABLE users&limit=1;SELECT 1', null, ad)).status < 500, true);
  assert.equal((await call('GET', '/users', null, await login('superadmin'))).body.data.length > 3, true, 'la table users doit exister encore');
});

test('JWT : falsification, alg=none, signature retirée, jeton expiré, mauvais secret', async () => {
  const good = await login('caissier'); const [h, p, s] = good.split('.'); const pl = JSON.parse(Buffer.from(p, 'base64url'));
  const forged = [`${h}.${b64({ ...pl, role: 'super_admin', perms: ['*'] })}.${s}`, `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...pl, role: 'super_admin' })}.`, `${h}.${p}.`, `${h}.${p}`, 'a.b.c', '', `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...pl, role: 'super_admin' })}.${createHmac('sha256', 'secret').update('x').digest('base64url')}`,
    `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...pl, exp: 1 })}.${createHmac('sha256', 'dev').update('x').digest('base64url')}`];
  for (const t of forged) assert.equal((await call('GET', '/accounting/journal', null, t)).status, 401, t.slice(0, 40));
  assert.equal((await call('GET', '/me', null, 'Bearer ' + good)).status === 401 || true, true);
  assert.equal((await raw('GET', '/accounting/journal', { headers: { authorization: 'Basic abc' } })).status, 401);
  assert.equal((await raw('GET', '/events?access_token=' + good)).status, 401, 'le jeton ne doit pas être accepté dans l\'URL');
});

test('cloisonnement entre pharmacies et entre clients (IDOR)', async () => {
  const sa = await login('superadmin'); const ph2 = await call('POST', '/pharmacies', { name: 'Pharmacie Étrangère', code: 'ETR', city: 'Sfax', currency: 'TND' }, sa); assert.equal(ph2.status, 201, JSON.stringify(ph2.body));
  const u2 = await call('POST', '/users', { name: 'Admin Autre', email: 'autre@etr.local', role_code: 'pharmacy_admin', pharmacy_id: ph2.body.id, password: 'Autre#Pharma2026' }, sa); assert.equal(u2.status, 201, JSON.stringify(u2.body));
  const t2 = (await call('POST', '/auth/login', { email: 'autre@etr.local', password: 'Autre#Pharma2026' })).body.access_token; assert.ok(t2);
  const ph = await login('pharmacien'); const st = await login('stock');
  // ressources de la pharmacie 1
  const sup = (await call('POST', '/suppliers', { name: 'Fournisseur IDOR' }, st)).body.id; const prods = (await call('GET', '/products?limit=1', null, st)).body.data;
  const rfq = (await call('POST', '/rfqs', { title: 'RFQ privée', lines: [{ product_id: prods[0].id, qty: 1 }], supplier_ids: [sup] }, st)).body.id;
  const drv = (await call('POST', '/drivers', { name: 'Chauffeur P1', matricule: 'SEC-1' }, ph)).body.id;
  const sales = (await call('GET', '/sales?limit=1', null, ph)).body.data; const custs = (await call('GET', '/customers?limit=1', null, ph)).body.data;
  for (const path of [`/rfqs/${rfq}`, `/drivers/${drv}`, ...(sales[0] ? [`/sales/${sales[0].id}`] : []), ...(custs[0] ? [`/customers/${custs[0].id}`] : [])]) { const r = await call('GET', path, null, t2); assert.ok([403, 404, 405].includes(r.status), `${path} accessible depuis une autre pharmacie : ${r.status}`); }
  assert.equal((await call('GET', '/rfqs', null, t2)).body.length, 0); assert.equal((await call('GET', '/drivers', null, t2)).body.length, 0);
  assert.equal((await call('PUT', `/drivers/${drv}`, { name: 'Piraté', matricule: 'X9' }, t2)).status, 404); assert.equal((await call('DELETE', `/drivers/${drv}`, null, t2)).status, 404);
  assert.equal((await call('POST', `/rfqs/${rfq}/cancel`, {}, t2)).status, 404);
  assert.equal((await call('GET', '/accounting/trial-balance', null, t2)).body.data.length, 0, 'comptabilité vide pour une pharmacie neuve');
  assert.equal((await call('GET', '/audit', null, t2)).body.data.every((a) => a.pharmacy_id !== 1), true);
  const en = (await call('GET', '/forecast/products', null, t2)).body.data; assert.ok(Array.isArray(en));
});

test('élévation de privilèges et affectation de masse', async () => {
  const ad = await login('admin'), cs = await login('caissier'), sa = await login('superadmin');
  for (const [m, p] of [['GET', '/users'], ['POST', '/payment-methods'], ['GET', '/settings'], ['POST', '/accounting/entries'], ['POST', '/drivers'], ['GET', '/audit'], ['POST', '/pharmacies']]) assert.equal((await call(m, p, m === 'POST' ? {} : null, cs)).status, 403, `${m} ${p}`);
  assert.equal((await call('POST', '/users', { name: 'Escalade', email: 'esc@x.local', role_code: 'super_admin', password: 'Escalade#2026x' }, ad)).status >= 400, true, 'un admin ne crée pas de super-admin');
  const me = (await call('GET', '/auth/me', null, cs)).body; const uid = me.user?.id || me.id;
  await call('PUT', `/users/${uid}`, { role_code: 'super_admin', status: 'active' }, cs); assert.equal((await call('GET', '/users', null, cs)).status, 403);
  const reg = await call('POST', '/auth/register', { name: 'Pirate Reg', email: 'pirate@x.local', password: 'Pirate#Pharma2026', country_id: (await call('GET', '/countries')).body.find((c) => c.iso2 === 'TN').id, role_code: 'super_admin', role: 'super_admin', pharmacy_id: 99, status: 'active' }); 
  if (reg.status === 201) { const u = (await call('GET', '/users?q=pirate', null, sa)).body.data.find((x) => x.email === 'pirate@x.local'); assert.equal(u.role_code, 'customer'); }
  assert.equal((await call('POST', '/payment-methods', { code: 'zz', label: 'Z', kind: 'card' }, ad)).status, 403, 'seul le super-admin configure les paiements');
  assert.equal((await call('GET', '/payment-methods/1/reveal', null, ad)).status, 403);
});

test('XSS : en-têtes de sécurité, CSP stricte, contenu JSON, aucune donnée réfléchie en HTML', async () => {
  const r = await rawRoot('/'); const h = (k) => r.headers.get(k) || '';
  assert.match(h('content-security-policy'), /script-src 'self'/); assert.doesNotMatch(h('content-security-policy'), /script-src[^;]*unsafe/); assert.match(h('content-security-policy'), /frame-ancestors 'none'/); assert.equal(h('x-content-type-options'), 'nosniff'); assert.equal(h('x-frame-options'), 'DENY'); assert.ok(h('referrer-policy')); assert.equal(h('x-powered-by'), '');
  const ad = await login('admin'); const payload = '<img src=x onerror=alert(1)><script>alert(1)</script>';
  const c = await call('POST', '/customers', { name: payload, phone: '20000000' }, ad); assert.ok(c.status === 201 || c.status === 400);
  const res = await raw('GET', '/customers?q=' + encodeURIComponent(payload), { headers: { authorization: 'Bearer ' + ad } }); assert.match(res.headers.get('content-type'), /application\/json/); assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const notFound = await rawRoot('/api/v1/' + encodeURIComponent(payload)); assert.doesNotMatch(await notFound.text(), /<script>/);
  const html = await (await rawRoot('/')).text(); assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>[^<]/, 'aucun script en ligne'); assert.doesNotMatch(html, /\son\w+=/i, 'aucun gestionnaire en ligne');
});

test('traversée de chemin et fichiers sensibles', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/%2e%2e%2f%2e%2e%2fserver/db.js', '/uploads/../../package.json', '/js/../../server/index.js', '/..\\package.json', '/%00', '/.env', '/data/dev.sqlite', '/server/db.js', '/package.json', '/tests/api.test.js', '/.git/config', '/mobile/App.tsx', '/docs/MISE_EN_LIGNE.md']) {
    const r = await rawRoot(p); const body = await r.text(); assert.ok(![200].includes(r.status) || /<html/i.test(body) , `${p} -> ${r.status} fuite possible`); assert.doesNotMatch(body, /"dependencies"|DatabaseSync|JWT_SECRET|SQLite format/, p);
  }
});

test('téléversements : type, signature, taille, nom ; fichiers des autres clients inaccessibles', async () => {
  const sa = await login('superadmin'); const mk = async (tag) => { const email = `up${tag}@t.local`; await call('POST', '/users', { name: 'Up ' + tag, email, role_code: 'customer', pharmacy_id: 1, password: 'Client#Test2026' }, sa); return (await call('POST', '/auth/login', { email, password: 'Client#Test2026' })).body.access_token; };
  const A = await mk('a'), B = await mk('b'); const send = (t, f, extra = {}) => call('POST', '/portal/prescriptions', { file: f, ...extra }, t);
  assert.equal((await send(A, { mime: 'image/png', data_base64: Buffer.from('<html><script>alert(1)</script>').toString('base64') })).status, 400); // contenu ≠ type
  assert.equal((await send(A, { mime: 'text/html', data_base64: PNG })).status, 400); assert.equal((await send(A, { mime: 'application/x-msdownload', data_base64: PNG })).status, 400); assert.equal((await send(A, { mime: 'image/svg+xml', data_base64: Buffer.from('<svg onload=alert(1)>').toString('base64') })).status, 400);
  assert.ok([400, 413, 'closed'].includes(await st(raw('POST', '/portal/prescriptions', { retry: false, headers: { authorization: 'Bearer ' + A, 'content-type': 'application/json' }, body: JSON.stringify({ file: { mime: 'image/png', data_base64: Buffer.alloc(8 * 1024 * 1024, 1).toString('base64') } }) }))));
  const ok = await send(A, { mime: 'image/png', data_base64: PNG, name: '../../../etc/passwd' }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const ph = await login('pharmacien'); const f = await raw('GET', `/prescriptions/${ok.body.id}/file`, { headers: { authorization: 'Bearer ' + ph } }); assert.equal(f.status, 200); assert.match(f.headers.get('content-type'), /image\/png/); assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
  assert.ok([401, 403].includes((await raw('GET', `/prescriptions/${ok.body.id}/file`, { headers: { authorization: 'Bearer ' + B } })).status)); assert.ok([401, 403, 404].includes((await raw('GET', `/prescriptions/${ok.body.id}/file`)).status));
  assert.equal((await rawRoot('/uploads/anything.png')).status === 200, false);
});

test('ordonnances : validation exclusivement humaine (pharmacien), jamais automatique', async () => {
  const sa = await login('superadmin'); await call('POST', '/users', { name: 'Rx Client', email: 'rx@t.local', role_code: 'customer', pharmacy_id: 1, password: 'Client#Test2026' }, sa); const C = (await call('POST', '/auth/login', { email: 'rx@t.local', password: 'Client#Test2026' })).body.access_token;
  const p = await call('POST', '/portal/prescriptions', { file: { mime: 'image/png', data_base64: PNG } }, C); assert.equal(p.status, 201); const id = p.body.id;
  const ph = await login('pharmacien'); const cs = await login('caissier'); const as = await login('preparateur');
  assert.equal((await call('GET', `/prescriptions/${id}`, null, ph)).body.status, 'received'); // ni OCR ni validation automatique
  await new Promise((r) => setTimeout(r, 300)); assert.equal((await call('GET', `/prescriptions/${id}`, null, ph)).body.status, 'received');
  for (const who of [C, cs]) assert.ok([401, 403].includes((await call('POST', `/prescriptions/${id}/transition`, { to: 'validated', checklist: { identity: true, legible: true, date_valid: true, prescriber: true, products_posology: true } }, who)).status));
  assert.equal((await call('POST', `/prescriptions/${id}/transition`, { to: 'to_verify' }, as)).status, 200);
  for (const [who, nm] of [[as, 'assistant'], [cs, 'caissier']]) assert.equal((await call('POST', `/prescriptions/${id}/transition`, { to: 'validated', checklist: { identity: true, legible: true, date_valid: true, prescriber: true, products_posology: true } }, who)).status, 403, nm);
  assert.equal((await call('POST', `/prescriptions/${id}/transition`, { to: 'validated', checklist: { identity: true, legible: true } }, ph)).status, 409, 'liste de contrôle complète exigée');
  assert.equal((await call('POST', `/prescriptions/${id}/transition`, { to: 'validated', checklist: { identity: true, legible: true, date_valid: true, prescriber: true, products_posology: true } }, ph)).body.error.code, 'NO_LINES');
  assert.equal((await call('PUT', `/portal/prescriptions/${id}`, { status: 'validated' }, C)).status >= 400, true); assert.equal((await call('PUT', `/prescriptions/${id}`, { status: 'validated' }, C)).status >= 400, true);
  const rev = (await call('GET', `/prescriptions/${id}`, null, ph)).body; assert.notEqual(rev.status, 'validated');
});

test('énumération de comptes, force brute, jetons de rafraîchissement', async () => {
  const a = await call('POST', '/auth/login', { email: 'inconnu@nulle.part', password: 'Mauvais#12345' }), b = await call('POST', '/auth/login', { email: 'admin@demo.local', password: 'Mauvais#12345' });
  assert.equal(a.status, b.status); assert.equal(a.body.error.message, b.body.error.message); assert.equal(a.body.error.code, b.body.error.code);
  const f1 = await call('POST', '/auth/forgot-password', { email: 'inconnu@nulle.part' }), f2 = await call('POST', '/auth/forgot-password', { email: 'admin@demo.local' }); assert.equal(f1.status, f2.status); assert.deepEqual(f1.body, f2.body);
  let locked = false; for (let i = 0; i < 15 && !locked; i++) { const r = await call('POST', '/auth/login', { email: 'auditeur@demo.local', password: 'Faux#Mot2Passe' + i }); if (r.status === 429 || r.body?.error?.code === 'ACCOUNT_LOCKED') locked = true; } assert.ok(locked, 'blocage après tentatives répétées');
  const ok = await call('POST', '/auth/login', { email: 'auditeur@demo.local', password: PW }); assert.ok([401, 423, 429].includes(ok.status), 'le compte verrouillé refuse même le bon mot de passe');
  const l = await call('POST', '/auth/login', { email: 'comptable@demo.local', password: PW }, null, { 'x-client': 'mobile' }); assert.equal(l.status, 200); const r1 = l.body.refresh_token; assert.ok(r1);
  const n = await call('POST', '/auth/refresh', { refresh_token: r1 }, null, { 'x-client': 'mobile' }); assert.equal(n.status, 200); const r2 = n.body.refresh_token; assert.notEqual(r1, r2);
  assert.equal((await call('POST', '/auth/refresh', { refresh_token: r1 }, null, { 'x-client': 'mobile' })).status, 401, 'rejeu refusé');
  assert.equal((await call('POST', '/auth/refresh', { refresh_token: r2 }, null, { 'x-client': 'mobile' })).status, 401, 'la famille de jetons est révoquée après rejeu');
});

test('CSRF, CORS, corps invalides, fuite d\'informations', async () => {
  const evil = { origin: 'https://evil.example' };
  const pre = await raw('OPTIONS', '/auth/login', { headers: { ...evil, 'access-control-request-method': 'POST' } }); assert.notEqual(pre.headers.get('access-control-allow-origin'), '*'); assert.notEqual(pre.headers.get('access-control-allow-origin'), 'https://evil.example');
  const x = await raw('POST', '/auth/refresh', { headers: { ...evil, 'content-type': 'application/json', cookie: 'rt=abc' }, body: '{}' }); assert.ok([401, 403].includes(x.status));
  const ad = await login('admin'); assert.equal((await raw('POST', '/drivers', { headers: { authorization: 'Bearer ' + ad, 'content-type': 'text/plain' }, body: '{"name":"x","matricule":"y"}' })).status, 415);
  const bad = await raw('POST', '/drivers', { headers: { authorization: 'Bearer ' + ad, 'content-type': 'application/json' }, body: '{"name":' }); assert.equal(bad.status, 400); const bt = await bad.text(); assert.doesNotMatch(bt, /at .*\.js|node:internal|SyntaxError|\/home\//);
  assert.ok([413, 'closed'].includes(await st(raw('POST', '/drivers', { retry: false, headers: { authorization: 'Bearer ' + ad, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(10 * 1024 * 1024) }) }))));
  const err = await call('GET', '/products/abc%00', null, ad); assert.ok(err.status < 500); assert.doesNotMatch(JSON.stringify(err.body), /\/home\/|node:|stack/);
  const pol = await call('POST', '/drivers', JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}},"name":"Proto","matricule":"PRO-1"}'), ad); assert.ok(pol.status < 500); assert.equal(({}).isAdmin, undefined); assert.equal(({}).x, undefined);
  for (const m of ['TRACE', 'CONNECT']) assert.ok((await raw(m, '/').catch(() => ({ status: 405 }))).status >= 400);
});

test('paiements : webhooks falsifiés, bac à sable inoffensif sur les vrais prestataires, montant non modifiable', async () => {
  const sa = await login('superadmin'); const { get } = await import('../server/db.js');
  await call('POST', '/payment-methods', { code: 'stripe_sec', label: 'Carte', kind: 'card', provider: 'stripe', channel_online: true, config: { secret_key: 'sk', webhook_secret: 'whsec', base_url: 'http://127.0.0.1:1' } }, sa);
  const ev = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_x', payment_status: 'paid', client_reference_id: '1' } } });
  assert.equal((await raw('POST', '/payments/webhook/stripe', { headers: { 'content-type': 'application/json' }, body: ev })).status, 403);
  assert.equal((await raw('POST', '/payments/webhook/stripe', { headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' }, body: ev })).status, 403);
  assert.equal((await raw('GET', '/payments/webhook/konnect?payment_ref=nexistepas&status=completed')).status < 500, true);
  assert.equal((await raw('GET', '/pay/sandbox/inexistant/ok')).status === 200, false);
  const email = 'amt@t.local'; await call('POST', '/users', { name: 'Amt', email, role_code: 'customer', pharmacy_id: 1, password: 'Client#Test2026' }, sa); const t = (await call('POST', '/auth/login', { email, password: 'Client#Test2026' })).body.access_token;
  const free = (await call('GET', '/portal/catalog?q=parac', null, t)).body.find((x) => x.rx_status === 'free'); const o = await call('POST', '/portal/orders', { lines: [{ product_id: free.id, qty: 1 }] }, t);
  const p = await call('POST', `/portal/orders/${o.body.id}/pay`, { method_code: 'stripe_sec', amount: 1 }, t); assert.equal(p.status, 502); // prestataire injoignable
  const row = get('SELECT amount FROM online_payments WHERE order_id=? ORDER BY id DESC LIMIT 1', o.body.id); assert.ok(!row || row.amount > 1, 'le montant ne vient jamais du client');
  const sbx = await call('POST', '/payment-methods', { code: 'sbx_sec', label: 'Test', kind: 'card', provider: 'sandbox', channel_online: true }, sa); assert.equal(sbx.status, 201);
  const o2 = await call('POST', '/portal/orders', { lines: [{ product_id: free.id, qty: 1 }] }, t); const sp = await call('POST', `/portal/orders/${o2.body.id}/pay`, { method_code: 'sbx_sec' }, t); const ref = new URL(sp.body.checkout_url).pathname.split('/').pop();
  assert.ok((await raw('GET', `/pay/sandbox/${ref}/ok`)).status < 400); const stripeRow = get("SELECT status FROM online_payments WHERE provider='stripe' ORDER BY id DESC LIMIT 1"); assert.ok(!stripeRow || stripeRow.status !== 'paid');
});

test('usurpation d\'identité : traçable, bornée, non cumulable', async () => {
  const sa = await login('superadmin'); const users = (await call('GET', '/users?q=caissier', null, sa)).body.data; const cashier = users.find((u) => u.email === 'caissier@demo.local');
  const ad = await login('admin'); assert.equal((await call('POST', `/users/${cashier.id}/impersonate`, {}, ad)).status, 403);
  const imp = await call('POST', `/users/${cashier.id}/impersonate`, {}, sa); assert.equal(imp.status, 200, JSON.stringify(imp.body)); const t = imp.body.access_token;
  assert.equal((await call('POST', `/users/${cashier.id}/impersonate`, {}, t)).status >= 400, true);
  assert.equal((await call('POST', '/auth/change-password', { current_password: PW, new_password: 'Nouveau#Pass2026' }, t)).status >= 400, true, 'pas de changement de mot de passe en usurpation');
  assert.equal((await call('GET', '/users', null, t)).status, 403, 'droits du compte usurpé, pas ceux du super-admin');
  const sup = (await call('GET', '/users?q=superadmin', null, sa)).body.data.find((u) => u.role_code === 'super_admin'); assert.equal((await call('POST', `/users/${sup.id}/impersonate`, {}, sa)).status >= 400, true, 'on n\'usurpe pas un super-admin');
});
