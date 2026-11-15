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

test('dispatch : course ouverte, contre-prix alerté, choix du client, produit récupéré, profils partagés, droits', async () => {
  const sa = await login('superadmin'), adm = await login('admin'), ph = await login('pharmacien');
  await call('PUT', '/pharmacies/1', { name: 'Pharmacie Centrale', lat: 36.8, lng: 10.18 }, sa);
  const mc = await call('GET', '/maps/config', null, null); assert.equal(mc.status, 200); assert.equal(mc.body.provider, 'osm'); assert.match(mc.body.tiles, /\{z\}/); // sans clé Google : OpenStreetMap par défaut
  assert.equal((await call('GET', '/maps/route?pts=abc', null, adm)).status, 400); assert.equal((await call('GET', '/maps/reverse?lat=999&lng=1', null, adm)).status, 400); assert.equal((await call('GET', '/maps/search?q=ab', null, adm)).body.data.length, 0);
  assert.equal((await call('GET', '/maps/search?q=tunis', null, null)).status, 401);
  const d1 = await mkDriver(adm, '1'), d2 = await mkDriver(adm, '2');
  // droits : un pharmacien (sans drivers.admin) ne crée ni ne modifie un chauffeur ; le chauffeur ne change pas ses tarifs
  assert.equal((await call('POST', '/drivers', { name: 'X', matricule: 'Z9' }, ph)).status, 403);
  assert.equal((await call('PUT', `/drivers/${d1.id}`, { base_fee: 1 }, ph)).status, 403);
  assert.equal((await call('PUT', '/driver/me', { per_km: 1 }, d1.t)).status, 403);
  for (const d of [d1, d2]) assert.equal((await call('PUT', '/driver/me', { availability: 'available' }, d.t)).status, 200);
  const C = await customerOrder('a');
  const dl = await call('POST', `/portal/orders/${C.id}/delivery`, { address: '12 rue des Oliviers, Tunis', lat: 36.85, lng: 10.25 }, C.t); assert.equal(dl.status, 201, JSON.stringify(dl.body));
  const id = dl.body.id;
  // les deux chauffeurs voient la course avec le prix calculé (base + km)
  const o1 = (await call('GET', '/driver/offers', null, d1.t)).body; assert.equal(o1.data.length, 1); assert.ok(o1.data[0].price > 1000 && o1.data[0].pharmacy_name);
  assert.equal((await call('GET', '/driver/offers', null, d2.t)).body.data.length, 1);
  // d2 propose son prix : alertes (pharmacie, admin, super-admin) + le client voit l'offre
  const c2 = await call('POST', `/driver/offers/${id}/accept`, { price: Math.round(o1.data[0].price * 1.4) }, d2.t); assert.equal(c2.status, 200, JSON.stringify(c2.body)); assert.equal(c2.body.counter, true);
  const notifs = async (t) => ((await call('GET', '/notifications', null, t)).body.data || (await call('GET', '/notifications', null, t)).body).map((n) => n.title).join('|');
  assert.match(await notifs(sa), /Prix modifié/); assert.match(await notifs(adm), /Prix modifié/);
  const off = (await call('GET', `/portal/deliveries/${id}/offers`, null, C.t)).body; assert.equal(off.offers.length, 1); assert.equal(off.offers[0].kind, 'counter'); assert.ok(off.available.length >= 1);
  // messagerie fermée tant que le chauffeur n'est pas parti
  assert.equal((await call('POST', `/portal/deliveries/${id}/messages`, { body: 'Bonjour' }, C.t)).status, 409);
  // d1 accepte au prix du tarif → affectation immédiate ; d2 ne peut plus accepter
  const a1 = await call('POST', `/driver/offers/${id}/accept`, {}, d1.t); assert.equal(a1.status, 200, JSON.stringify(a1.body)); assert.equal(a1.body.assigned, true);
  assert.equal((await call('POST', `/driver/offers/${id}/accept`, {}, d2.t)).status, 409);
  assert.equal((await call('GET', '/driver/offers', null, d2.t)).body.data.length, 0);
  // la pharmacie voit la course acceptée, sans pouvoir écrire dans la conversation
  assert.ok([404, 405].includes((await call('POST', `/deliveries/${id}/messages`, { body: 'x' }, ph)).status));
  // « produit récupéré » : le chauffeur enclenche le départ
  const pk = await call('POST', `/driver/deliveries/${id}/pickup`, {}, d1.t); assert.equal(pk.status, 200, JSON.stringify(pk.body));
  const tr = (await call('GET', `/portal/deliveries/${id}/parties`, null, C.t)).body; assert.equal(tr.delivery.status, 'in_progress'); assert.equal(tr.driver.name, 'Chauffeur 1'); assert.ok(tr.driver.phone);
  const dp = (await call('GET', `/driver/deliveries/${id}/parties`, null, d1.t)).body; assert.equal(dp.customer.name, 'Client a');
  // messagerie avec pièce jointe dans les deux sens ; la pharmacie lit seulement
  const m1 = await call('POST', `/portal/deliveries/${id}/messages`, { body: 'Voici mon digicode', file: { mime: 'image/png', name: 'porte.png', data_base64: PNG } }, C.t); assert.equal(m1.status, 201, JSON.stringify(m1.body));
  assert.equal((await call('POST', `/driver/deliveries/${id}/messages`, { body: 'Bien reçu' }, d1.t)).status, 201);
  const th = (await call('GET', `/deliveries/${id}/messages`, null, ph)).body; assert.equal(th.length, 2); assert.ok(th[0].has_file);
  assert.equal((await call('GET', `/delivery-files/message/${th[0].id}`, null, d1.t)).status, 200); assert.equal((await call('GET', `/delivery-files/message/${th[0].id}`, null, d2.t)).status, 404);
  // fin, notes et signalements avec pièce jointe dans les deux sens
  assert.equal((await call('POST', `/driver/deliveries/${id}/finish`, { result: 'delivered' }, d1.t)).status, 200);
  // livraison terminée : plus d'écriture dans aucun sens, plus de numéro de téléphone, l'historique reste lisible
  assert.equal((await call('POST', `/portal/deliveries/${id}/messages`, { body: 'Encore' }, C.t)).status, 409);
  assert.equal((await call('POST', `/driver/deliveries/${id}/messages`, { body: 'Encore' }, d1.t)).status, 409);
  const after = (await call('GET', `/portal/deliveries/${id}/parties`, null, C.t)).body; assert.equal(after.delivery.closed, true); assert.equal(after.driver.phone, null);
  assert.equal((await call('GET', `/driver/deliveries/${id}/parties`, null, d1.t)).body.customer.phone, null);
  assert.equal((await call('GET', `/portal/deliveries/${id}/messages`, null, C.t)).body.length, 2); assert.equal((await call('GET', `/driver/deliveries/${id}/messages`, null, d1.t)).body.length, 2);
  assert.equal((await call('POST', `/portal/deliveries/${id}/rate`, { stars: 5 }, C.t)).status, 200); assert.equal((await call('POST', `/driver/deliveries/${id}/rate`, { stars: 4 }, d1.t)).status, 200);
  assert.equal((await call('POST', `/portal/deliveries/${id}/report`, { reason: 'Retard', file: { mime: 'image/png', name: 'p.png', data_base64: PNG } }, C.t)).status, 201);
  assert.equal((await call('POST', `/driver/deliveries/${id}/report`, { reason: 'Client injoignable' }, d1.t)).status, 201);
});

test('dispatch : choix du chauffeur par le client, photo, pièce d\'identité réservée à l\'administration, affectation multi-pharmacies', async () => {
  const sa = await login('superadmin'), adm = await login('admin');
  const d3 = await mkDriver(adm, '3'); assert.equal((await call('PUT', '/driver/me', { availability: 'available' }, d3.t)).status, 200);
  const C = await customerOrder('b'); const dl = await call('POST', `/portal/orders/${C.id}/delivery`, { address: '5 avenue Habib Bourguiba', lat: 36.84, lng: 10.2 }, C.t); const id = dl.body.id;
  const off = (await call('GET', `/portal/deliveries/${id}/offers`, null, C.t)).body; const free = off.available.find((x) => x.driver.name === 'Chauffeur 3'); assert.ok(free);
  assert.equal((await call('POST', `/portal/deliveries/${id}/choose`, { driver_id: free.driver_id }, C.t)).status, 200);
  assert.equal((await call('GET', '/driver/deliveries', null, d3.t)).body.data.length, 1);
  // photo + pièce d'identité
  assert.equal((await call('PUT', '/driver/me/photo', { file: { mime: 'image/png', name: 'me.png', data_base64: PNG } }, d3.t)).status, 200);
  assert.ok((await call('GET', '/driver/me', null, d3.t)).body.photo_url);
  assert.equal((await call('PUT', '/driver/me/id-doc', { type: 'cni', number: 'AB123', file: { mime: 'image/png', name: 'cni.png', data_base64: PNG } }, d3.t)).status, 200);
  assert.equal((await call('GET', `/drivers/${d3.id}/id-doc`, null, adm)).status, 200); assert.equal((await call('GET', `/drivers/${d3.id}/id-doc`, null, await login('pharmacien'))).status, 403);
  assert.equal((await call('GET', `/drivers/${d3.id}/id-doc`, null, C.t)).status, 403);
  // affectation à plusieurs pharmacies avec lieu de départ choisi
  const ph2 = await call('POST', '/pharmacies', { name: 'Pharmacie Nord', city: 'Tunis', currency: 'TND', lat: 36.9, lng: 10.1 }, sa);
  assert.equal(ph2.status, 201, JSON.stringify(ph2.body)); {
    const r = await call('PUT', `/drivers/${d3.id}/pharmacies`, { pharmacies: [{ pharmacy_id: 1, depart_lat: 36.81, depart_lng: 10.17, depart_label: 'Dépôt' }, { pharmacy_id: ph2.body.id }] }, sa); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.pharmacies.length, 2);
    assert.equal((await call('PUT', `/drivers/${d3.id}/pharmacies`, { pharmacies: [{ pharmacy_id: ph2.body.id }] }, adm)).status, 403);
  }
});
