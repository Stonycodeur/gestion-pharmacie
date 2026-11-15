// Tests : commandes actuelles/passées, « Mes tarifs » chauffeur (4 modes), fuseaux par pays, statistiques de paiement.
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


test('statistiques de paiement (alias SQL non réservé) et commandes actuelles / passées', async () => {
  const adm = await login('admin'), sa = await login('superadmin');
  assert.equal((await call('GET', '/payments/stats', null, adm)).status, 200);
  assert.equal((await call('GET', '/payments/stats', null, sa)).status, 200);
  const o = await customerOrder('v1');
  const cur = await call('GET', '/orders?scope=current', null, adm), past = await call('GET', '/orders?scope=past', null, adm);
  assert.equal(cur.status, 200); assert.ok(cur.body.data.some((x) => x.id === o.id || x.number === o.number), 'commande en cours listée');
  assert.ok(cur.body.data.every((x) => ['pending', 'confirmed', 'preparing', 'ready'].includes(x.status)));
  assert.ok(past.body.data.every((x) => ['picked_up', 'cancelled', 'expired'].includes(x.status)));
  await call('POST', `/orders/${o.id}/status`, { status: 'cancelled' }, adm);
  const past2 = await call('GET', '/orders?scope=past', null, adm); assert.ok(past2.body.data.some((x) => x.id === o.id), 'annulée → passée');
});

test('Mes tarifs chauffeur = les 4 modes réglés par l\'administrateur', async () => {
  const adm = await login('admin'); const d = await mkDriver(adm, '7');
  await call('PUT', '/delivery-config', { base: { economy: 1200, standard: 1800, express: 3000, scheduled: 2200 }, per_km: 150, max_km: 12, express_pct: 10, margin_pct: 20 }, adm);
  const r = await call('GET', '/driver/tariffs', null, d.t); assert.equal(r.status, 200); assert.ok(r.body.length >= 1);
  const p = r.body[0]; assert.deepEqual(p.modes.map((m) => m.mode), ['economy', 'standard', 'express', 'scheduled']);
  assert.equal(p.modes.find((m) => m.mode === 'standard').price, 1800); assert.equal(p.per_km, 150); assert.equal(p.max_km, 12); assert.equal(p.margin_pct, 20);
});

test('fuseau horaire déduit du pays et de la position, plus de saisie manuelle', async () => {
  const sa = await login('superadmin'); const cs = (await call('GET', '/countries?all=1', null, sa)).body; const id = (c) => cs.find((x) => x.iso2 === c)?.id;
  const tn = await call('GET', `/countries/${id('TN')}/timezones`, null, sa); assert.deepEqual(tn.body.zones, ['Africa/Tunis']); assert.equal(tn.body.suggested, 'Africa/Tunis');
  const us = await call('GET', `/countries/${id('US')}/timezones?lat=34.05&lng=-118.24`, null, sa); assert.ok(us.body.zones.length > 5); assert.equal(us.body.suggested, 'America/Los_Angeles');
  const br = await call('GET', `/countries/${id('GA')}/timezones`, null, sa); assert.equal(br.body.suggested, 'Africa/Libreville');
  // création sans fuseau, ou avec un fuseau d'un autre pays : le serveur choisit celui du pays
  const mk = async (b) => { const r = await call('POST', '/pharmacies', { name: 'TZ ' + Math.random(), currency: 'XAF', currency_decimals: 0, country_id: id('GA'), ...b }, sa); assert.equal(r.status, 201, JSON.stringify(r.body)); return (await call('GET', '/pharmacies', null, sa)).body.find((p) => p.id === r.body.id).timezone; };
  assert.equal(await mk({}), 'Africa/Libreville'); assert.equal(await mk({ timezone: 'Africa/Tunis' }), 'Africa/Libreville');
});

test('livraison déjà demandée : plus de question « livré ? », total = commande + livraison, mis à jour avec la course', async () => {
  const adm = await login('admin'); const dr = await mkDriver(adm, '8'); await call('PUT', '/driver/me', { availability: 'available' }, dr.t); const o = await customerOrder('v2');
  const before = (await call('GET', `/portal/orders/${o.id}/payment-options`, null, o.t)).body; assert.equal(before.has_delivery, false); assert.equal(before.delivery_fee, 0); assert.equal(before.total, before.goods_total);
  assert.equal((await call('POST', `/portal/orders/${o.id}/pay-later`, { mode: 'delivery', method_code: 'cash' }, o.t)).status, 200); // déjà choisi « livré » → wants_delivery=1 sans course
  const d = await call('POST', `/portal/orders/${o.id}/delivery`, { address: '12 rue des Oliviers, Tunis', phone: '98123456', lat: 36.85, lng: 10.25 }, o.t); assert.equal(d.status, 201, JSON.stringify(d.body));
  const q = (await call('GET', `/portal/orders/${o.id}/payment-options`, null, o.t)).body;
  assert.equal(q.has_delivery, true); assert.equal(q.wants_delivery, 1); assert.equal(q.delivery_fee, d.body.fee); assert.ok(q.delivery_fee > 0); assert.equal(q.total, q.goods_total + q.delivery_fee); assert.equal(q.due, q.total);
  // retrait à la caisse impossible quand une course est enclenchée
  assert.equal((await call('POST', `/portal/orders/${o.id}/pay-later`, { mode: 'counter', method_code: 'cash' }, o.t)).body.error.code, 'DELIVERY_REQUESTED');
  const r = await call('POST', `/portal/orders/${o.id}/pay-later`, { mode: 'delivery', method_code: 'cash' }, o.t); assert.equal(r.body.amounts.total, q.total); assert.equal(r.body.amounts.delivery, q.delivery_fee);
  // contre-proposition acceptée → le total suit
  const { run } = await import('../server/db.js'); run('UPDATE deliveries SET fee=? WHERE id=?', d.body.fee + 300, d.body.id);
  assert.equal((await call('GET', `/portal/orders/${o.id}/payment-options`, null, o.t)).body.total, q.goods_total + d.body.fee + 300);
  // course annulée → on revient au total de la commande seule
  run("UPDATE deliveries SET status='cancelled' WHERE id=?", d.body.id);
  const z = (await call('GET', `/portal/orders/${o.id}/payment-options`, null, o.t)).body; assert.equal(z.has_delivery, false); assert.equal(z.total, z.goods_total);
});

test('historique complet d\'une commande : statuts, messages, paiements, livraison', async () => {
  const adm = await login('admin'); const dr = await mkDriver(adm, '9'); await call('PUT', '/driver/me', { availability: 'available' }, dr.t); const o = await customerOrder('v3');
  assert.equal((await call('PUT', `/portal/orders/${o.id}/message`, { notes: 'Merci de préparer vite' }, o.t)).status, 200);
  assert.equal((await call('POST', `/portal/orders/${o.id}/pay-later`, { mode: 'delivery', method_code: 'cash' }, o.t)).status, 200);
  const d = await call('POST', `/portal/orders/${o.id}/delivery`, { address: '12 rue des Oliviers, Tunis', phone: '98123456', lat: 36.85, lng: 10.25 }, o.t); assert.equal(d.status, 201);
  const r = await call('GET', `/portal/orders/${o.id}/timeline`, null, o.t); assert.equal(r.status, 200);
  const kinds = new Set(r.body.events.map((e) => e.kind)); for (const k of ['status', 'message', 'delivery']) assert.ok(kinds.has(k), 'type ' + k);
  assert.ok(r.body.events.some((e) => /En préparation/i.test(e.title)) && r.body.events.some((e) => e.detail === 'Merci de préparer vite') && r.body.events.some((e) => /Livraison .* demandée/.test(e.title)));
  assert.deepEqual(r.body.events.map((e) => e.at), [...r.body.events.map((e) => e.at)].sort(), 'ordre chronologique');
  // la commande d'un autre client reste invisible
  const o2 = await customerOrder('v4'); assert.equal((await call('GET', `/portal/orders/${o.id}/timeline`, null, o2.t)).status, 404);
  const l = (await call('GET', '/portal/orders', null, o.t)).body.find((x) => x.id === o.id); assert.ok(l.products && l.decimals !== undefined, 'produits + décimales pour la recherche/filtre');
});
