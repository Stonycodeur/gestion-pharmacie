// Tests : pays (inscription, cloisonnement), devises du pays, modes de paiement par pharmacie, parcours livraison oui/non, notifications ciblées.
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
async function customerOrder(tag) {
  const email = `dsp${tag}@t.local`; const sa = await login('superadmin'); assert.equal((await call('POST', '/users', { name: 'Client ' + tag, email, role_code: 'customer', pharmacy_id: 1, password: PW2 }, sa)).status, 201);
  const t = (await call('POST', '/auth/login', { email, password: PW2 })).body.access_token; const free = (await call('GET', '/portal/catalog?q=parac', null, t)).body.find((x) => x.rx_status === 'free');
  const o = await call('POST', '/portal/orders', { lines: [{ product_id: free.id, qty: 1 }] }, t); assert.equal(o.status, 201); return { t, id: o.body.id };
}
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function mkDriver(adm, n, extra = {}) {
  const r = await call('POST', '/drivers', { name: 'Chauffeur ' + n, matricule: 'D-' + n, phone: '98 000 11' + n, vehicle_type: 'moto', base_fee: 1000, per_km: 400, speed_kmh: 30, account: { email: `drv${n}@t.local`, password: PW2 }, ...extra }, adm); assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = (await call('POST', '/auth/login', { email: `drv${n}@t.local`, password: PW2 })).body.access_token; return { id: r.body.id, t };
}


test('devises du pays obligatoires + modes de paiement créés automatiquement pour une nouvelle pharmacie', async () => {
  const sa = await login('superadmin'); const cs = (await call('GET', '/countries')).body; const ga = cs.find((c) => c.iso2 === 'GA'), tn = cs.find((c) => c.iso2 === 'TN');
  assert.ok(ga.currencies.includes('XAF'), 'le Gabon utilise le XAF');
  assert.equal((await call('POST', '/pharmacies', { name: 'Sans devise', country_id: ga.id }, sa)).status, 400);
  const foreign = await call('POST', '/pharmacies', { name: 'Mauvaise devise', country_id: ga.id, currencies: ['TND'] }, sa); assert.equal(foreign.status, 400); assert.match(foreign.body.error.message, /pas utilisée/);
  const g = await call('POST', '/pharmacies', { name: 'Pharmacie Libreville', country_id: ga.id, city: 'Libreville', currencies: ['XAF', 'USD'], currency_decimals: 0 }, sa); assert.equal(g.status, 201, JSON.stringify(g.body));
  const ph = (await call('GET', '/pharmacies', null, sa)).body.find((p) => p.id === g.body.id); assert.equal(ph.currency, 'XAF'); assert.equal(ph.currencies, 'XAF,USD');
  const pm = (await call('GET', `/pharmacy-payment-methods?pharmacy_id=${g.body.id}`, null, sa)).body;
  const cash = pm.find((m) => m.code === 'cash'); assert.ok(cash && cash.enabled && cash.at_counter && cash.on_delivery, 'espèces : caisse + livraison par défaut');
  assert.ok(pm.find((m) => m.code === 'cod').on_delivery && !pm.find((m) => m.code === 'cod').at_counter);
  assert.equal((await call('PUT', '/pharmacy-payment-methods/cash', { pharmacy_id: g.body.id, at_counter: false }, sa)).status, 200);
  assert.equal((await call('GET', `/pharmacy-payment-methods?pharmacy_id=${g.body.id}`, null, sa)).body.find((m) => m.code === 'cash').at_counter, 0);
  const t = (await call('POST', '/pharmacies', { name: 'Pharmacie Tunis 2', country_id: tn.id, currencies: ['TND'] }, sa)); assert.equal(t.status, 201);
  globalThis.__ga = ga; globalThis.__phGa = g.body.id;
});

test('inscription par pays : pays obligatoire, pharmacie requise dans le pays, cloisonnement des pharmacies et de la recherche', async () => {
  const sa = await login('superadmin'); const cs = (await call('GET', '/countries')).body; const ga = globalThis.__ga, tn = cs.find((c) => c.iso2 === 'TN'), jp = cs.find((c) => c.iso2 === 'JP');
  const body = (n, c) => ({ name: 'Cli ' + n, email: `cli${n}@t.local`, password: PW2, ...(c ? { country_id: c } : {}) });
  assert.equal((await call('POST', '/auth/register', body('a'))).status, 400);
  const none = await call('POST', '/auth/register', body('b', jp.id)); assert.equal(none.status, 400); assert.equal(none.body.error.code, 'NO_PHARMACY_IN_COUNTRY');
  assert.deepEqual((await call('GET', '/countries?with_pharmacy=1')).body.map((c) => c.iso2).sort(), ['GA', 'TN']);
  assert.equal((await call('POST', '/auth/register', body('c', tn.id))).status, 201); assert.equal((await call('POST', '/auth/register', body('d', ga.id))).status, 201);
  const lt = (await call('POST', '/auth/login', { email: 'clic@t.local', password: PW2 })).body.access_token, ld = (await call('POST', '/auth/login', { email: 'clid@t.local', password: PW2 })).body.access_token;
  const tnList = (await call('GET', '/portal/pharmacies', null, lt)).body, gaList = (await call('GET', '/portal/pharmacies', null, ld)).body;
  assert.ok(tnList.length >= 2 && tnList.every((p) => p.country.iso2 === 'TN')); assert.ok(gaList.length === 1 && gaList[0].country.iso2 === 'GA');
  // un client gabonais ne peut pas choisir une pharmacie tunisienne (en-tête x-pharmacy-id)
  assert.equal((await call('GET', '/portal/catalog', null, ld, { 'x-pharmacy-id': '1' })).status, 404);
  assert.equal((await call('GET', '/portal/catalog', null, ld, { 'x-pharmacy-id': String(globalThis.__phGa) })).status, 200);
  // le super-administrateur autorise « toutes les pharmacies » sur le profil du client
  const uid = (await call('GET', '/users?kind=customer&q=clid', null, sa)).body.data[0].id;
  assert.equal((await call('PUT', '/users/' + uid, { see_all_countries: true }, sa)).status, 200);
  assert.ok((await call('GET', '/portal/pharmacies', null, ld)).body.length >= 3);
  assert.equal((await call('GET', '/portal/catalog', null, ld, { 'x-pharmacy-id': '1' })).status, 200);
  assert.equal((await call('PUT', '/users/' + uid, { see_all_countries: true }, await login('admin'))).status, 403, 'seul le super-admin accorde ce droit');
});

test('paiement : livraison oui/non, modes par pharmacie, règlement à la caisse / à la livraison, notification ciblée', async () => {
  const sa = await login('superadmin'), adm = await login('admin'); const A = await customerOrder('p1');
  const q = (await call('GET', `/portal/orders/${A.id}/payment-options`, null, A.t)).body;
  assert.ok(q.modes.counter.some((m) => m.code === 'cash') && q.modes.delivery.some((m) => m.code === 'cash') && q.modes.delivery.some((m) => m.code === 'card'), JSON.stringify(q.modes));
  assert.ok(!q.modes.counter.some((m) => m.code === 'cod') && q.modes.delivery.some((m) => m.code === 'cod'));
  // « Non » → caisse : accepté ; mode non proposé à la caisse : refusé
  assert.equal((await call('POST', `/portal/orders/${A.id}/wants-delivery`, { value: false }, A.t)).status, 200);
  assert.equal((await call('POST', `/portal/orders/${A.id}/pay-later`, { mode: 'counter', method_code: 'cod' }, A.t)).status, 400);
  const ok = await call('POST', `/portal/orders/${A.id}/pay-later`, { mode: 'counter', method_code: 'cash' }, A.t); assert.equal(ok.status, 200); assert.match(ok.body.instructions, /caisse/);
  // la pharmacie retire « carte à la livraison » : le client ne la voit plus
  assert.equal((await call('PUT', '/pharmacy-payment-methods/card', { on_delivery: false }, adm)).status, 200);
  const q2 = (await call('GET', `/portal/orders/${A.id}/payment-options`, null, A.t)).body; assert.ok(!q2.modes.delivery.some((m) => m.code === 'card'));
  assert.equal((await call('POST', `/portal/orders/${A.id}/pay-later`, { mode: 'delivery', method_code: 'card' }, A.t)).status, 400);
  assert.equal((await call('POST', `/portal/orders/${A.id}/pay-later`, { mode: 'delivery', method_code: 'cod' }, A.t)).status, 200);
  // paiement en ligne : seulement les modes activés EN LIGNE pour cette pharmacie
  assert.equal((await call('POST', `/portal/orders/${A.id}/pay`, { method_code: 'cash' }, A.t)).status, 400);
  // notifications : un lien vers la page ET l'élément
  const ns = (await call('GET', '/notifications', null, adm)).body; const rows = ns.data || ns;
  assert.ok(rows.some((n) => n.link === `#/orders?id=${A.id}`), 'la nouvelle commande renvoie vers #/orders?id=…');
  assert.ok(rows.some((n) => /paiement à la (caisse|livraison)/.test(n.title) && n.link === `#/orders?id=${A.id}`));
});
