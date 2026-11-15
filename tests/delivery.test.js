// Tests de l'administration complète des comptes par le super-administrateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-dlv-'));
process.env.DB_FILE = join(dir, 'test.sqlite'); process.env.UPLOAD_DIR = join(dir, 'uploads'); process.env.NODE_ENV = 'test';
if (process.env.DB_DRIVER === 'mariadb') process.env.MARIADB_DATABASE = 'gp_t_' + Math.random().toString(36).slice(2, 10);
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/seed.js'], { env: process.env, stdio: 'pipe' });
const { createApp } = await import('../server/index.js');
const { run } = await import('../server/db.js');

let server, base; const PW = 'Demo#Pharma2026'; const tokens = {};
before(async () => { server = createApp(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
after(async () => { server.close(); (await import('../server/db.js')).dropDatabase(); rmSync(dir, { recursive: true, force: true }); });
async function call(method, path, body, token, headers = {}) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await r.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
  return { status: r.status, body: json, raw: buf, headers: r.headers };
}
import http from 'node:http';
const PW2 = 'Client#Test2026';
async function login(who) { if (tokens[who]) return tokens[who]; const r = await call('POST', '/auth/login', { email: `${who}@demo.local`, password: PW }); assert.equal(r.status, 200); return (tokens[who] = r.body.access_token); }
async function customerWithOrder(tag) {
  const email = `liv${tag}@t.local`; assert.equal((await call('POST', '/users', { name: 'Client ' + tag, email, role_code: 'customer', pharmacy_id: 1, password: PW2 }, await login('superadmin'))).status, 201);
  const t = (await call('POST', '/auth/login', { email, password: PW2 })).body.access_token;
  const free = (await call('GET', '/portal/catalog?q=parac', null, t)).body.find((x) => x.rx_status === 'free');
  const o = await call('POST', '/portal/orders', { lines: [{ product_id: free.id, qty: 1 }] }, t); assert.equal(o.status, 201);
  const adm = await login('admin');
  if (!globalThis.__availDrv) { // une demande de livraison exige au moins un chauffeur disponible dans le secteur
    const r = await call('POST', '/drivers', { name: 'Chauffeur dispo', matricule: 'AV-1', phone: '98 000 777', vehicle_type: 'moto', account: { email: 'avail1@t.local', password: PW2 } }, adm); assert.equal(r.status, 201, JSON.stringify(r.body));
    const dt = (await call('POST', '/auth/login', { email: 'avail1@t.local', password: PW2 })).body.access_token; assert.equal((await call('PUT', '/driver/me', { availability: 'available' }, dt)).status, 200); globalThis.__availDrv = true; }
  for (const st of ['confirmed', 'preparing']) assert.equal((await call('POST', `/orders/${o.body.id}/status`, { status: st }, adm)).status, 200); return { t, id: o.body.id };
}
function sse(token) { // lit le flux temps réel
  return new Promise((resolve) => { const got = []; const req = http.get(base + '/events', { headers: { authorization: 'Bearer ' + token } }, (res) => { res.on('data', (c) => got.push(String(c))); resolve({ got, close: () => req.destroy() }); }); });
}

test('livraison : parcours complet avec chauffeur, matricule, et temps réel côté client uniquement', async () => {
  const ph = await login('pharmacien'); const A = await customerWithOrder('a'), B = await customerWithOrder('b');
  const drv = await call('POST', '/drivers', { name: 'Karim Ben Salah', matricule: 'CH-0042', phone: '20123456', vehicle: 'Kangoo 123 TUN 4567' }, await login('admin')); assert.equal(drv.status, 201);
  assert.equal((await call('POST', '/drivers', { name: 'Autre', matricule: 'CH-0042' }, await login('admin'))).status, 409);
  assert.equal((await call('POST', '/drivers', { name: 'X', matricule: 'Z1' }, A.t)).status, 403);
  const sa = await sse(A.t), sb = await sse(B.t), ss = await sse(ph); await new Promise((r) => setTimeout(r, 150));
  const d = await call('POST', `/portal/orders/${A.id}/delivery`, { address: '12 rue de la Liberté, Tunis', phone: '20111222' }, A.t); assert.equal(d.status, 201, JSON.stringify(d.body)); assert.equal(d.body.status, 'issued'); assert.match(d.body.number, /^LIV/);
  assert.equal((await call('POST', `/portal/orders/${A.id}/delivery`, { address: '12 rue de la Liberté' }, A.t)).status, 409);
  assert.equal((await call('POST', `/portal/orders/${A.id}/delivery`, { address: '12 rue de la Liberté' }, B.t)).status, 404); // pas la commande d'un autre
  const id = d.body.id; const st = (status, extra = {}) => call('POST', `/deliveries/${id}/status`, { status, ...extra }, ph);
  assert.equal((await st('delivered')).status, 409); assert.equal((await st('in_progress')).status, 409); // saut d'étape interdit
  assert.equal((await st('received')).status, 200);
  assert.equal((await st('in_progress')).body.error.code, 'DRIVER_REQUIRED');
  assert.equal((await st('in_progress', { driver_id: drv.body.id })).status, 200);
  assert.equal((await call('POST', `/portal/deliveries/${id}/cancel`, {}, A.t)).status, 409); // trop tard
  const mid = await call('GET', `/portal/deliveries/${id}`, null, A.t); assert.equal(mid.body.driver.name, 'Karim Ben Salah'); assert.equal(mid.body.driver.matricule, 'CH-0042'); assert.equal(mid.body.status, 'in_progress');
  assert.equal((await call('GET', `/portal/deliveries/${id}`, null, B.t)).status, 404); // IDOR
  assert.equal((await st('delivered')).status, 200);
  const fin = await call('GET', '/portal/deliveries', null, A.t); assert.deepEqual(fin.body[0].events.map((e) => e.status), ['issued', 'received', 'in_progress', 'delivered']); assert.equal(fin.body[0].events[2].driver_matricule, 'CH-0042');
  assert.equal((await call('GET', '/portal/deliveries', null, B.t)).body.length, 0);
  const dd = await call('DELETE', `/drivers/${drv.body.id}`, null, await login('admin')); assert.equal(dd.body.mode, 'trashed', JSON.stringify(dd)); // corbeille (réversible)
  const tr = (await call('GET', '/trash?entity=driver', null, ph)).body.items.find((x) => x.entity_id === drv.body.id); assert.ok(tr);
  assert.equal((await call('DELETE', '/trash/' + tr.id, null, ph)).body.mode, 'archived'); // déjà utilisé : conservé pour l\'historique
  await new Promise((r) => setTimeout(r, 200)); sa.close(); sb.close(); ss.close();
  const ga = sa.got.join(''), gb = sb.got.join(''), gs = ss.got.join('');
  assert.match(ga, /event: delivery/); assert.match(ga, /"status":"delivered"/); assert.equal(gb.includes('event: delivery'), false, 'un autre client ne doit rien recevoir'); assert.match(gs, /event: delivery/);
  assert.match(ga, /event: notification/); assert.match(ga, /matricule CH-0042/);
});

test('livraison : annulation client tant que non partie ; échec exige un motif ; client sans droit back-office', async () => {
  const ph = await login('pharmacien'); const C = await customerWithOrder('c');
  const d = await call('POST', `/portal/orders/${C.id}/delivery`, { address: 'Avenue Habib Bourguiba, Sfax' }, C.t); assert.equal(d.status, 201);
  assert.equal((await call('GET', '/deliveries', null, C.t)).status, 403); assert.equal((await call('GET', '/drivers', null, C.t)).status, 403);
  assert.equal((await call('POST', `/portal/deliveries/${d.body.id}/cancel`, {}, C.t)).status, 200);
  assert.equal((await call('POST', `/deliveries/${d.body.id}/status`, { status: 'received' }, ph)).status, 409);
  const D = await customerWithOrder('d'); const d2 = await call('POST', `/orders/${D.id}/delivery`, { address: 'Rue du Lac, Tunis', phone: '98 123 456' }, ph); assert.equal(d2.status, 201); // saisie par le personnel
  const drv = await call('POST', '/drivers', { name: 'Sami', matricule: 'CH-7' }, await login('admin'));
  await call('POST', `/deliveries/${d2.body.id}/status`, { status: 'received' }, ph); await call('POST', `/deliveries/${d2.body.id}/status`, { status: 'in_progress', driver_id: drv.body.id }, ph);
  assert.equal((await call('POST', `/deliveries/${d2.body.id}/status`, { status: 'failed' }, ph)).status, 400);
  assert.equal((await call('POST', `/deliveries/${d2.body.id}/status`, { status: 'failed', note: 'Client absent' }, ph)).status, 200);
  assert.equal((await call('GET', `/portal/deliveries/${d2.body.id}`, null, D.t)).body.failure_reason, 'Client absent');
});

test('préférences personnelles synchronisées : validées, isolées par utilisateur', async () => {
  const A = await customerWithOrder('p1'), B = await customerWithOrder('p2');
  assert.equal((await call('PUT', '/me/preferences', { mode: 'dark', accent: '#aa3300', home_widgets: ['deliveries', 'orders'], notify: { email: true, sms: false } }, A.t)).status, 200);
  assert.equal((await call('GET', '/me/preferences', null, A.t)).body.mode, 'dark'); assert.deepEqual((await call('GET', '/me/preferences', null, B.t)).body, {});
  for (const bad of [{ mode: 'neon' }, { accent: 'red' }, { home_widgets: ['admin'] }, { evil: 1 }, { font: 500 }]) assert.equal((await call('PUT', '/me/preferences', bad, A.t)).status, 400, JSON.stringify(bad));
  assert.equal((await call('PUT', '/me/preferences', JSON.parse('{"__proto__":{"admin":true},"mode":"light"}'), A.t)).status, 200); assert.equal(({}).admin, undefined);
  assert.equal((await call('POST', '/me/push-token', { token: 'nimporte' }, A.t)).status, 400);
  assert.equal((await call('POST', '/me/push-token', { token: 'ExponentPushToken[abcdefghijklmnop123]', platform: 'android' }, A.t)).status, 200);
});

test('push mobile : envoyé aux jetons du client (Expo simulé), jeton périmé supprimé, désactivable', async () => {
  const got = []; const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push(JSON.parse(b)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: JSON.parse(b).map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })) })); }); });
  await new Promise((r) => srv.listen(0, r)); process.env.PUSH_ENABLED = '1'; process.env.EXPO_PUSH_URL = `http://127.0.0.1:${srv.address().port}`;
  const ph = await login('pharmacien'); const E = await customerWithOrder('push1');
  await call('POST', '/me/push-token', { token: 'ExponentPushToken[pushtokenaaaaaaaaaa1]', platform: 'ios' }, E.t);
  const d = await call('POST', `/portal/orders/${E.id}/delivery`, { address: '5 avenue Test, Sousse' }, E.t); await call('POST', `/deliveries/${d.body.id}/status`, { status: 'received' }, ph);
  await new Promise((r) => setTimeout(r, 400)); assert.ok(got.length >= 1); assert.match(JSON.stringify(got), /pushtokenaaaaaaaaaa1/); assert.match(JSON.stringify(got), /Commande reçue/);
  const { get } = await import('../server/db.js'); assert.ok(!get("SELECT 1 x FROM push_tokens WHERE token='ExponentPushToken[pushtokenaaaaaaaaaa1]'")); // DeviceNotRegistered => retiré
  await call('POST', '/me/push-token', { token: 'ExponentPushToken[pushtokenbbbbbbbbbb2]' }, E.t); await call('PUT', '/me/preferences', { notify: { push: false } }, E.t); const n = got.length;
  await call('POST', `/deliveries/${d.body.id}/status`, { status: 'in_progress', driver_id: (await call('POST', '/drivers', { name: 'P', matricule: 'PP-1' }, await login('admin'))).body.id }, ph); await new Promise((r) => setTimeout(r, 300)); assert.equal(got.length, n, 'push désactivé par le client');
  srv.closeAllConnections(); srv.close(); delete process.env.PUSH_ENABLED;
});
