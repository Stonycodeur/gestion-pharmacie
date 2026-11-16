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

test('reprise de session sans 401 (/auth/session) et pièce d\'identité PDF/PNG visible par le chauffeur et l\'administrateur', async () => {
  assert.deepEqual((await call('GET', '/auth/session', null)).body, { active: false });
  const adm = await login('admin'); const d = await mkDriver(adm, '5');
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64'), png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  for (const [mime, name, data] of [['application/pdf', 'cni.pdf', pdf], ['image/png', 'cni.png', png]]) {
    const up = await call('PUT', '/driver/me/id-doc', { type: 'cni', number: '123', file: { mime, name, data_base64: data } }, d.t); assert.equal(up.status, 200, JSON.stringify(up.body));
    const mine = await call('GET', '/driver/me/id-doc', null, d.t); assert.equal(mine.status, 200); assert.equal(mine.headers.get('content-type'), mime, 'le chauffeur voit sa pièce, avec son vrai type');
    const adminView = await call('GET', `/drivers/${d.id}/id-doc`, null, adm); assert.equal(adminView.status, 200); assert.equal(adminView.headers.get('content-type'), mime); assert.ok(adminView.raw.length > 20);
  }
});

test('rapports : analyse (indicateurs, comparaison, heures, jours) et flux /events ouvert à tout compte connecté (plus de 403 en boucle)', async () => {
  const adm = await login('admin'); const r = await call('GET', '/reports/analytics?group=day', null, adm); assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const k of ['current', 'prev', 'series', 'series_prev', 'hours', 'weekdays', 'payments', 'top']) assert.ok(k in r.body, k);
  assert.ok(r.body.days >= 1 && r.body.previous.to < r.body.from); assert.equal((await call('GET', '/reports/analytics?group=month', null, adm)).status, 200);
  const cl = await login('client'); assert.equal((await call('GET', '/reports/analytics', null, cl)).status, 403);
  const p = await call('PUT', '/me/preferences', { reports_ui: { widgets: ['kpis', 'trend', 'bogus'], chart: 'line', metric: 'margin', range: 90 } }, adm); assert.equal(p.status, 200); assert.deepEqual(p.body.reports_ui.widgets, ['kpis', 'trend']); assert.equal(p.body.reports_ui.chart, 'line');
  const d = await mkDriver(adm, '6');
  for (const tk of [d.t, cl, adm]) { const ac = new AbortController(); const res = await fetch(base + '/events', { headers: { authorization: 'Bearer ' + tk }, signal: ac.signal }); assert.equal(res.status, 200); ac.abort(); }
});

test('2FA par QR code, aide ouverte au chauffeur, chauffeur multi-pharmacies et vues gérées dans Rôles & droits', async () => {
  const adm = await login('admin'), sa = await login('superadmin');
  // QR code de la double authentification (SVG généré localement, aucun service externe)
  const cl = (await call('POST', '/users', { name: 'Mfa Test', email: 'mfa@t.local', role_code: 'cashier', pharmacy_id: 1, password: PW2 }, sa)); assert.equal(cl.status, 201);
  const mt = (await call('POST', '/auth/login', { email: 'mfa@t.local', password: PW2 })).body.access_token;
  const su = await call('POST', '/auth/mfa/setup', {}, mt); assert.equal(su.status, 200); assert.match(su.body.qr_svg, /^<svg[^>]+viewBox/); assert.ok(su.body.otpauth.startsWith('otpauth://totp/') && su.body.secret);
  // chauffeur : aide + plusieurs pharmacies
  const d = await mkDriver(adm, '4'); const du = (await call('GET', '/users?q=drv4', null, adm)).body; const uid = (du.data || du).find((x) => x.email === 'drv4@t.local').id;
  const p2 = (await call('POST', '/pharmacies', { name: 'Annexe Multi', currency: 'TND', currency_decimals: 3 }, sa)).body.id, p3 = (await call('POST', '/pharmacies', { name: 'Autre Multi', currency: 'TND', currency_decimals: 3 }, sa)).body.id;
  assert.equal((await call('POST', '/help/tickets', { pharmacy_id: p2, subject: 'Bonjour', body: 'Test' }, d.t)).status, 403, 'pas encore rattaché');
  const cfg = await call('GET', `/users/${uid}/driver-pharmacies`, null, adm); assert.equal(cfg.status, 200); assert.ok(cfg.body.pharmacies.length >= 3); assert.deepEqual(cfg.body.selected, [1]);
  const put = await call('PUT', `/users/${uid}/driver-pharmacies`, { pharmacy_ids: [p2] }, adm); assert.equal(put.status, 200, JSON.stringify(put.body)); assert.deepEqual(put.body.selected.sort(), [1, p2].sort(), 'la pharmacie principale reste rattachée');
  assert.deepEqual((await call('GET', '/driver/pharmacies', null, d.t)).body.map((x) => x.id).sort(), [1, p2].sort());
  const tk = await call('POST', '/help/tickets', { pharmacy_id: p2, subject: 'Question course', body: 'Bonjour, une question' }, d.t); assert.equal(tk.status, 201, JSON.stringify(tk.body));
  assert.equal((await call('POST', '/help/tickets', { pharmacy_id: p3, subject: 'x', body: 'y' }, d.t)).status, 403, 'pharmacie non rattachée');
  assert.equal((await call('GET', '/help/tickets', null, d.t)).body.length, 1); assert.equal((await call('POST', `/help/tickets/${tk.body.id}/messages`, { body: 'Suite' }, d.t)).status, 201);
  assert.equal((await call('GET', `/users/${uid}/driver-pharmacies`, null, (await call('POST', '/auth/login', { email: 'client@demo.local', password: PW })).body.access_token)).status, 403);
  assert.equal((await call('PUT', `/users/${uid}/driver-pharmacies`, { pharmacy_ids: [] }, sa)).body.selected.length, 1, 'retrait des rattachements annexes');
  // vues dans Rôles & droits : une vue par entrée de menu, accordée selon les fonctions du rôle
  const roles = (await call('GET', '/roles', null, adm)).body; const views = roles.permissions.filter((p) => p.code.startsWith('view.')); assert.ok(views.length >= 25);
  const by = Object.fromEntries(roles.roles.map((r) => [r.code, new Set(r.permissions)]));
  assert.ok(by.cashier.has('view.pos') && !by.cashier.has('view.reports') && !by.cashier.has('view.users')); assert.ok(by.driver.has('view.driver') && by.driver.has('view.help') && !by.driver.has('view.dashboard')); assert.ok(by.customer.has('view.portal'));
  assert.ok((await call('GET', '/auth/me', null, adm)).body.permissions.includes('view.reports'));
  const me = (await call('POST', '/auth/login', { email: 'drv4@t.local', password: PW2 })).body; assert.ok(me.permissions.includes('view.driver') && me.permissions.includes('view.help'));
});

test('exports : sous-titre (page › vue), logo par défaut, Excel filtrable/triable, PDF paginé ; recherche multi-champs', async () => {
  const adm = await login('admin'), tok = adm; const get = async (p) => { const r = await fetch(base + p, { headers: { authorization: 'Bearer ' + tok } }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), cd: r.headers.get('content-disposition') }; };
  const x = await get('/reports/sales?format=xlsx&from=2020-01-01'); assert.equal(x.status, 200); const s = x.buf.toString('latin1');
  for (const k of ['<autoFilter ref="A6:', 'state="frozen"', 'xdr:pic', 'xl/media/logo.png', 'Rapports', 'Ventes', 'SUBTOTAL(109', 'Print_Titles']) assert.ok(s.includes(k), 'Excel : ' + k);
  assert.match(x.cd, /ventes-\d{4}-\d{2}-\d{2}\.xlsx/);
  const p = await get('/reports/sales?format=pdf&from=2020-01-01'); assert.equal(p.status, 200); const ps = p.buf.toString('latin1'); assert.ok(ps.startsWith('%PDF') && ps.includes('(Rapports)') && ps.includes('(Ventes)') && ps.includes('Page 1 / 1') && ps.includes('/Subtype /Image'), 'PDF : titre, sous-titre, logo, pagination');
  const post = async (b) => fetch(base + '/export/grid', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const g = await post({ format: 'xlsx', title: 'Stock', subtitle: 'Lots', head: ['Produit', 'Disp.'], data: [['A', 3], ['B', 5.5]], dec: [null, 1] }); assert.equal(g.status, 200); const gs = Buffer.from(await g.arrayBuffer()).toString('latin1'); assert.ok(gs.includes('Stock') && gs.includes('Lots') && gs.includes('<v>5.5</v>') && gs.includes('<autoFilter'));
  assert.match(g.headers.get('content-disposition'), /Stock-Lots-/); assert.equal((await post({ format: 'doc', head: ['a'], data: [] })).status, 400); assert.equal((await post({ format: 'pdf', head: [], data: [] })).status, 400);
  // recherche : le caissier et le mode de paiement retrouvent aussi une vente
  const all = (await (await fetch(base + '/sales?limit=5', { headers: { authorization: 'Bearer ' + tok } })).json()); const first = (all.data || [])[0];
  if (first) { const q = await (await fetch(base + '/sales?q=' + encodeURIComponent(first.cashier_name), { headers: { authorization: 'Bearer ' + tok } })).json(); assert.ok((q.data || []).some((r) => r.id === first.id), 'recherche par caissier'); }
});

test('chauffeur : modes de livraison choisis à la mise en disponibilité ; une course n\'est proposée qu\'aux chauffeurs ayant choisi son mode', async () => {
  const adm = await login('admin'); const a = await mkDriver(adm, '2'), b = await mkDriver(adm, '3');
  assert.deepEqual((await call('GET', '/driver/me', null, a.t)).body.modes, ['economy', 'standard', 'express', 'scheduled'], 'par défaut : tous les modes'); assert.equal((await call('PUT', '/driver/me', { availability: 'available', accepted_modes: [] }, a.t)).status, 400); assert.equal((await call('PUT', '/driver/me', { availability: 'available', accepted_modes: ['bidon'] }, a.t)).status, 400);
  assert.equal((await call('PUT', '/driver/me', { availability: 'available', accepted_modes: ['standard'] }, a.t)).status, 200); assert.deepEqual((await call('GET', '/driver/me', null, a.t)).body.modes, ['standard']);
  assert.equal((await call('PUT', '/driver/me', { availability: 'available', accepted_modes: ['standard', 'express', 'economy', 'scheduled'] }, b.t)).status, 200);
  assert.deepEqual((await call('GET', '/driver/me', null, b.t)).body.modes, ['economy', 'standard', 'express', 'scheduled']);
  const { run } = await import('../server/db.js'); run("UPDATE drivers SET availability='offline' WHERE id != ?", a.id); // seul A (standard) est disponible
  const o1 = await customerOrder('x1'); const ex = await call('POST', `/portal/orders/${o1.id}/delivery`, { address: '12 rue des Oliviers, Tunis', phone: '98123456', lat: 36.85, lng: 10.25, mode: 'express' }, o1.t);
  assert.equal(ex.status, 409, JSON.stringify(ex.body)); assert.match(ex.body.error.message, /Express/);
  const st = await call('POST', `/portal/orders/${o1.id}/delivery`, { address: '12 rue des Oliviers, Tunis', phone: '98123456', lat: 36.85, lng: 10.25, mode: 'standard' }, o1.t); assert.equal(st.status, 201, JSON.stringify(st.body));
  run("UPDATE drivers SET availability='available' WHERE id=?", b.id); const o2 = await customerOrder('x2');
  const e2 = await call('POST', `/portal/orders/${o2.id}/delivery`, { address: '14 rue des Oliviers, Tunis', phone: '98123456', lat: 36.85, lng: 10.25, mode: 'express' }, o2.t); assert.equal(e2.status, 201, JSON.stringify(e2.body));
  const ids = async (t) => (await call('GET', '/driver/offers', null, t)).body.data.map((x) => x.id);
  assert.ok((await ids(a.t)).includes(st.body.id) && !(await ids(a.t)).includes(e2.body.id), 'A ne voit pas l\'Express'); assert.ok((await ids(b.t)).includes(e2.body.id) && (await ids(b.t)).includes(st.body.id));
  const acc = await call('POST', `/driver/offers/${e2.body.id}/accept`, {}, a.t); assert.equal(acc.status, 403); assert.match(acc.body.error.message, /Express/);
  assert.equal((await call('POST', `/driver/offers/${e2.body.id}/accept`, {}, b.t)).status, 200);
});
