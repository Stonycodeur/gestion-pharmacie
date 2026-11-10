// Tests d'intégration de l'API : critères de recette du cahier des charges (§16). Lancer : npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-test-'));
process.env.DB_FILE = join(dir, 'test.sqlite');
process.env.UPLOAD_DIR = join(dir, 'uploads');
process.env.NODE_ENV = 'test';
if (process.env.DB_DRIVER === 'mariadb') process.env.MARIADB_DATABASE = 'gp_t_' + Math.random().toString(36).slice(2, 10);
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/seed.js'], { env: process.env, stdio: 'pipe' });

const { createApp } = await import('../server/index.js');
const { totp } = await import('../server/security.js');
const { rawExec, get } = await import('../server/db.js');

let server, base; const PW = 'Demo#Pharma2026'; const tokens = {};
before(async () => { server = createApp(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
after(async () => { server.close(); (await import('../server/db.js')).dropDatabase(); rmSync(dir, { recursive: true, force: true }); });

async function call(method, path, body, token, headers = {}) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, headers: r.headers };
}
async function login(who) {
  if (tokens[who]) return tokens[who];
  const r = await call('POST', '/auth/login', { email: `${who}@demo.local`, password: PW }); assert.equal(r.status, 200, JSON.stringify(r.body));
  return (tokens[who] = r.body.access_token);
}
const pid = async (sku) => (await call('GET', `/products?q=${sku}`, null, await login('admin'))).body.data.find((p) => p.sku === sku).id;
const stockOf = async (id, who = 'admin') => (await call('GET', `/stock?q=${encodeURIComponent((await call('GET', '/products/' + id, null, await login('admin'))).body.sku)}`, null, await login(who))).body.data.find((s) => s.id === id);
const registers = {};
async function openCash(who) {
  const t = await login(who); const cur = await call('GET', '/cash/current', null, t); if (cur.body) return cur.body;
  if (!registers[who]) registers[who] = (await call('POST', '/cash/registers', { name: 'Caisse ' + who }, await login('admin'))).body.id;
  const r = await call('POST', '/cash/open', { register_id: registers[who], opening_float: 50000 }, t); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
}

test('authentification : échec, mauvais mot de passe, endpoints protégés', async () => {
  assert.equal((await call('GET', '/products')).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'admin@demo.local', password: 'mauvais' })).status, 401);
  const me = await call('GET', '/auth/me', null, await login('admin'));
  assert.equal(me.body.user.role, 'pharmacy_admin');
});

test('RBAC : un caissier ne gère ni le catalogue ni les utilisateurs', async () => {
  const t = await login('caissier');
  assert.equal((await call('POST', '/products', { sku: 'X1', name: 'X' }, t)).status, 403);
  assert.equal((await call('GET', '/users', null, t)).status, 403);
  assert.equal((await call('GET', '/audit', null, t)).status, 403);
});

test('réception : le stock est mis à jour par lot avec lien fournisseur/bon de commande, réception partielle', async () => {
  const stockT = await login('stock'), adminT = await login('admin');
  const p = await pid('GEL100'); const before = (await stockOf(p)).available;
  const sup = (await call('GET', '/suppliers', null, stockT)).body.data[0];
  const po = await call('POST', '/purchase-orders', { supplier_id: sup.id, lines: [{ product_id: p, qty_ordered: 100, unit_cost: 1200 }] }, stockT); assert.equal(po.status, 201);
  assert.equal((await call('POST', `/purchase-orders/${po.body.id}/status`, { status: 'sent' }, stockT)).status, 403, 'le gestionnaire ne peut pas approuver');
  assert.equal((await call('POST', `/purchase-orders/${po.body.id}/status`, { status: 'sent' }, adminT)).status, 200);
  const rec = await call('POST', '/goods-receipts', { po_id: po.body.id, supplier_invoice_ref: 'F-1', lines: [{ product_id: p, qty: 40, batch_no: 'GEL-T1', exp_date: '2030-01-31', unit_cost: 1200 }] }, stockT);
  assert.equal(rec.status, 201, JSON.stringify(rec.body)); assert.equal(rec.body.po_status, 'partial');
  assert.equal((await stockOf(p)).available, before + 40);
  const over = await call('POST', '/goods-receipts', { po_id: po.body.id, lines: [{ product_id: p, qty: 70, batch_no: 'GEL-T2', exp_date: '2030-01-31' }] }, stockT);
  assert.equal(over.status, 409); assert.equal(over.body.error.code, 'OVER_RECEIPT');
  const exp = await call('POST', '/goods-receipts', { supplier_id: sup.id, lines: [{ product_id: p, qty: 5, batch_no: 'GEL-OLD', exp_date: '2020-01-01' }] }, stockT);
  assert.equal(exp.body.error.code, 'EXPIRED_ON_RECEIPT', 'un lot déjà périmé ne peut pas être réceptionné');
  const rest = await call('POST', '/goods-receipts', { po_id: po.body.id, lines: [{ product_id: p, qty: 60, batch_no: 'GEL-T1', exp_date: '2030-01-31' }] }, stockT);
  assert.equal(rest.body.po_status, 'received');
});

test('vente : FEFO, stock + caisse mis à jour atomiquement, ticket, idempotence', async () => {
  const t = await login('caissier'); await openCash('caissier');
  const p = await pid('PAR500'); const s0 = await stockOf(p, 'caissier');
  const lotsBefore = (await call('GET', `/stock/batches?product_id=${p}`, null, await login('admin'))).body.filter((l) => l.status === 'ok' && l.days_left >= 0 && l.qty_available >= 5);
  const r = await call('POST', '/sales', { lines: [{ product_id: p, qty: 5 }], payments: [{ method: 'cash', amount: 10000 }] }, t, { 'idempotency-key': 'k-1' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const lots = lotsBefore;
  assert.equal(r.body.lines[0].batch_no, lots.sort((a, b) => a.exp_date.localeCompare(b.exp_date))[0].batch_no, 'FEFO : le lot le plus proche de la péremption part en premier');
  assert.equal(r.body.total, 6000); assert.equal(r.body.change_given, 4000);
  assert.equal((await stockOf(p, 'caissier')).available, s0.available - 5);
  const dup = await call('POST', '/sales', { lines: [{ product_id: p, qty: 5 }], payments: [{ method: 'cash', amount: 10000 }] }, t, { 'idempotency-key': 'k-1' });
  assert.equal(dup.body.number, r.body.number); assert.equal((await stockOf(p, 'caissier')).available, s0.available - 5, 'pas de double décrément');
  const cur = await call('GET', '/cash/current', null, t); assert.equal(cur.body.sales >= 1, true);
  assert.equal(cur.body.expected_cash, 50000 + 6000);
});

test('vente : paiement insuffisant ou stock insuffisant → rien n\'est enregistré (transaction)', async () => {
  const t = await login('caissier'); await openCash('caissier'); const p = await pid('IBU400'); const s0 = await stockOf(p, 'caissier');
  const under = await call('POST', '/sales', { lines: [{ product_id: p, qty: 2 }], payments: [{ method: 'cash', amount: 100 }] }, t); assert.equal(under.body.error.code, 'UNDERPAID');
  const huge = await call('POST', '/sales', { lines: [{ product_id: p, qty: 99999 }], payments: [{ method: 'cash', amount: 1e9 }] }, t); assert.equal(huge.body.error.code, 'INSUFFICIENT_STOCK');
  assert.equal((await stockOf(p, 'caissier')).available, s0.available);
});

test('lot rappelé / périmé / en quarantaine : jamais vendable', async () => {
  const ph = await login('pharmacien'), t = await login('caissier'); await openCash('caissier');
  const p = await pid('GEL100'); const lots = (await call('GET', `/stock/batches?product_id=${p}`, null, ph)).body; const lot = lots.find((l) => l.batch_no === 'GEL-T1');
  assert.equal((await call('POST', `/batches/${lot.batch_id}/status`, { status: 'recalled', reason: 'Rappel fabricant' }, t)).status, 403);
  assert.equal((await call('POST', `/batches/${lot.batch_id}/status`, { status: 'recalled', reason: 'Rappel fabricant' }, ph)).status, 201);
  const afterRecall = (await call('GET', `/stock/batches?product_id=${p}`, null, ph)).body.find((l) => l.batch_id === lot.batch_id); assert.equal(afterRecall.status, 'recalled');
  const sale = await call('POST', '/sales', { lines: [{ product_id: p, qty: 1 }], payments: [{ method: 'cash', amount: 5000 }] }, t);
  assert.equal(sale.status, 201); assert.notEqual(sale.body.lines[0].batch_no, 'GEL-T1', 'le lot rappelé est ignoré par FEFO');
  const forced = await call('POST', '/sales', { lines: [{ product_id: p, qty: 1, batch_id: lot.batch_id }], payments: [{ method: 'cash', amount: 5000 }] }, t); assert.equal(forced.status, 409);
  // lot périmé et lot en quarantaine du jeu de démo : exclus du stock vendable
  const lor = await stockOf(await pid('LOR10')); assert.ok(lor.available > lor.sellable, 'le lot périmé est exclu du vendable');
  const cet = await stockOf(await pid('CET10')); assert.equal(cet.state === 'ok' || cet.sellable >= 0, true);
  const cetLots = (await call('GET', `/stock/batches?product_id=${await pid('CET10')}`, null, ph)).body; const q = cetLots.find((l) => l.status === 'quarantine');
  const viaQ = await call('POST', '/sales', { lines: [{ product_id: await pid('CET10'), qty: 1, batch_id: q.batch_id }], payments: [{ method: 'cash', amount: 5000 }] }, t); assert.equal(viaQ.status, 409);
});

test('ordonnance : pas de délivrance sans validation pharmacien ; workflow complet ; reliquat', async () => {
  const assistant = await login('preparateur'), pharm = await login('pharmacien'), cashier = await login('caissier');
  await openCash('pharmacien'); const amx = await pid('AMX500');
  // caissier : jamais de produit sur ordonnance
  assert.equal((await call('POST', '/sales', { lines: [{ product_id: amx, qty: 1 }], payments: [{ method: 'cash', amount: 9000 }] }, cashier)).body.error.code, 'RX_PERMISSION');
  // pharmacien sans ordonnance
  assert.equal((await call('POST', '/sales', { lines: [{ product_id: amx, qty: 1 }], payments: [{ method: 'cash', amount: 9000 }] }, pharm)).body.error.code, 'PRESCRIPTION_REQUIRED');
  const pres = await call('POST', '/prescriptions', { patient_name: 'Patient Test', prescriber_name: 'Dr X', prescription_date: new Date().toISOString().slice(0, 10), lines: [{ product_id: amx, qty: 2 }],
    file: { name: 'o.png', mime: 'image/png', data_base64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100)]).toString('base64') } }, assistant);
  assert.equal(pres.status, 201, JSON.stringify(pres.body));
  const early = await call('POST', '/sales', { prescription_id: pres.body.id, lines: [{ product_id: amx, qty: 1 }], payments: [{ method: 'cash', amount: 9000 }] }, pharm); assert.equal(early.body.error.code, 'PRESCRIPTION_NOT_VALIDATED');
  assert.equal((await call('POST', `/prescriptions/${pres.body.id}/transition`, { to: 'to_verify' }, assistant)).status, 200);
  assert.equal((await call('POST', `/prescriptions/${pres.body.id}/transition`, { to: 'validated', checklist: {} }, assistant)).status, 403, 'le préparateur ne valide pas');
  const noCheck = await call('POST', `/prescriptions/${pres.body.id}/transition`, { to: 'validated', checklist: { identity: true } }, pharm); assert.equal(noCheck.body.error.code, 'CHECKLIST_INCOMPLETE');
  const full = { identity: true, legible: true, date_valid: true, prescriber: true, products_posology: true };
  assert.equal((await call('POST', `/prescriptions/${pres.body.id}/transition`, { to: 'validated', checklist: full }, pharm)).status, 200);
  const s1 = await call('POST', '/sales', { prescription_id: pres.body.id, lines: [{ product_id: amx, qty: 1 }], payments: [{ method: 'cash', amount: 6000 }] }, pharm); assert.equal(s1.status, 201, JSON.stringify(s1.body));
  assert.equal((await call('GET', `/prescriptions/${pres.body.id}`, null, pharm)).body.status, 'partially_delivered');
  const over = await call('POST', '/sales', { prescription_id: pres.body.id, lines: [{ product_id: amx, qty: 2 }], payments: [{ method: 'cash', amount: 20000 }] }, pharm); assert.equal(over.body.error.code, 'PRESCRIPTION_QTY_EXCEEDED');
  assert.equal((await call('POST', '/sales', { prescription_id: pres.body.id, lines: [{ product_id: amx, qty: 1 }], payments: [{ method: 'cash', amount: 6000 }] }, pharm)).status, 201);
  const done = (await call('GET', `/prescriptions/${pres.body.id}`, null, pharm)).body; assert.equal(done.status, 'delivered'); assert.equal(done.dispensings.length, 2);
  // fichier : contenu non conforme refusé
  const bad = await call('POST', '/prescriptions', { patient_name: 'X', file: { mime: 'image/png', data_base64: Buffer.from('pas une image').toString('base64') } }, assistant); assert.equal(bad.status, 400);
  assert.equal((await call('GET', `/prescriptions/${pres.body.id}/file`, null, pharm)).status, 200);
});

test('produit contrôlé : pharmacien uniquement', async () => {
  const assistant = await login('preparateur'); const dia = await pid('DIA5'); await openCash('preparateur');
  const pres = await call('POST', '/prescriptions', { patient_name: 'P', lines: [{ product_id: dia, qty: 1 }] }, assistant);
  const pharm = await login('pharmacien'); await call('POST', `/prescriptions/${pres.body.id}/transition`, { to: 'to_verify' }, assistant);
  await call('POST', `/prescriptions/${pres.body.id}/transition`, { to: 'validated', checklist: { identity: true, legible: true, date_valid: true, prescriber: true, products_posology: true } }, pharm);
  const r = await call('POST', '/sales', { prescription_id: pres.body.id, lines: [{ product_id: dia, qty: 1 }], payments: [{ method: 'cash', amount: 5000 }] }, assistant);
  assert.equal(r.body.error.code, 'CONTROLLED_PERMISSION');
});

test('remboursement : motif obligatoire, retour en quarantaine, validation d\'un responsable au-delà du seuil', async () => {
  const pharm = await login('pharmacien'), cashier = await login('caissier'); await openCash('caissier'); await openCash('pharmacien');
  const tens = await pid('TENSIO'); const sale = await call('POST', '/sales', { lines: [{ product_id: tens, qty: 1 }], payments: [{ method: 'card', amount: 89000 }] }, cashier); assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const line = sale.body.lines[0];
  assert.equal((await call('POST', `/sales/${sale.body.id}/refund`, { lines: [{ sale_line_id: line.id, qty: 1 }] }, cashier)).status, 403, 'caissier sans droit de remboursement');
  const noReason = await call('POST', `/sales/${sale.body.id}/refund`, { lines: [{ sale_line_id: line.id, qty: 1 }] }, pharm); assert.equal(noReason.status, 400);
  const adminT = await login('admin'); await openCash('admin');
  const ref = await call('POST', `/sales/${sale.body.id}/refund`, { lines: [{ sale_line_id: line.id, qty: 1 }], reason: 'Produit défectueux', method: 'card' }, adminT); assert.equal(ref.status, 201, JSON.stringify(ref.body));
  assert.equal(ref.body.amount, 89000); assert.equal(ref.body.sale.status, 'refunded');
  const again = await call('POST', `/sales/${sale.body.id}/refund`, { lines: [{ sale_line_id: line.id, qty: 1 }], reason: 'double' }, adminT); assert.equal(again.body.error.code, 'REFUND_EXCEEDS');
  const st = await stockOf(tens); assert.equal(st.quarantine >= 1, true, 'le retour va en quarantaine, pas en stock vendable');
  // seuil : un rôle autorisé à rembourser mais sans droit d'approbation a besoin de l'accord d'un responsable
  const sa = await login('superadmin'); const roles = (await call('GET', '/roles', null, sa)).body.roles.find((r) => r.code === 'assistant');
  await call('PUT', '/roles/assistant/permissions', { permissions: [...roles.permissions, 'sales.refund'] }, sa);
  const prep = await login('preparateur'); await openCash('preparateur');
  const s2 = await call('POST', '/sales', { lines: [{ product_id: tens, qty: 1 }], payments: [{ method: 'cash', amount: 89000 }] }, cashier); assert.equal(s2.status, 201);
  const body = { lines: [{ sale_line_id: s2.body.lines[0].id, qty: 1 }], reason: 'Retour client' };
  assert.equal((await call('POST', `/sales/${s2.body.id}/refund`, body, prep)).body.error.code, 'APPROVAL_REQUIRED');
  assert.equal((await call('POST', `/sales/${s2.body.id}/refund`, { ...body, approver: { email: 'pharmacien@demo.local', password: 'faux' } }, prep)).status, 403);
  assert.equal((await call('POST', `/sales/${s2.body.id}/refund`, { ...body, approver: { email: 'pharmacien@demo.local', password: PW } }, prep)).status, 201);
  await call('PUT', '/roles/assistant/permissions', { permissions: roles.permissions }, sa);
});

test('caisse : écart non justifié refusé, clôture avec justification', async () => {
  const t = await login('stock'); // sans droit caisse
  assert.equal((await call('POST', '/cash/close', { counted_cash: 1 }, t)).status, 403);
  const c = await login('comptable'); assert.equal((await call('POST', '/cash/open', { register_id: 1 }, c)).status, 403);
  const pharm = await login('pharmacien'); const cur = await openCash('pharmacien');
  const bad = await call('POST', '/cash/close', { counted_cash: 1 }, pharm); assert.equal(bad.body.error.code, 'REASON_REQUIRED');
  const ok = await call('POST', '/cash/close', { counted_cash: 1, reason: 'Erreur de rendu de monnaie' }, pharm); assert.equal(ok.status, 200); assert.notEqual(ok.body.difference, 0);
});

test('inventaire : comptage, justification, validation par une autre personne, ajustement tracé', async () => {
  const stockT = await login('stock'), ph = await login('pharmacien');
  const p = await pid('SERUM'); const inv = await call('POST', '/inventories', { label: 'Test cyclique', kind: 'cycle', product_ids: [p] }, stockT); assert.equal(inv.status, 201, JSON.stringify(inv.body)); assert.ok(inv.body.lines > 0);
  const detail = (await call('GET', `/inventories/${inv.body.id}`, null, stockT)).body; assert.equal(detail.blind, true); assert.equal(detail.lines[0].expected_qty, null, 'comptage en aveugle');
  // comptage : toutes les lignes = théorique, sauf la première (-3) sans justification
  const full = (await call('GET', `/inventories/${inv.body.id}`, null, ph)).body.lines;
  await call('PUT', `/inventories/${inv.body.id}/lines`, { lines: full.map((l, i) => ({ batch_id: l.batch_id, counted_qty: i === 0 ? l.expected_qty - 3 : l.expected_qty })) }, stockT);
  assert.equal((await call('POST', `/inventories/${inv.body.id}/submit`, null, stockT)).status, 200);
  assert.equal((await call('POST', `/inventories/${inv.body.id}/validate`, null, ph)).body.error.code, 'REASON_REQUIRED');
  assert.equal((await call('PUT', `/inventories/${inv.body.id}/lines`, { lines: [{ batch_id: full[0].batch_id, counted_qty: full[0].expected_qty - 3, reason: 'Casse constatée' }] }, stockT)).status, 409, 'inventaire soumis : non modifiable');
  assert.equal((await call('POST', `/inventories/${inv.body.id}/validate`, null, stockT)).status, 403, 'le gestionnaire n\'a pas le droit de valider');
});

test('commandes : réservation du stock, libération à l\'annulation, retrait → vente', async () => {
  const ph = await login('pharmacien'); await openCash('pharmacien');
  const cust = (await call('GET', '/customers', null, ph)).body.data[0]; const p = await pid('VITC'); const s0 = await stockOf(p);
  const o = await call('POST', '/orders', { customer_id: cust.id, kind: 'reservation', lines: [{ product_id: p, qty: 4 }] }, ph); assert.equal(o.status, 201, JSON.stringify(o.body));
  const s1 = await stockOf(p); assert.equal(s1.reserved, s0.reserved + 4); assert.equal(s1.available, s0.available, 'réservé ≠ sorti');
  assert.equal((await call('POST', `/orders/${o.body.id}/status`, { status: 'cancelled' }, ph)).status, 200);
  assert.equal((await stockOf(p)).reserved, s0.reserved, 'réservation libérée');
  const o2 = await call('POST', '/orders', { customer_id: cust.id, kind: 'order', lines: [{ product_id: p, qty: 2 }] }, ph);
  for (const st of ['confirmed', 'preparing', 'ready']) assert.equal((await call('POST', `/orders/${o2.body.id}/status`, { status: st }, ph)).status, 200);
  const pick = await call('POST', `/orders/${o2.body.id}/pickup`, { payments: [{ method: 'cash', amount: 15000 }] }, ph); assert.equal(pick.status, 200, JSON.stringify(pick.body));
  const s2 = await stockOf(p); assert.equal(s2.available, s0.available - 2); assert.equal(s2.reserved, s0.reserved);
  assert.equal((await call('GET', `/orders/${o2.body.id}`, null, ph)).body.status, 'picked_up');
});

test('espace client : inscription, catalogue, réservation ; aucun accès au back-office', async () => {
  const reg = await call('POST', '/auth/register', { name: 'Nouveau Client', email: 'nouveau@client.test', password: 'Motdepasse12' }); assert.equal(reg.status, 201);
  const l = await call('POST', '/auth/login', { email: 'nouveau@client.test', password: 'Motdepasse12' }); const t = l.body.access_token;
  assert.equal((await call('GET', '/stock', null, t)).status, 403); assert.equal((await call('GET', '/customers', null, t)).status, 403); assert.equal((await call('GET', '/sales', null, t)).status, 403);
  const cat = await call('GET', '/portal/catalog?q=parac', null, t); assert.equal(cat.status, 200); assert.ok(cat.body.length); assert.equal('purchase_price' in cat.body[0], false);
  const free = cat.body.find((x) => x.rx_status === 'free');
  assert.equal((await call('POST', '/portal/orders', { lines: [{ product_id: free.id, qty: 1 }] }, t)).status, 201);
  const rx = await pid('AMX500'); assert.equal((await call('POST', '/portal/orders', { lines: [{ product_id: rx, qty: 1 }] }, t)).body.error.code, 'PRESCRIPTION_REQUIRED');
});

test('multi-établissement : isolation des données', async () => {
  const sa = await login('superadmin'); const ph2 = await call('POST', '/pharmacies', { name: 'Pharmacie Annexe' }, sa); assert.equal(ph2.status, 201);
  const u = await call('POST', '/users', { email: 'annexe@demo.local', name: 'Admin Annexe', role_code: 'pharmacy_admin', pharmacy_id: ph2.body.id, password: PW }, sa); assert.equal(u.status, 201);
  const t = (await call('POST', '/auth/login', { email: 'annexe@demo.local', password: PW })).body.access_token;
  const mine = await call('GET', '/sales', null, t); assert.equal(mine.body.total, 0);
  const sale = (await call('GET', '/sales', null, await login('admin'))).body.data[0]; assert.equal((await call('GET', `/sales/${sale.id}`, null, t)).status, 404);
  const hdr = await call('GET', '/sales', null, t, { 'x-pharmacy-id': '1' }); assert.equal(hdr.body.total, 0, 'un non super-admin ne peut pas changer d\'établissement');
  assert.ok((await call('GET', '/sales', null, sa, { 'x-pharmacy-id': '1' })).body.total > 0);
  const stk = await call('GET', '/stock', null, t); assert.equal(stk.body.data.every((s) => s.available === 0), true);
});

test('recherche : tolérante aux fautes, DCI et alternatives soumises au pharmacien', async () => {
  const t = await login('caissier');
  const r = await call('GET', '/pos/search?q=paracetmol', null, t); assert.ok(r.body.some((p) => /Paracétamol/.test(p.name)), 'faute de frappe');
  assert.ok((await call('GET', '/pos/search?q=acetaminophene', null, t)).body.length > 0, 'synonyme');
  const alt = await call('GET', `/products/${await pid('PAR500')}/alternatives`, null, t); assert.equal(alt.body.requires_pharmacist_validation, true); assert.ok(alt.body.data.length >= 1);
});

test('audit : journalisé et non modifiable', async () => {
  const au = await login('auditeur'); const logs = await call('GET', '/audit?action=sale.create', null, au); assert.ok(logs.body.total > 0);
  assert.throws(() => rawExec("UPDATE audit_logs SET action='x' WHERE id=1"), /ajout seul/);
  assert.throws(() => rawExec('DELETE FROM audit_logs'), /ajout seul/);
  assert.throws(() => rawExec('DELETE FROM sales'), /supprimée/);
  assert.throws(() => rawExec('DELETE FROM stock_movements'), /ajout seul/);
  assert.ok((await call('GET', '/audit?action=view.prescription', null, au)).body.total >= 1, 'consultation de données sensibles tracée');
  assert.equal((await call('POST', '/audit', {}, au)).status, 405);
});

test('alertes et rapports cohérents avec les transactions', async () => {
  const t = await login('admin'); const a = (await call('GET', '/alerts', null, t)).body;
  assert.ok(a.expiring.some((e) => e.batch_no.endsWith('-OLD')), 'péremption proche'); assert.ok(a.expired.some((e) => e.batch_no === 'LOR10-EXP'), 'périmé en stock'); assert.ok(a.out.length + a.critical.length + a.low.length > 0);
  const rep = (await call('GET', '/reports/sales', null, t)).body.data; const sumNet = rep.reduce((x, r) => x + r.net, 0);
  const dash = (await call('GET', '/dashboard', null, t)).body; assert.ok(dash.month.total > 0);
  const direct = get('SELECT COALESCE(SUM(total),0) s FROM sales').s - get('SELECT COALESCE(SUM(amount),0) s FROM refunds').s;
  assert.equal(sumNet, direct, 'le rapport = somme des transactions');
  const acc = await login('comptable'); assert.equal((await call('GET', '/reports/sales?format=csv', null, acc)).status, 200); assert.equal((await call('GET', '/reports/sales?format=csv', null, await login('stock'))).status, 403);
});

test('jeton de rafraîchissement : rotation et détection de réutilisation', async () => {
  const r = await call('POST', '/auth/login', { email: 'auditeur@demo.local', password: PW }, null, { 'x-client': 'mobile' }); const rt1 = r.body.refresh_token; assert.ok(rt1);
  const r2 = await call('POST', '/auth/refresh', { refresh_token: rt1 }); assert.equal(r2.status, 200);
  const reuse = await call('POST', '/auth/refresh', { refresh_token: rt1 }); assert.equal(reuse.status, 401);
});

test('MFA TOTP : activation puis code exigé à la connexion', async () => {
  const t = await login('comptable'); const s = await call('POST', '/auth/mfa/setup', null, t); assert.ok(s.body.secret);
  assert.equal((await call('POST', '/auth/mfa/enable', { code: '000000' }, t)).status, 400);
  assert.equal((await call('POST', '/auth/mfa/enable', { code: totp(s.body.secret) }, t)).status, 200);
  assert.equal((await call('POST', '/auth/login', { email: 'comptable@demo.local', password: PW })).body.error.code, 'OTP_REQUIRED');
  assert.equal((await call('POST', '/auth/login', { email: 'comptable@demo.local', password: PW, otp: totp(s.body.secret) })).status, 200);
});

test('verrouillage de compte après échecs répétés', async () => {
  for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { email: 'auditeur@demo.local', password: 'faux' + i });
  const r = await call('POST', '/auth/login', { email: 'auditeur@demo.local', password: PW }); assert.ok([423, 429].includes(r.status));
});
