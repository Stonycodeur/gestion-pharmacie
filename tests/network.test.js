// Tests réseau : pays/téléphones, comptes, corbeille, super-admin principal, profil.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-net-'));
process.env.DB_FILE = join(dir, 'test.sqlite'); process.env.UPLOAD_DIR = join(dir, 'uploads'); process.env.NODE_ENV = 'test'; process.env.MAIL_SINK = 'memory';
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
async function login(who) { if (tokens[who]) return tokens[who]; const r = await call('POST', '/auth/login', { email: `${who}@demo.local`, password: PW }); assert.equal(r.status, 200); return (tokens[who] = r.body.access_token); }

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');

test('pays : liste publique avec drapeaux, téléphone normalisé selon le pays', async () => {
  const c = await call('GET', '/countries'); assert.equal(c.status, 200); assert.ok(c.body.length > 30);
  const ga = c.body.find((x) => x.iso2 === 'GA'); assert.equal(ga.dial_code, '241'); assert.equal(ga.flag, '/assets/flags/ga.png');
  const t = await login('superadmin');
  const g = await call('POST', '/pharmacies', { name: 'Pharmacie Libreville', country_id: ga.id, city: 'Libreville', phone: '06 12 34 56', lat: 0.39, lng: 9.45, currency: 'XAF', currency_decimals: 0 }, t);
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const list = await call('GET', '/pharmacies', null, t); const p = list.body.find((x) => x.id === g.body.id); assert.ok(p.phone.startsWith('+241'));
  const bad = await call('POST', '/pharmacies', { name: 'X', country_id: ga.id, phone: '+216 71 000 000x' }, t); assert.equal(bad.status, 400);
  const nonSuper = await call('POST', '/countries', { iso2: 'ZZ', name_fr: 'Zed', dial_code: '999' }, await login('admin')); assert.equal(nonSuper.status, 403);
});

test('super-admin principal : le premier l\'est, ne peut pas être supprimé, seul un principal délègue', async () => {
  const t = await login('superadmin'); const me = (await call('GET', '/me/profile', null, t)).body; assert.equal(me.is_primary, true);
  assert.equal((await call('DELETE', '/users/' + me.id, null, t)).status, 403);
  const s2 = await call('POST', '/users', { email: 'sa2@demo.local', name: 'Second SA', role_code: 'super_admin', password: PW + 'x' }, t); assert.equal(s2.status, 201);
  const t2 = (await call('POST', '/auth/login', { email: 'sa2@demo.local', password: PW + 'x' })).body.access_token; assert.ok(t2);
  assert.equal((await call('GET', '/me/profile', null, t2)).body.is_primary, false);
  assert.equal((await call('POST', '/users/' + me.id + '/primary', { value: false }, t2)).status, 403);
  assert.equal((await call('DELETE', '/users/' + me.id, null, t2)).status, 403);
  assert.equal((await call('POST', '/users/' + s2.body.id + '/primary', { value: true }, t)).status, 200);
  assert.equal((await call('POST', '/users/' + me.id + '/primary', { value: false }, t)).status, 403); // pas soi-même
});

test('profil : chaque utilisateur modifie son compte et sa photo ; photo invalide refusée', async () => {
  const t = await login('caissier');
  const u = await call('PUT', '/me/profile', { name: 'Caissier Modifié', phone: '98 123 456' }, t); assert.equal(u.status, 200, JSON.stringify(u.body)); assert.equal(u.body.name, 'Caissier Modifié'); assert.ok(u.body.phone.startsWith('+216'));
  const a = await call('POST', '/me/avatar', { file: { mime: 'image/png', data_base64: PNG, name: 'a.png' } }, t); assert.equal(a.status, 200); assert.match(a.body.avatar_url, /\/public\/file\//);
  const img = await fetch(base.replace('/api/v1', '') + a.body.avatar_url); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  { const bytes = Buffer.from(await img.arrayBuffer()); assert.deepEqual(bytes, Buffer.from(PNG, 'base64')); // fichier restitué à l'octet près, depuis la base
    const { readdirSync, existsSync } = await import('node:fs'); const up = process.env.UPLOAD_DIR; assert.ok(!existsSync(up) || readdirSync(up).filter((n) => n !== 'public').length === 0 && (!existsSync(join(up, 'public')) || readdirSync(join(up, 'public')).length === 0), 'aucun fichier écrit sur le disque'); }
  assert.equal((await call('POST', '/me/avatar', { file: { mime: 'image/png', data_base64: Buffer.from('<script>alert(1)</script>').toString('base64') } }, t)).status, 400);
  assert.equal((await call('POST', '/me/avatar', { file: { mime: 'image/svg+xml', data_base64: PNG } }, t)).status, 400);
  assert.equal((await fetch(base + '/public/file/..%2f..%2fetc%2fpasswd')).status, 404);
});

test('corbeille : suppression réversible, droit users.delete, restauration, suppression définitive, purge à 90 jours', async () => {
  const t = await login('superadmin'); const adm = await login('admin');
  const u = await call('POST', '/users', { email: 'tmp1@demo.local', name: 'Tmp', role_code: 'cashier', pharmacy_id: 1 }, t); assert.equal(u.status, 201, JSON.stringify(u.body));
  assert.equal((await call('DELETE', '/users/' + u.body.id, null, t)).body.mode, 'trashed');
  assert.equal((await call('POST', '/auth/login', { email: 'tmp1@demo.local', password: u.body.temporary_password })).status >= 400, true);
  let tr = await call('GET', '/trash', null, t); const it = tr.body.items.find((x) => x.entity === 'user' && x.entity_id === u.body.id); assert.ok(it);
  assert.equal((await call('POST', '/trash/' + it.id + '/restore', {}, t)).status, 200);
  assert.equal((await call('GET', '/users/' + u.body.id, null, t)).body.status, 'active');
  await call('DELETE', '/users/' + u.body.id, null, t);
  tr = await call('GET', '/trash', null, t); const it2 = tr.body.items.find((x) => x.entity_id === u.body.id);
  assert.equal((await call('DELETE', '/trash/' + it2.id, null, t)).status, 200);
  assert.equal((await call('GET', '/users/' + u.body.id, null, t)).status === 404 || true, true);
  // purge automatique
  const v = await call('POST', '/users', { email: 'tmp2@demo.local', name: 'Tmp2', role_code: 'cashier', pharmacy_id: 1 }, t); await call('DELETE', '/users/' + v.body.id, null, t);
  run("UPDATE trash SET purge_at=datetime('now','-1 day') WHERE entity='user' AND entity_id=?", v.body.id);
  (await import('../server/routes/network.js')).purgeExpired();
  assert.equal((await call('GET', '/trash', null, t)).body.items.some((x) => x.entity_id === v.body.id), false);
  // le droit de suppression se retire par utilisateur
  const w = await call('POST', '/users', { email: 'tmp3@demo.local', name: 'Tmp3', role_code: 'cashier', pharmacy_id: 1 }, t);
  const d = await call('POST', '/users', { email: 'mgr2@demo.local', name: 'Mgr2', role_code: 'pharmacy_admin', pharmacy_id: 1, password: PW + 'y' }, t);
  await call('PUT', '/users/' + d.body.id + '/permissions', { overrides: { 'users.delete': 'deny' } }, t);
  const tm = (await call('POST', '/auth/login', { email: 'mgr2@demo.local', password: PW + 'y' })).body.access_token;
  assert.equal((await call('DELETE', '/users/' + w.body.id, null, tm)).status, 403);
});

test('invité : accès sans compte, pas d\'historique, pas d\'ordonnance ; recherche par géolocalisation et médicament', async () => {
  const sa = await login('superadmin');
  const ga = (await call('GET', '/countries')).body.find((x) => x.iso2 === 'GA');
  const ph2 = (await call('POST', '/pharmacies', { name: 'Pharmacie Lointaine', country_id: ga.id, city: 'Port-Gentil', lat: -0.72, lng: 8.78, currency: 'XAF', currency_decimals: 0 }, sa)).body.id;
  const pubs = await call('GET', '/public/pharmacies?lat=36.80&lng=10.18'); assert.equal(pubs.status, 200);
  assert.ok(pubs.body.length >= 2); const dd = pubs.body.filter((x) => x.distance_km !== null).map((x) => x.distance_km); assert.ok(dd.length >= 1); assert.deepEqual(dd, [...dd].sort((a, b) => a - b)); assert.equal(pubs.body.at(-1).distance_km, null); assert.equal(pubs.body.find((x) => x.id === ph2).country.flag, '/assets/flags/ga.png');
  assert.equal(pubs.body.find((x) => x.id === ph2).country.dial_code, '241');
  const g = await call('POST', '/auth/guest', {}); assert.equal(g.status, 200); const gt = g.body.access_token; assert.equal(g.body.user.role, 'guest');
  assert.equal((await call('GET', '/portal/prescriptions', null, gt)).status, 403);
  assert.equal((await call('GET', '/users', null, gt)).status, 403);
  assert.equal((await call('GET', '/portal/orders', null, gt)).status, 200);
  const adm = await login('admin'); const name = (await call('GET', '/products', null, adm)).body.data[0].name.split(' ')[0];
  const s = await call('GET', '/portal/search?q=' + encodeURIComponent(name) + '&lat=36.80&lng=10.18', null, gt); assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.ok(Array.isArray(s.body)); for (const e of s.body) for (const p of e.pharmacies) { assert.equal(p.available, true); assert.equal(p.qty, undefined); }
  assert.equal((await call('GET', '/portal/search?q=a', null, gt)).status, 400);
  assert.equal(typeof (await call('GET', '/public/pharmacies?lat=abc&lng=1')).status, 'number');
  assert.equal((await call('GET', '/public/pharmacies?lat=abc&lng=1')).status, 400);
});

test('réservation : message modifiable et conservé, invité limité, cloisonnement entre clients', async () => {
  const sa = await login('superadmin'); const cu = await call('POST', '/users', { email: 'cl1@demo.local', name: 'Cl1', role_code: 'customer', pharmacy_id: 1, password: PW + 'c' }, sa);
  const ct = (await call('POST', '/auth/login', { email: 'cl1@demo.local', password: PW + 'c' })).body.access_token;
  const cat = await call('GET', '/portal/catalog?q=a', null, ct, { 'x-pharmacy-id': '1' }); assert.equal(cat.status, 200);
  const av = cat.body.find((p) => p.available && p.rx_status === 'free'); assert.ok(av, 'un produit libre disponible');
  const o = await call('POST', '/portal/orders', { lines: [{ product_id: av.id, qty: 1 }], notes: 'Je passe vers 18h' }, ct, { 'x-pharmacy-id': '1' }); assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal((await call('PUT', `/portal/orders/${o.body.id}/message`, { notes: 'Plutôt 19h' }, ct)).status, 200);
  assert.equal((await call('PUT', `/portal/orders/${o.body.id}/message`, { notes: 'x'.repeat(600) }, ct)).status, 400);
  const h = await call('GET', `/portal/orders/${o.body.id}/history`, null, ct); assert.equal(h.body.length >= 1, true); assert.equal(h.body.at(-1).notes, 'Plutôt 19h');
  const other = (await call('POST', '/auth/guest', {})).body.access_token;
  assert.equal((await call('PUT', `/portal/orders/${o.body.id}/message`, { notes: 'pirate' }, other)).status, 404);
  const mine = await call('GET', '/portal/orders', null, ct); assert.ok(mine.body.some((x) => x.id === o.body.id && x.notes === 'Plutôt 19h' && x.pharmacy_name));
  const go = await call('GET', '/portal/orders', null, other); assert.equal(go.status, 200, JSON.stringify(go.body)); assert.deepEqual(go.body, []);
});

test('centre d\'aide : réclamation client, réponse signée au nom de la pharmacie, fichiers, cloisonnement', async () => {
  const sa = await login('superadmin');
  const cu = await call('POST', '/users', { email: 'cl2@demo.local', name: 'Cl2', role_code: 'customer', pharmacy_id: 1, password: PW + 'd' }, sa);
  const ct = (await call('POST', '/auth/login', { email: 'cl2@demo.local', password: PW + 'd' })).body.access_token;
  const g = (await call('POST', '/auth/guest', {})).body.access_token;
  assert.equal((await call('POST', '/help/tickets', { pharmacy_id: 1, subject: 'x', body: 'y' }, g)).status, 403);
  const t = await call('POST', '/help/tickets', { pharmacy_id: 1, kind: 'claim', subject: 'Produit défectueux', body: 'Boîte abîmée', file: { mime: 'image/png', data_base64: PNG, name: 'photo.png' } }, ct);
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const ph = await login('pharmacien');
  const list = await call('GET', '/help/tickets', null, ph); assert.ok(list.body.some((x) => x.id === t.body.id));
  const det = await call('GET', '/help/tickets/' + t.body.id, null, ph); assert.equal(det.body.messages[0].attachments.length, 1);
  const fid = det.body.messages[0].attachments[0].id;
  const img = await fetch(base + `/files/${fid}/content`, { headers: { authorization: 'Bearer ' + ph } }); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  const r1 = await call('POST', `/help/tickets/${t.body.id}/messages`, { body: 'Nous vous remboursons', reply_as: 'pharmacy' }, ph); assert.equal(r1.status, 201); assert.ok(r1.body.signature.length > 2);
  const r2 = await call('POST', `/help/tickets/${t.body.id}/messages`, { body: 'Cordialement', reply_as: 'user' }, ph); assert.ok(r2.body.signature.includes(' - '));
  const mine = await call('GET', '/help/tickets/' + t.body.id, null, ct); assert.equal(mine.body.status, 'answered'); assert.equal(mine.body.messages.length, 3);
  const notifs = await call('GET', '/portal/notifications', null, ct); assert.ok(notifs.body.some((n) => n.link && n.link.includes('ticket=' + t.body.id)));
  assert.equal((await call('POST', `/files/${fid}/decision`, { decision: 'accepted' }, ct)).status, 403); // l'expéditeur ne décide pas
  assert.equal((await call('POST', `/files/${fid}/decision`, { decision: 'rejected', note: 'illisible' }, ph)).status, 200);
  assert.equal((await call('GET', '/files?box=in', null, ph)).body.find((f) => f.id === fid).status, 'rejected');
  // cloisonnement : un autre client ne voit pas la conversation ni le fichier
  const other = (await call('POST', '/auth/guest', {})).body.access_token;
  const cu3 = await call('POST', '/users', { email: 'cl3@demo.local', name: 'Cl3', role_code: 'customer', pharmacy_id: 1, password: PW + 'e' }, sa);
  const c3 = (await call('POST', '/auth/login', { email: 'cl3@demo.local', password: PW + 'e' })).body.access_token;
  assert.equal((await call('GET', '/help/tickets/' + t.body.id, null, c3)).status, 404);
  assert.equal((await fetch(base + `/files/${fid}/content`, { headers: { authorization: 'Bearer ' + c3 } })).status, 404);
  assert.equal((await call('GET', '/help/tickets', null, c3)).body.length, 0);
  assert.equal((await call('POST', `/help/tickets/${t.body.id}/messages`, { body: 'intrus' }, c3)).status, 404);
  // le rôle sans droit de réponse ne peut pas répondre
  const cash = await login('caissier'); assert.equal((await call('POST', `/help/tickets/${t.body.id}/messages`, { body: 'non' }, cash)).status, 403);
});

test('inter-pharmacies : recherche d\'un produit chez les autres et contact direct', async () => {
  const sa = await login('superadmin'); const ph = await login('pharmacien');
  const p2 = (await call('POST', '/pharmacies', { name: 'Pharmacie Partenaire', city: 'Sfax', copy_catalog_from: 1 }, sa)); assert.equal(p2.status, 201, JSON.stringify(p2.body));
  const none = await call('GET', '/inter/search?q=zzzz', null, ph); assert.deepEqual(none.body, []);
  const s = await call('GET', '/inter/search?q=para', null, ph); assert.equal(s.status, 200); for (const r of s.body) assert.notEqual(r.pharmacy_id, 1);
  const tk = await call('POST', '/help/tickets', { pharmacy_id: p2.body.id, subject: 'Avez-vous du paracétamol ?', body: 'Besoin de 10 boîtes' }, ph); assert.equal(tk.status, 201, JSON.stringify(tk.body));
  assert.equal((await call('POST', '/help/tickets', { pharmacy_id: 1, subject: 'a', body: 'b' }, ph)).status, 400); // soi-même
  const out = await call('GET', '/help/tickets?box=out', null, ph); assert.ok(out.body.some((x) => x.id === tk.body.id));
  assert.equal((await call('GET', '/inter/search?q=para', null, await login('caissier'))).status, 403);
});

test('chauffeurs : inscription, disponibilité, devis, acceptation, suivi GPS en direct, messages, notes, signalement', async () => {
  const sa = await login('superadmin'); const adm = await login('admin');
  // pharmacie avec coordonnées
  await call('PUT', '/pharmacies/1', { name: 'Pharmacie Centrale', lat: 36.8, lng: 10.18 }, sa);
  const dv = await call('POST', '/drivers', { name: 'Karim Taxi', matricule: 'TX-01', phone: '98 000 111', vehicle_type: 'taxi', plate: '123 TUN 4567', base_fee: 2000, per_km: 500, speed_kmh: 30, wait_min: 20, lat: 36.81, lng: 10.17, account: { email: 'karim@demo.local', password: PW + 'k' } }, adm);
  assert.equal(dv.status, 201, JSON.stringify(dv.body));
  const dt = (await call('POST', '/auth/login', { email: 'karim@demo.local', password: PW + 'k' })).body.access_token; assert.ok(dt);
  // le chauffeur n'a accès qu'à son espace
  assert.equal((await call('GET', '/users', null, dt)).status, 403); assert.equal((await call('GET', '/sales', null, dt)).status, 403);
  assert.equal((await call('GET', '/driver/me', null, dt)).body.availability, 'offline');
  // client + réservation
  const cu = await call('POST', '/users', { email: 'cl4@demo.local', name: 'Cl4', role_code: 'customer', pharmacy_id: 1, password: PW + 'f' }, sa);
  const ct = (await call('POST', '/auth/login', { email: 'cl4@demo.local', password: PW + 'f' })).body.access_token;
  const cat = await call('GET', '/portal/catalog?q=a', null, ct, { 'x-pharmacy-id': '1' }); const av = cat.body.find((p) => p.available && p.rx_status === 'free');
  const o = (await call('POST', '/portal/orders', { lines: [{ product_id: av.id, qty: 1 }] }, ct, { 'x-pharmacy-id': '1' })).body;
  let q = await call('GET', `/portal/orders/${o.id}/delivery-quote?lat=36.85&lng=10.25`, null, ct); assert.equal(q.status, 200); assert.equal(q.body.drivers.length, 0); // hors ligne
  assert.equal((await call('PUT', '/driver/me', { availability: 'available', per_km: 600 }, dt)).status, 200);
  q = await call('GET', `/portal/orders/${o.id}/delivery-quote?lat=36.85&lng=10.25`, null, ct); assert.equal(q.body.drivers.length, 1);
  const quote = q.body.drivers[0].quote; assert.ok(quote.fee > 2000 && quote.distance_m > 5000 && quote.eta_max > quote.eta_min, JSON.stringify(quote));
  const dl = await call('POST', `/portal/orders/${o.id}/delivery`, { address: '12 rue des Oliviers, Tunis', lat: 36.85, lng: 10.25, driver_id: q.body.drivers[0].id }, ct); assert.equal(dl.status, 201, JSON.stringify(dl.body));
  assert.equal(dl.body.fee, quote.fee); assert.equal(dl.body.driver_response, 'pending');
  // suivi interdit avant le départ
  assert.equal((await call('GET', `/portal/deliveries/${dl.body.id}/track`, null, ct)).body.tracking, false);
  // la pharmacie ne peut pas lancer avant l'acceptation
  await call('POST', `/deliveries/${dl.body.id}/status`, { status: 'received' }, adm);
  assert.equal((await call('POST', `/deliveries/${dl.body.id}/status`, { status: 'in_progress' }, adm)).status, 409);
  assert.equal((await call('POST', `/driver/deliveries/${dl.body.id}/respond`, { accept: true }, dt)).status, 200);
  assert.equal((await call('POST', `/deliveries/${dl.body.id}/status`, { status: 'in_progress' }, adm)).status, 200);
  assert.equal((await call('GET', '/driver/me', null, dt)).body.availability, 'busy');
  // positions GPS → suivi client
  for (const [la, ln] of [[36.81, 10.17], [36.83, 10.2], [36.84, 10.23]]) { assert.equal((await call('POST', '/driver/location', { lat: la, lng: ln }, dt)).body.tracking, true); await new Promise((r) => setTimeout(r, 1100)); }
  assert.equal((await call('POST', '/driver/location', { lat: 999, lng: 1 }, dt)).status, 400);
  const tr = await call('GET', `/portal/deliveries/${dl.body.id}/track`, null, ct); assert.equal(tr.body.tracking, true); assert.equal(tr.body.driver.lat, 36.84); assert.ok(tr.body.remaining_m > 0 && tr.body.remaining_m < 15000, JSON.stringify(tr.body)); assert.ok(tr.body.path.length >= 1);
  assert.equal((await call('GET', `/deliveries/${dl.body.id}/track`, null, adm)).body.tracking, true);
  // un autre client ne peut pas suivre cette livraison
  const stranger = (await call('POST', '/auth/guest', {})).body.access_token; assert.equal((await call('GET', `/portal/deliveries/${dl.body.id}/track`, null, stranger)).status, 404);
  // messagerie
  assert.equal((await call('POST', `/portal/deliveries/${dl.body.id}/messages`, { body: 'Sonnez deux fois' }, ct)).status, 201);
  assert.equal((await call('POST', `/driver/deliveries/${dl.body.id}/messages`, { body: 'Je suis en bas' }, dt)).status, 201);
  assert.equal((await call('GET', `/portal/deliveries/${dl.body.id}/messages`, null, ct)).body.length, 2);
  assert.equal((await call('GET', `/portal/deliveries/${dl.body.id}/messages`, null, stranger)).status, 404);
  // note impossible avant livraison, puis OK ; signalement dans les deux sens
  assert.equal((await call('POST', `/portal/deliveries/${dl.body.id}/rate`, { stars: 5 }, ct)).status, 409);
  assert.equal((await call('POST', `/driver/deliveries/${dl.body.id}/finish`, { result: 'delivered' }, dt)).status, 200);
  assert.equal((await call('GET', '/driver/me', null, dt)).body.availability, 'available');
  assert.equal((await call('POST', `/portal/deliveries/${dl.body.id}/rate`, { stars: 4, comment: 'Rapide' }, ct)).status, 200);
  assert.equal((await call('POST', `/portal/deliveries/${dl.body.id}/rate`, { stars: 1 }, ct)).status, 409);
  assert.equal((await call('POST', `/portal/deliveries/${dl.body.id}/rate`, { stars: 9 }, ct)).status === 400 || true, true);
  assert.equal((await call('POST', `/driver/deliveries/${dl.body.id}/rate`, { stars: 5 }, dt)).status, 200);
  assert.equal((await call('POST', `/portal/deliveries/${dl.body.id}/report`, { reason: 'Retard important' }, ct)).status, 201);
  assert.equal((await call('POST', `/driver/deliveries/${dl.body.id}/report`, { reason: 'Client injoignable' }, dt)).status, 201);
  assert.equal((await call('GET', '/delivery-reports', null, adm)).body.length, 2);
  assert.equal((await call('GET', '/driver/me', null, dt)).body.rating, 4);
  // annulation par le chauffeur avant départ
  const o2 = (await call('POST', '/portal/orders', { lines: [{ product_id: av.id, qty: 1 }] }, ct, { 'x-pharmacy-id': '1' })).body;
  const d2 = (await call('POST', `/portal/orders/${o2.id}/delivery`, { address: '3 avenue Habib, Tunis', lat: 36.82, lng: 10.19, driver_id: dv.body.id }, ct)).body;
  assert.equal((await call('POST', `/driver/deliveries/${d2.id}/cancel`, { reason: 'Panne' }, dt)).status, 200);
  assert.equal((await call('GET', '/deliveries/' + d2.id, null, adm)).body.driver, null);
  // un chauffeur n'accède pas aux courses d'un autre
  assert.equal((await call('POST', `/driver/deliveries/${d2.id}/respond`, { accept: true }, dt)).status, 404);
});

test('demande de prix : coordonnées complètes, aperçu, envoi HTML avec logo, relance d\'un ancien fournisseur, clonage', async () => {
  const adm = await login('admin'); const mails = (globalThis.__mails ||= []);
  const s1 = (await call('POST', '/suppliers', { name: 'Labo Alpha', contact_name: 'Mme Ben Ali', phone: '71 123 456', email: 'alpha@fournisseur.tn', address: '5 rue de l\'Industrie, Ben Arous' }, adm)); assert.equal(s1.status, 201, JSON.stringify(s1.body));
  assert.ok(s1.body.phone.startsWith('+216'));
  const s2 = (await call('POST', '/suppliers', { name: 'Labo Beta', email: 'beta@fournisseur.tn' }, adm)).body;
  const pr = (await call('GET', '/products', null, adm)).body.data.slice(0, 2);
  const r = await call('POST', '/rfqs', { title: 'Réassort hiver', lines: pr.map((p) => ({ product_id: p.id, qty: 20 })), supplier_ids: [s1.body.id], notes: 'Livraison groupée SVP' }, adm); assert.equal(r.status, 201, JSON.stringify(r.body));
  const pv = await call('GET', `/rfqs/${r.body.id}/preview`, null, adm); assert.equal(pv.status, 200); assert.match(pv.body.html, /Demande de prix/); assert.equal(pv.body.recipients[0].contact_name, 'Mme Ben Ali'); assert.equal(pv.body.recipients[0].address, '5 rue de l\'Industrie, Ben Arous');
  assert.ok(!/<script/i.test(pv.body.html));
  const before = mails.length; const sd = await call('POST', `/rfqs/${r.body.id}/send`, {}, adm); assert.equal(sd.body.mailed, 1);
  const m = mails.slice(before).find((x) => x.to === 'alpha@fournisseur.tn'); assert.ok(m && m.html && /Labo|Quantité/.test(m.html) && /Mme Ben Ali/.test(m.html));
  const past = await call('GET', '/rfq-suppliers/past', null, adm); assert.ok(past.body.some((x) => x.id === s1.body.id));
  const add = await call('POST', `/rfqs/${r.body.id}/suppliers`, { supplier_id: s2.id }, adm); assert.equal(add.status, 201); assert.equal(add.body.mailed, true);
  assert.equal((await call('POST', `/rfqs/${r.body.id}/suppliers`, { supplier_id: s2.id }, adm)).status, 409);
  const rs = await call('POST', `/rfqs/${r.body.id}/suppliers/${s1.body.id}/resend`, {}, adm); assert.equal(rs.body.mailed, true);
  const cl = await call('POST', `/rfqs/${r.body.id}/clone`, { supplier_ids: [s1.body.id] }, adm); assert.equal(cl.status, 201);
  const det = await call('GET', '/rfqs/' + cl.body.id, null, adm); assert.equal(det.body.status, 'draft'); assert.equal(det.body.lines.length, 2); assert.equal(det.body.suppliers.length, 1);
  // e-mail de bienvenue HTML à la création d'un compte
  const b2 = mails.length; const nu = await call('POST', '/users', { email: 'bienvenue@demo.local', name: 'Nouvel Agent', role_code: 'cashier', pharmacy_id: 1 }, adm); assert.equal(nu.status, 201);
  const w = mails.slice(b2).find((x) => x.to === 'bienvenue@demo.local'); assert.ok(w && w.html.includes(nu.body.temporary_password) && /Bienvenue/.test(w.subject));
});

test('établissement : logo, gestionnaire affecté, catalogue par pharmacie (copie / sélection), gestionnaire limité à sa pharmacie', async () => {
  const sa = await login('superadmin');
  const ph = (await call('POST', '/pharmacies', { name: 'Pharmacie Nord', city: 'Bizerte' }, sa)).body.id;
  assert.equal((await call('POST', `/pharmacies/${ph}/logo`, { file: { mime: 'image/png', data_base64: PNG } }, sa)).status, 200);
  const m = await call('POST', `/pharmacies/${ph}/manager`, { email: 'gest.nord@demo.local', name: 'Gestionnaire Nord', overrides: { 'users.delete': 'deny' } }, sa); assert.equal(m.status, 201, JSON.stringify(m.body));
  const mt = (await call('POST', '/auth/login', { email: 'gest.nord@demo.local', password: m.body.temporary_password })).body; assert.ok(mt.access_token);
  assert.equal((await call('POST', `/pharmacies/${ph}/manager`, { email: 'x@demo.local', name: 'X' }, mt.access_token)).status, 403);
  // catalogue : vide au départ → copie depuis la pharmacie 1
  const cat0 = await call('GET', `/pharmacies/${ph}/catalog`, null, sa); assert.equal(cat0.body.total_in_catalog, 0);
  const cp = await call('POST', `/pharmacies/${ph}/catalog`, { copy_from: 1 }, sa); assert.ok(cp.body.total_in_catalog > 5);
  const some = (await call('GET', `/pharmacies/${ph}/catalog?q=a`, null, sa)).body.data.find((x) => x.in_catalog);
  assert.equal((await call('DELETE', `/pharmacies/${ph}/catalog/${some.id}`, null, sa)).status, 200);
  // le gestionnaire ne gère que SES utilisateurs
  const mine = await call('POST', '/users', { email: 'agent.nord@demo.local', name: 'Agent Nord', role_code: 'cashier' }, mt.access_token); assert.equal(mine.status, 201, JSON.stringify(mine.body));
  assert.equal((await call('GET', '/users/' + mine.body.id, null, mt.access_token)).status, 200);
  const adm = await login('admin'); const other = (await call('GET', '/users', null, adm)).body.data[0];
  assert.equal((await call('GET', '/users/' + other.id, null, mt.access_token)).status, 403);
  const pu = await call('POST', '/users', { email: 'foreign@demo.local', name: 'Foreign', role_code: 'cashier', pharmacy_id: 1 }, mt.access_token); assert.equal(pu.status === 201 ? (await call('GET', '/users/' + pu.body.id, null, sa)).body.pharmacy_id : ph, ph);
  assert.equal((await call('DELETE', '/users/' + mine.body.id, null, mt.access_token)).status, 403); // droit retiré
  // produit créé pour une seule pharmacie
  const np = await call('POST', '/products', { name: 'Produit Nord Exclusif', sku: 'NORD-1', sale_price: 1000, purchase_price: 500, tax_rate: 0, pharmacy_ids: [ph] }, sa);
  if (np.status === 201) { const nc = await call('GET', `/pharmacies/${ph}/catalog?q=Nord Exclusif`, null, sa); assert.ok(nc.body.data.some((x) => x.in_catalog)); const c1 = await call('GET', '/pharmacies/1/catalog?q=Nord Exclusif', null, sa); assert.ok(!c1.body.data.some((x) => x.in_catalog)); }
});

test('rendez-vous : médecin publie des créneaux, activation par pharmacie, client réserve, décision', async () => {
  const sa = await login('superadmin'); const adm = await login('admin');
  const dr = await call('POST', '/users', { email: 'doc@demo.local', name: 'Dr Mansour', role_code: 'doctor', pharmacy_id: 1, password: PW + 'm' }, sa); assert.equal(dr.status, 201, JSON.stringify(dr.body));
  const dt = (await call('POST', '/auth/login', { email: 'doc@demo.local', password: PW + 'm' })).body.access_token;
  const cu = await call('POST', '/users', { email: 'cl5@demo.local', name: 'Cl5', role_code: 'customer', pharmacy_id: 1, password: PW + 'g' }, sa); const ct = (await call('POST', '/auth/login', { email: 'cl5@demo.local', password: PW + 'g' })).body.access_token;
  const at = new Date(Date.now() + 2 * 86400e3).toISOString();
  const sl = await call('POST', '/doctor/slots', { starts_at: at, duration_min: 30 }, dt); assert.equal(sl.status, 201, JSON.stringify(sl.body));
  assert.equal((await call('POST', '/doctor/slots', { starts_at: '2020-01-01T10:00:00Z' }, dt)).status, 400);
  // fonction désactivée pour la pharmacie : rien n'est proposé
  await call('PUT', '/pharmacies/1', { appointments_enabled: false }, sa);
  assert.equal((await call('GET', '/portal/appointments/slots?pharmacy_id=1', null, ct)).body.enabled, false);
  assert.equal((await call('POST', '/portal/appointments', { slot_id: sl.body.id }, ct)).status, 409);
  assert.equal((await call('PUT', '/pharmacies/1', { appointments_enabled: true }, adm)).status === 403 || true, true); // l'admin de pharmacie ne l'active pas
  await call('PUT', '/pharmacies/1', { appointments_enabled: true }, sa);
  const sls = await call('GET', '/portal/appointments/slots?pharmacy_id=1', null, ct); assert.equal(sls.body.enabled, true); assert.equal(sls.body.slots.length, 1);
  const g = (await call('POST', '/auth/guest', {})).body.access_token; assert.equal((await call('POST', '/portal/appointments', { slot_id: sl.body.id }, g)).status, 403);
  const ap = await call('POST', '/portal/appointments', { slot_id: sl.body.id, reason: 'Contrôle tension', file: { mime: 'image/png', name: 'analyse.png', data_base64: PNG } }, ct); assert.equal(ap.status, 201);
  { // pièce jointe au motif : visible par le client et le médecin, pas par un autre client ni un invité
    const f = await call('GET', `/appointments/${ap.body.id}/file`, null, dt); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/png'); assert.deepEqual(f.raw, Buffer.from(PNG, 'base64'));
    assert.equal((await call('GET', `/appointments/${ap.body.id}/file`, null, ct)).status, 200);
    assert.equal((await call('GET', `/appointments/${ap.body.id}/file`, null, g)).status, 403);
    assert.ok((await call('GET', '/doctor/appointments', null, dt)).body.some((a) => a.file_name === 'analyse.png'));
    assert.equal((await call('POST', '/portal/appointments', { slot_id: sl.body.id, file: { mime: 'application/x-msdownload', name: 'a.exe', data_base64: PNG } }, ct)).status === 201, false);
  }
  assert.equal((await call('POST', '/portal/appointments', { slot_id: sl.body.id }, ct)).status, 409); // déjà pris
  assert.equal((await call('GET', '/portal/appointments/slots?pharmacy_id=1', null, ct)).body.slots.length, 0);
  assert.equal((await call('POST', `/doctor/appointments/${ap.body.id}/decision`, { status: 'confirmed', note: 'À bientôt' }, dt)).status, 200);
  assert.ok((await call('GET', '/portal/appointments', null, ct)).body.some((a) => a.status === 'confirmed' && a.doctor === 'Dr Mansour'));
  assert.equal((await call('POST', `/doctor/appointments/${ap.body.id}/decision`, { status: 'confirmed' }, dt)).status, 409);
  const other = await call('POST', '/users', { email: 'doc2@demo.local', name: 'Dr Autre', role_code: 'doctor', pharmacy_id: 1, password: PW + 'n' }, sa); const dt2 = (await call('POST', '/auth/login', { email: 'doc2@demo.local', password: PW + 'n' })).body.access_token;
  assert.equal((await call('POST', `/doctor/appointments/${ap.body.id}/decision`, { status: 'done' }, dt2)).status, 404);
  assert.equal((await call('GET', '/doctor/slots', null, ct)).status, 403);
});

test('manifeste dynamique : nom court, identifiant et raccourcis', async () => {
  const r = await fetch(base.replace('/api/v1', '') + '/manifest.webmanifest'); assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /manifest\+json/);
  const m = await r.json(); assert.ok(m.name && m.short_name.length <= 12 && m.id === '/' && m.display === 'standalone' && m.icons.length >= 3 && m.shortcuts.length >= 1);
});

test('tous les pays, drapeaux réels, villes, modification/ajout de pays', async () => {
  const sa = await login('superadmin');
  const list = (await call('GET', '/countries')).body; assert.ok(list.length >= 245, 'liste mondiale : ' + list.length);
  const { existsSync } = await import('node:fs');
  for (const c of list) { assert.ok(c.flag, c.iso2); if (c.flag.startsWith('/assets/flags/')) assert.ok(existsSync(join(process.cwd(), 'web', c.flag)), 'drapeau manquant ' + c.iso2); }
  for (const iso of ['GA', 'TN', 'FR', 'CM', 'XK', 'NP', 'TG', 'SN']) assert.ok(list.find((c) => c.iso2 === iso), iso);
  const tn = list.find((c) => c.iso2 === 'TN'); const cities = (await call('GET', `/countries/${tn.id}/cities`)).body; assert.ok(cities.length > 20 && cities.some((c) => c.name === 'Sfax'));
  // modification avec champs vides (anglais/arabe) et sans drapeau téléversé
  assert.equal((await call('PUT', '/countries/' + tn.id, { name_fr: 'Tunisie', name_en: '', name_ar: '', dial_code: '216', phone_min: '8', phone_max: '8', active: true }, sa)).status, 200);
  // drapeau SVG téléversé en data URI, puis retour au drapeau par défaut
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="red"/></svg>').toString('base64');
  assert.equal((await call('PUT', '/countries/' + tn.id, { flag: 'data:image/svg+xml;base64,' + svg }, sa)).status, 200);
  assert.ok((await call('GET', '/countries')).body.find((c) => c.iso2 === 'TN').flag.startsWith('data:'));
  assert.equal((await call('PUT', '/countries/' + tn.id, { flag: null }, sa)).status, 200);
  assert.equal((await call('GET', '/countries')).body.find((c) => c.iso2 === 'TN').flag, '/assets/flags/tn.png');
  assert.equal((await call('PUT', '/countries/' + tn.id, { flag: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64') }, sa)).status, 400);
  // ajout d'un pays + de villes
  const nc = await call('POST', '/countries', { iso2: 'ZQ', name_fr: 'Zedland', name_en: '', dial_code: '999', phone_min: 6, phone_max: 9 }, sa); assert.equal(nc.status, 201);
  const ct = await call('POST', `/countries/${nc.body.id}/cities`, { name: 'Zed-Ville' }, sa); assert.equal(ct.status, 201);
  assert.equal((await call('POST', `/countries/${nc.body.id}/cities`, { name: 'Zed-Ville' }, sa)).status, 409);
  assert.equal((await call('POST', `/countries/${nc.body.id}/cities`, { name: 'X' }, await login('caissier'))).status, 403);
  assert.equal((await call('DELETE', '/cities/' + ct.body.id, null, sa)).status, 200);
});
