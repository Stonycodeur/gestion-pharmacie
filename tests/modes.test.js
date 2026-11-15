// Tests : 4 modes de livraison (tarifs réglables, distance max, programmée, négociation encadrée), bouton conditionné, rappel.
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

test('modes de livraison : conditions de la demande, 4 tarifs, distance max, programmée, négociation encadrée, rappel', async () => {
  const adm = await login('admin'), sa = await login('superadmin'); run('UPDATE pharmacies SET lat=36.80, lng=10.18 WHERE id=1');
  // commande non encore « En préparation » : demande refusée
  const email = 'modes1@t.local'; assert.equal((await call('POST', '/users', { name: 'Client modes', email, role_code: 'customer', pharmacy_id: 1, password: PW2 }, sa)).status, 201);
  const ct = (await call('POST', '/auth/login', { email, password: PW2 })).body.access_token; const free = (await call('GET', '/portal/catalog?q=parac', null, ct)).body.find((x) => x.rx_status === 'free');
  const o0 = (await call('POST', '/portal/orders', { lines: [{ product_id: free.id, qty: 1 }] }, ct)).body;
  const early = await call('POST', `/portal/orders/${o0.id}/delivery`, { address: '12 rue des Oliviers, Tunis' }, ct); assert.equal(early.status, 409); assert.match(early.body.error.message, /En préparation/);
  assert.equal((await call('GET', `/portal/orders/${o0.id}/delivery-quote`, null, ct)).body.eligible, false);
  for (const st of ['confirmed', 'preparing']) await call('POST', `/orders/${o0.id}/status`, { status: st }, adm);
  // en préparation mais aucun chauffeur disponible : bouton masqué (eligible=false) et demande refusée
  let q = (await call('GET', `/portal/orders/${o0.id}/delivery-quote?lat=36.85&lng=10.25`, null, ct)).body; assert.equal(q.eligible, false); assert.match(q.reason, /chauffeur/);
  assert.equal((await call('GET', '/portal/orders', null, ct)).body.find((o) => o.id === o0.id).drivers_available, 0);
  assert.equal((await call('POST', `/portal/orders/${o0.id}/delivery`, { address: '12 rue des Oliviers, Tunis', lat: 36.85, lng: 10.25 }, ct)).body.error.code, 'NO_DRIVER');
  const d1 = await mkDriver(adm, '1'); await call('PUT', '/driver/me', { availability: 'available' }, d1.t);
  q = (await call('GET', `/portal/orders/${o0.id}/delivery-quote?lat=36.85&lng=10.25`, null, ct)).body; assert.equal(q.eligible, true); assert.equal(q.drivers.length, 1); assert.equal(q.modes.length, 4);
  const P = Object.fromEntries(q.modes.map((m) => [m.mode, m])); assert.ok(P.economy.price < P.standard.price && P.standard.price < P.express.price && P.economy.eta_max > P.standard.eta_max && P.standard.eta_max > P.express.eta_max, JSON.stringify(q.modes));
  assert.ok(q.drivers[0].to_pharmacy_m === null || q.drivers[0].to_pharmacy_min >= 1);
  // réglages de l'administration : coût au km, majoration express, distance max, négociation
  const cfg = (await call('GET', '/delivery-config', null, adm)).body; assert.ok(cfg.per_km >= 0 && cfg.max_km === 30);
  const put = await call('PUT', '/delivery-config', { per_km: cfg.per_km * 2, express_pct: 50, max_km: 40, negotiation: true, margin_pct: 20, base: { economy: cfg.base.economy } }, adm); assert.equal(put.status, 200); assert.equal(put.body.express_pct, 50);
  const q2 = (await call('GET', `/portal/orders/${o0.id}/delivery-quote?lat=36.85&lng=10.25`, null, ct)).body; assert.ok(q2.modes.find((m) => m.mode === 'express').price > P.express.price);
  assert.equal((await call('PUT', '/delivery-config', { max_km: 3 }, adm)).status, 200); const far = await call('GET', `/portal/orders/${o0.id}/delivery-quote?lat=36.85&lng=10.25`, null, ct); assert.equal(far.body.too_far, true); assert.equal(far.body.eligible, true);
  assert.equal((await call('POST', `/portal/orders/${o0.id}/delivery`, { address: '12 rue des Oliviers, Tunis', lat: 36.85, lng: 10.25 }, ct)).body.error.code, 'TOO_FAR');
  assert.equal((await call('PUT', '/delivery-config', { max_km: 40 }, adm)).status, 200);
  // programmée : date obligatoire, dans le futur
  const bad1 = await call('POST', `/portal/orders/${o0.id}/delivery`, { address: '12 rue des Oliviers, Tunis', lat: 36.85, lng: 10.25, mode: 'scheduled' }, ct); assert.equal(bad1.status, 400);
  assert.equal((await call('POST', `/portal/orders/${o0.id}/delivery`, { address: '12 rue des Oliviers, Tunis', lat: 36.85, lng: 10.25, mode: 'scheduled', scheduled_at: new Date(Date.now() - 3600000).toISOString() }, ct)).status, 400);
  const when = new Date(Date.now() + 40 * 60000).toISOString();
  const ok = await call('POST', `/portal/orders/${o0.id}/delivery`, { address: '12 rue des Oliviers, Tunis', phone: '98123456', lat: 36.85, lng: 10.25, mode: 'scheduled', scheduled_at: when }, ct); assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.mode, 'scheduled'); assert.ok(ok.body.scheduled_at);
  assert.equal(ok.body.fee, q2.modes.find((m) => m.mode === 'scheduled').price);
  // négociation encadrée : hors marge refusée, dans la marge acceptée, désactivable
  const offer = (await call('GET', '/driver/offers', null, d1.t)).body.data.find((x) => x.id === ok.body.id);
  const out = await call('POST', `/driver/offers/${ok.body.id}/accept`, { price: offer.price * 3 }, d1.t); assert.equal(out.status, 400); assert.equal(out.body.error.code, 'PRICE_RANGE'); assert.doesNotMatch(out.body.error.message, /entre 0 et/);
  assert.equal((await call('PUT', '/delivery-config', { negotiation: false }, adm)).status, 200);
  assert.equal((await call('POST', `/driver/offers/${ok.body.id}/accept`, { price: Math.round(offer.price * 1.1) }, d1.t)).status, 403);
  assert.equal((await call('PUT', '/delivery-config', { negotiation: true }, adm)).status, 200);
  assert.equal((await call('POST', `/driver/offers/${ok.body.id}/accept`, { price: Math.round(offer.price * 1.1) }, d1.t)).body.counter, true);
  // rappel automatique une heure avant (client, pharmacie, chauffeur)
  const { remindScheduled } = await import('../server/delivery_config.js'); const { notify } = await import('../server/http.js'); const { all } = await import('../server/db.js');
  const cnt = () => all("SELECT id FROM notifications WHERE title LIKE 'Rappel : livraison%'").length; remindScheduled(notify); const n1 = cnt(); assert.ok(n1 >= 2, 'rappels envoyés'); remindScheduled(notify); assert.equal(cnt(), n1, 'un seul rappel par livraison');
});

test('boutons distincts : « Prêt pour la livraison » (livraison demandée) et « Prêt » (sans livraison)', async () => {
  const adm = await login('admin'); run('UPDATE pharmacies SET lat=36.80, lng=10.18 WHERE id=1');
  const d2 = await mkDriver(adm, '2'); await call('PUT', '/driver/me', { availability: 'available' }, d2.t);
  const A = await customerOrder('rdyA'), B = await customerOrder('rdyB');
  assert.equal((await call('GET', '/orders/' + B.id, null, adm)).body.delivery_id, null);
  const dl = await call('POST', `/portal/orders/${A.id}/delivery`, { address: '3 rue Ibn Khaldoun, Tunis', phone: '98123456', lat: 36.84, lng: 10.22, driver_id: d2.id }, A.t); assert.equal(dl.status, 201, JSON.stringify(dl.body));
  assert.ok((await call('GET', '/orders/' + A.id, null, adm)).body.delivery_id);
  assert.equal((await call('POST', `/orders/${A.id}/status`, { status: 'ready' }, adm)).status, 200); assert.equal((await call('POST', `/orders/${B.id}/status`, { status: 'ready' }, adm)).status, 200);
  const v = (await call('GET', `/portal/deliveries/${dl.body.id}`, null, A.t)).body; assert.equal(v.status, 'received'); assert.ok(v.events.some((e) => /chauffeur en route vers la pharmacie/.test(e.note || '')));
  const notes = (rows) => (rows.data || rows).map((n) => n.title);
  assert.ok(notes((await call('GET', '/portal/notifications', null, A.t)).body).some((x) => /prête pour la livraison/.test(x)));
  assert.ok(notes((await call('GET', '/portal/notifications', null, B.t)).body).some((x) => /prête au retrait/.test(x)));
  assert.ok(notes((await call('GET', '/portal/notifications', null, d2.t)).body).some((x) => /Commande prête : rendez-vous/.test(x)));
});
