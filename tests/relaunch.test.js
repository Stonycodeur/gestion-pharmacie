// Tests du dispatch des courses : offres, contre-prix, choix du chauffeur, produit récupéré, profils partagés, droits.
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
  const o = await call('POST', '/portal/orders', { lines: [{ product_id: free.id, qty: 1 }] }, t); assert.equal(o.status, 201);
  const adm = await login('admin'); for (const st of ['confirmed', 'preparing']) assert.equal((await call('POST', `/orders/${o.body.id}/status`, { status: st }, adm)).status, 200); return { t, id: o.body.id };
}
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function mkDriver(adm, n, extra = {}) {
  const r = await call('POST', '/drivers', { name: 'Chauffeur ' + n, matricule: 'D-' + n, phone: '98 000 11' + n, vehicle_type: 'moto', base_fee: 1000, per_km: 400, speed_kmh: 30, account: { email: `drv${n}@t.local`, password: PW2 }, ...extra }, adm); assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = (await call('POST', '/auth/login', { email: `drv${n}@t.local`, password: PW2 })).body.access_token; return { id: r.body.id, t };
}


test('annulation de commande, relance (client → accord pharmacie, chauffeur → immédiat), démasquer, contre-prix décimal', async () => {
  const sa = await login('superadmin'), adm = await login('admin');
  await call('PUT', '/pharmacies/1', { name: 'Pharmacie Centrale', lat: 36.8, lng: 10.18 }, sa);
  const d1 = await mkDriver(adm, '1'); assert.equal((await call('PUT', '/driver/me', { availability: 'available' }, d1.t)).status, 200);
  // 1) commande sans livraison : annulable ; livraison émise : annulable et annule la livraison
  const A = await customerOrder('r1'); assert.equal((await call('POST', `/portal/orders/${A.id}/cancel`, { reason: 'Changé d\'avis' }, A.t)).status, 200);
  assert.equal((await call('POST', `/portal/orders/${A.id}/cancel`, {}, A.t)).status, 409);
  const B = await customerOrder('r2'); const dl = await call('POST', `/portal/orders/${B.id}/delivery`, { address: '12 rue des Oliviers, Tunis', phone: '98123456', lat: 36.85, lng: 10.25 }, B.t); assert.equal(dl.status, 201); const id = dl.body.id;
  // contre-prix : 25 unités majeures en minor units (pas de rejet « entre 0 et … »)
  const o = (await call('GET', '/driver/offers', null, d1.t)).body.data[0]; const dec = o.decimals;
  assert.equal((await call('POST', `/driver/offers/${id}/accept`, { price: Math.round(o.price * 1.4) }, d1.t)).status, 200);
  // démasquer : masquer retire, la liste « masquées » le contient, démasquer le remet
  const E = await customerOrder('r3'); const d3 = await call('POST', `/portal/orders/${E.id}/delivery`, { address: '5 avenue Habib Bourguiba, Tunis', lat: 36.8, lng: 10.2 }, E.t); assert.equal(d3.status, 201);
  assert.equal((await call('POST', `/driver/offers/${d3.body.id}/decline`, {}, d1.t)).status, 200);
  assert.ok(!(await call('GET', '/driver/offers', null, d1.t)).body.data.some((x) => x.id === d3.body.id)); assert.ok((await call('GET', '/driver/offers?hidden=1', null, d1.t)).body.data.some((x) => x.id === d3.body.id));
  assert.equal((await call('POST', `/driver/offers/${d3.body.id}/unhide`, {}, d1.t)).status, 200); assert.ok((await call('GET', '/driver/offers', null, d1.t)).body.data.some((x) => x.id === d3.body.id));
  // 2) le client annule sa livraison : relance interdite sans accord ; motif obligatoire ; la pharmacie autorise ; relance
  assert.equal((await call('POST', `/portal/deliveries/${d3.body.id}/cancel`, { reason: 'Erreur' }, E.t)).status, 200);
  assert.equal((await call('POST', `/portal/deliveries/${d3.body.id}/relaunch`, {}, E.t)).status, 400);
  assert.equal((await call('POST', `/portal/deliveries/${d3.body.id}/relaunch`, { reason: 'Je serai finalement chez moi' }, E.t)).status, 200);
  assert.equal((await call('POST', `/portal/deliveries/${d3.body.id}/relaunch`, { reason: 'encore une fois' }, E.t)).status, 409);
  const dv = (await call('GET', '/portal/deliveries', null, E.t)).body.find((x) => x.id === d3.body.id); assert.equal(dv.can_relaunch, false); assert.equal(dv.relaunch_status, 'requested');
  assert.equal((await call('POST', `/deliveries/${d3.body.id}/relaunch/approve`, {}, E.t)).status, 403);
  assert.equal((await call('POST', `/deliveries/${d3.body.id}/relaunch/approve`, {}, adm)).status, 200);
  assert.equal((await call('GET', '/portal/deliveries', null, E.t)).body.find((x) => x.id === d3.body.id).can_relaunch, true);
  assert.equal((await call('POST', `/portal/deliveries/${d3.body.id}/relaunch`, {}, E.t)).status, 200);
  assert.equal((await call('GET', '/portal/deliveries', null, E.t)).body.find((x) => x.id === d3.body.id).status, 'issued');
  // 3) le chauffeur se retire : le client relance tout de suite, sans accord
  assert.equal((await call('POST', `/driver/offers/${id}/accept`, {}, d1.t)).status, 200);
  assert.equal((await call('POST', `/driver/deliveries/${id}/cancel`, { reason: 'Panne de moto' }, d1.t)).status, 200);
  assert.equal((await call('GET', '/portal/deliveries', null, B.t)).body.find((x) => x.id === id).can_relaunch, true);
  assert.equal((await call('POST', `/portal/deliveries/${id}/relaunch`, {}, B.t)).status, 200);
  assert.ok((await call('GET', '/driver/offers', null, d1.t)).body.data.some((x) => x.id === id));
  // 4) en cours de livraison : plus d'annulation
  assert.equal((await call('POST', `/driver/offers/${id}/accept`, {}, d1.t)).status, 200); assert.equal((await call('POST', `/deliveries/${id}/status`, { status: 'in_progress', driver_id: d1.id }, adm)).status, 200);
  assert.equal((await call('POST', `/portal/orders/${B.id}/cancel`, {}, B.t)).status, 409);
});

test('contre-prix : le client voit, accepte ou refuse ; masquage invisible côté client ; code SMS de paiement', async () => {
  const adm = await login('admin'); const d1 = await mkDriver(adm, '2'); await call('PUT', '/driver/me', { availability: 'available' }, d1.t);
  const A = await customerOrder('c1'); const dl = await call('POST', `/portal/orders/${A.id}/delivery`, { address: '3 rue Ibn Khaldoun, Tunis', phone: '98123456', lat: 36.84, lng: 10.22 }, A.t); assert.equal(dl.status, 201); const id = dl.body.id;
  const o = (await call('GET', '/driver/offers', null, d1.t)).body.data.find((x) => x.id === id);
  assert.equal((await call('POST', `/driver/offers/${id}/accept`, { price: Math.round(o.price * 1.5) }, d1.t)).status, 200);
  const v = (await call('GET', '/portal/deliveries', null, A.t)).body.find((x) => x.id === id); assert.equal(v.counter_offers.length, 1); assert.equal(v.counter_offers[0].price, Math.round(o.price * 1.5));
  assert.equal((await call('POST', `/portal/deliveries/${id}/offers/${v.counter_offers[0].id}/refuse`, {}, A.t)).status, 200);
  assert.equal((await call('POST', `/driver/offers/${id}/accept`, { price: Math.round(o.price * 1.4) }, d1.t)).status, 409); // refusé : pas de relance du même prix
  const of = (await call('GET', `/portal/deliveries/${id}/offers`, null, A.t)).body; assert.ok(!of.available.some((x) => x.driver_id === d1.id));
  // masquage : invisible côté client
  const B = await customerOrder('c2'); const d2 = await call('POST', `/portal/orders/${B.id}/delivery`, { address: '8 rue de Marseille, Tunis', phone: '98123456', lat: 36.8, lng: 10.19 }, B.t);
  await call('POST', `/driver/offers/${d2.body.id}/decline`, {}, d1.t);
  assert.ok(!(await call('GET', `/portal/deliveries/${d2.body.id}/offers`, null, B.t)).body.available.some((x) => x.driver_id === d1.id));
  // prix de base mémorisé pour la pharmacie après acceptation du client
  const C = await customerOrder('c3'); const d3 = await call('POST', `/portal/orders/${C.id}/delivery`, { address: '1 av. de Carthage, Tunis', phone: '98123456', lat: 36.8, lng: 10.2 }, C.t);
  const oo = (await call('GET', '/driver/offers', null, d1.t)).body.data.find((x) => x.id === d3.body.id); await call('POST', `/driver/offers/${d3.body.id}/accept`, { price: Math.round(oo.price * 1.2) }, d1.t);
  const cv = (await call('GET', '/portal/deliveries', null, C.t)).body.find((x) => x.id === d3.body.id).counter_offers[0];
  assert.equal((await call('POST', `/portal/deliveries/${d3.body.id}/choose`, { driver_id: cv.driver_id }, C.t)).status, 200);
  const st = (await call('GET', '/deliveries', null, adm)).body.data.find((x) => x.id === d3.body.id); assert.equal(st.fee, Math.round(oo.price * 1.2)); assert.equal(st.standard_fee, oo.price);
});

test('paiement : code SMS à usage unique, durée réglable, mauvais code refusé', async () => {
  const sa = await login('superadmin'); const A = await customerOrder('otp1');
  const pm = (await call('GET', '/payment-methods?all=1', null, sa)).body.methods.find((m) => m.code === 'virement' || m.code === 'transfer') || (await call('GET', '/payment-methods?all=1', null, sa)).body.methods[0];
  assert.equal((await call('PUT', `/payment-methods/${pm.id}/settings`, { otp_required: true, otp_ttl: 60, fields: [{ name: 'tel', label: 'Numéro Airtel Money', type: 'tel', required: true }], currencies: '', countries: '' }, sa)).status, 200);
  await call('PUT', `/payment-methods/${pm.id}`, { channel_online: 1, enabled: 1 }, sa);
  const pay = (b) => call('POST', `/portal/orders/${A.id}/pay`, { method_code: pm.code, payer: { tel: '+21620123456' }, ...b }, A.t);
  assert.equal((await pay({})).status, 400); // pas de code
  const o = await call('POST', `/portal/orders/${A.id}/pay/otp`, { method_code: pm.code, payer: { tel: '+21620123456' } }, A.t); assert.equal(o.status, 200); assert.equal(o.body.ttl, 60); assert.match(o.body.dev_code, /^\d{6}$/);
  assert.equal((await pay({ otp: o.body.dev_code === '000000' ? '111111' : '000000' })).status, 400);
  { const r = await pay({ otp: o.body.dev_code }); assert.equal(r.status, 200); }
  assert.equal((await pay({ otp: o.body.dev_code })).status === 200, false); // usage unique
});

test('langues : liste publique, ajout d\'une langue par le super-admin seulement', async () => {
  const sa = await login('superadmin'), adm = await login('admin');
  assert.equal((await call('GET', '/i18n/languages', null, '')).status, 200);
  assert.equal((await call('PUT', '/i18n/pack/ln', { name: 'Lingála', strings: { Ventes: 'Mameko' } }, adm)).status, 403);
  assert.equal((await call('PUT', '/i18n/pack/ln', { name: 'Lingála', strings: { Ventes: 'Mameko', Prix: 'Talo' } }, sa)).status, 200);
  assert.ok((await call('GET', '/i18n/languages', null, '')).body.custom.some((l) => l.code === 'ln'));
  assert.equal((await call('GET', '/i18n/pack/ln', null, '')).body.strings.Prix, 'Talo');
  assert.equal((await call('PUT', '/i18n/pack/..%2Fx', { name: 'x', strings: {} }, sa)).status >= 400, true);
  assert.equal((await call('DELETE', '/i18n/pack/ln', null, sa)).status, 200);
});

test('gestionnaire de documents : dossiers, fichiers, partage, transfert, super-admin voit tout', async () => {
  const sa = await login('superadmin'), adm = await login('admin'), ph = await login('pharmacien');
  const f = await call('POST', '/fm/folders', { name: 'Factures 2026' }, adm); assert.equal(f.status, 201);
  const up = await call('POST', '/fm/files', { name: 'liste.csv', mime: 'text/csv', parent_id: f.body.id, data_base64: Buffer.from('a;b\n1;2\n').toString('base64') }, adm); assert.equal(up.status, 201);
  assert.equal((await call('POST', '/fm/files', { name: 'x.csv', mime: 'application/x-msdownload', data_base64: 'AAAA' }, adm)).status, 400);
  assert.equal((await call('GET', `/fm?parent=${f.body.id}`, null, ph)).status, 404); // pas de partage : introuvable
  const tg = (await call('GET', '/fm/targets', null, adm)).body; const pid = tg.users.find((u) => u.email === 'pharmacien@demo.local').id;
  assert.equal((await call('POST', `/fm/${f.body.id}/share`, { target_type: 'user', target_id: pid, can_edit: false }, adm)).status, 200);
  assert.equal((await call('GET', `/fm?parent=${f.body.id}`, null, ph)).body.data.length, 1);
  assert.equal((await call('GET', '/fm?view=shared', null, ph)).body.data[0].name, 'Factures 2026');
  assert.equal((await call('PUT', `/fm/${up.body.id}`, { name: 'x' }, ph)).status, 403); // lecture seule
  assert.equal((await call('POST', `/fm/${f.body.id}/share`, { target_type: 'user', target_id: pid, can_edit: true }, adm)).status, 200);
  assert.equal((await call('PUT', `/fm/${up.body.id}`, { name: 'liste-v2.csv' }, ph)).status, 200);
  assert.ok((await call('GET', '/fm?view=all', null, sa)).body.data.some((x) => x.name === 'Factures 2026')); // super-admin voit tout
  assert.equal((await call('POST', `/fm/${f.body.id}/transfer`, { user_id: pid }, adm)).status, 200);
  assert.equal((await call('DELETE', `/fm/${f.body.id}`, null, ph)).body.deleted, 2);
});
