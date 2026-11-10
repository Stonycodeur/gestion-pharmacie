// Tests des fonctions complémentaires : transferts, fournisseurs, acomptes, crédit, clôture de période, exports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-feat-'));
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
async function login(who) { if (tokens[who]) return tokens[who]; const r = await call('POST', '/auth/login', { email: `${who}@demo.local`, password: PW }); assert.equal(r.status, 200); return (tokens[who] = r.body.access_token); }
const pid = async (sku) => (await call('GET', `/products?q=${sku}`, null, await login('admin'))).body.data.find((p) => p.sku === sku).id;
const avail = async (id, ph = 1) => (await call('GET', `/stock?q=${(await call('GET', '/products/' + id, null, await login('admin'))).body.sku}`, null, await login('superadmin'), { 'x-pharmacy-id': String(ph) })).body.data.find((s) => s.id === id)?.available ?? 0;
const regs = {};
async function openCash(who) {
  const t = await login(who); const cur = await call('GET', '/cash/current', null, t); if (cur.body) return;
  regs[who] ||= (await call('POST', '/cash/registers', { name: 'C-' + who }, await login('admin'))).body.id;
  assert.equal((await call('POST', '/cash/open', { register_id: regs[who], opening_float: 100000 }, t)).status, 201);
}

test('transferts : expédition FEFO, réception avec écart justifié, annulation rend le stock', async () => {
  const sa = await login('superadmin');
  const ph2 = await call('POST', '/pharmacies', { name: 'Pharmacie Nord (test)', currency: 'TND', currency_decimals: 3 }, sa); assert.equal(ph2.status, 201, JSON.stringify(ph2.body));
  const p = await pid('PAR500'); const a1 = await avail(p, 1), b1 = await avail(p, ph2.body.id);
  const adm = await login('admin');
  assert.equal((await call('POST', '/transfers', { to_pharmacy_id: 1, lines: [{ product_id: p, qty: 1 }] }, adm)).status, 400, 'pas de transfert vers soi-même');
  const t = await call('POST', '/transfers', { to_pharmacy_id: ph2.body.id, lines: [{ product_id: p, qty: 10 }] }, adm); assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(await avail(p, 1), a1 - 10);
  const det = (await call('GET', `/transfers/${t.body.id}`, null, adm)).body; assert.equal(det.status, 'shipped');
  const rcv = (path, body) => call('POST', path, body, sa, { 'x-pharmacy-id': String(ph2.body.id) });
  assert.equal((await call('POST', `/transfers/${t.body.id}/receive`, {}, adm)).status, 403, 'seul le destinataire réceptionne');
  const gap = await rcv(`/transfers/${t.body.id}/receive`, { lines: det.lines.map((l) => ({ line_id: l.id, qty_received: l.qty - 1 })) });
  assert.equal(gap.body.error.code, 'REASON_REQUIRED');
  assert.equal(await avail(p, ph2.body.id), b1, 'rien reçu tant que l\'écart n\'est pas justifié (transaction annulée)');
  const ok = await rcv(`/transfers/${t.body.id}/receive`, { note: 'colis ouvert', lines: det.lines.map((l) => ({ line_id: l.id, qty_received: l.qty - 1 })) }); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.short, 1);
  assert.equal(await avail(p, ph2.body.id), b1 + 9);
  assert.equal((await rcv(`/transfers/${t.body.id}/receive`, {})).status, 409, 'double réception impossible');
  const t2 = await call('POST', '/transfers', { to_pharmacy_id: ph2.body.id, lines: [{ product_id: p, qty: 3 }] }, adm); const mid = await avail(p, 1);
  assert.equal((await call('POST', `/transfers/${t2.body.id}/cancel`, { reason: 'erreur de saisie' }, adm)).status, 200);
  assert.equal(await avail(p, 1), mid + 3);
});

test('fournisseurs : retour → avoir, solde, paiement plafonné au solde', async () => {
  const st = await login('stock'), cpt = await login('comptable'), adm = await login('admin');
  const p = await pid('GEL100'); const sup = (await call('GET', '/suppliers', null, st)).body.data[0];
  const rec = await call('POST', '/goods-receipts', { supplier_id: sup.id, supplier_invoice_ref: 'F-X', lines: [{ product_id: p, qty: 20, batch_no: 'GEL-RET', exp_date: '2030-06-30', unit_cost: 1000 }] }, st); assert.equal(rec.status, 201, JSON.stringify(rec.body));
  const bal = async () => (await call('GET', `/suppliers/${sup.id}/statement`, null, cpt)).body;
  const b0 = await bal(); assert.equal(b0.bought >= 20000, true);
  const batch = (await call('GET', `/stock/batches?product_id=${p}`, null, adm)).body.find((l) => l.batch_no === 'GEL-RET'); const a0 = await avail(p);
  const r = await call('POST', '/supplier-returns', { supplier_id: sup.id, reason: 'emballage endommagé', lines: [{ batch_id: batch.batch_id, qty: 5 }] }, st); assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await avail(p), a0 - 5);
  assert.equal((await call('POST', `/supplier-returns/${r.body.id}/credit`, { credit_amount: 5000, credit_note_ref: 'AV-77' }, st)).status, 200);
  assert.equal((await bal()).balance, b0.balance - 5000);
  assert.equal((await call('POST', `/supplier-returns/${r.body.id}/cancel`, { reason: 'x y z' }, st)).status, 409, 'un retour avoiré ne s\'annule pas');
  const r2 = await call('POST', '/supplier-returns', { supplier_id: sup.id, reason: 'erreur', lines: [{ batch_id: batch.batch_id, qty: 2 }] }, st);
  assert.equal((await call('POST', `/supplier-returns/${r2.body.id}/cancel`, { reason: 'annulé par erreur' }, st)).status, 200); assert.equal(await avail(p), a0 - 5, 'stock restitué');
  const cur = (await bal()).balance;
  assert.equal((await call('POST', '/supplier-payments', { supplier_id: sup.id, amount: cur + 1 }, cpt)).body.error.code, 'OVERPAYMENT');
  assert.equal((await call('POST', '/supplier-payments', { supplier_id: sup.id, amount: 1000, reference: 'VIR-1' }, cpt)).status, 201);
  assert.equal((await bal()).balance, cur - 1000);
  assert.equal((await call('POST', '/supplier-payments', { supplier_id: sup.id, amount: 1 }, st)).status, 403);
});

test('crédit client : désactivé par défaut, plafonné, règlement du solde, retour réduit le solde dû', async () => {
  const adm = await login('admin'), ph = await login('pharmacien'); await openCash('pharmacien');
  const cust = (await call('GET', '/customers', null, ph)).body.data[0]; const p = await pid('PAR500');
  const sale = { customer_id: cust.id, allow_credit: true, lines: [{ product_id: p, qty: 5 }], payments: [{ method: 'cash', amount: 2000 }] }; // total 6000
  assert.equal((await call('POST', '/sales', sale, ph)).body.error.code, 'UNDERPAID', 'crédit désactivé par défaut');
  assert.equal((await call('PUT', '/settings', { credit_limit: 10000 }, adm)).status, 200);
  const s = await call('POST', '/sales', sale, ph); assert.equal(s.status, 201, JSON.stringify(s.body)); assert.equal(s.body.paid, 2000); assert.equal(s.body.balance_due, 4000);
  assert.equal((await call('POST', '/sales', { ...sale, lines: [{ product_id: p, qty: 20 }], payments: [] }, ph)).body.error.code, 'CREDIT_LIMIT');
  assert.equal((await call('POST', '/sales', { ...sale, customer_id: undefined }, ph)).body.error.code, 'UNDERPAID', 'crédit réservé aux clients identifiés');
  assert.equal((await call('GET', `/customers/${cust.id}/balance`, null, ph)).body.balance >= 4000, true);
  const pay = await call('POST', `/customers/${cust.id}/payments`, { amount: 1000, method: 'cash' }, ph); assert.equal(pay.status, 201, JSON.stringify(pay.body));
  const left = pay.body.balance; assert.equal((await call('POST', `/customers/${cust.id}/payments`, { amount: left + 1 }, ph)).body.error.code, 'OVERPAYMENT');
  // retour de 2 boîtes (2400) sur une vente dont 3000 restent dus : rien à rendre en espèces, le solde baisse
  const full = await call('GET', `/sales/${s.body.id}`, null, ph); const line = full.body.lines[0];
  const rf = await call('POST', `/sales/${s.body.id}/refund`, { reason: 'retour client', method: 'cash', lines: [{ sale_line_id: line.id, qty: 2 }] }, ph); assert.equal(rf.status, 201, JSON.stringify(rf.body));
  assert.equal(rf.body.cash_returned, 0); assert.equal(rf.body.sale.balance_due, 4000 - 1000 - 2400 > 0 ? 4000 - 1000 - 2400 : 0);
  await call('PUT', '/settings', { credit_limit: 0 }, adm);
});

test('acomptes : encaissés en caisse, imputés au retrait, remboursables si annulation', async () => {
  const ph = await login('pharmacien'); await openCash('pharmacien');
  const cust = (await call('GET', '/customers', null, ph)).body.data[0]; const p = await pid('VITC');
  const mk = async (qty) => { const o = await call('POST', '/orders', { customer_id: cust.id, kind: 'order', lines: [{ product_id: p, qty }] }, ph); assert.equal(o.status, 201); return o.body.id; };
  const cashNow = async () => (await call('GET', '/cash/current', null, ph)).body.expected_cash;
  const o = await mk(2); const c0 = await cashNow();
  const d = await call('POST', `/orders/${o}/deposit`, { amount: 3000, method: 'cash' }, ph); assert.equal(d.status, 201, JSON.stringify(d.body)); assert.equal(await cashNow(), c0 + 3000);
  assert.equal((await call('POST', `/orders/${o}/deposit`, { amount: 10 ** 9, method: 'cash' }, ph)).body.error.code, 'DEPOSIT_EXCEEDS_TOTAL');
  for (const st of ['confirmed', 'preparing', 'ready']) await call('POST', `/orders/${o}/status`, { status: st }, ph);
  const pick = await call('POST', `/orders/${o}/pickup`, { payments: [] }, ph); assert.equal(pick.status, 409, 'solde restant à payer'); // total > acompte
  const total = (await call('GET', `/orders/${o}/deposits`, null, ph)).body.order_value;
  const ok = await call('POST', `/orders/${o}/pickup`, { payments: [{ method: 'cash', amount: total - 3000 }] }, ph); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.paid, total);
  assert.equal(await cashNow(), c0 + total, 'l\'acompte n\'est pas compté deux fois');
  const o2 = await mk(1); await call('POST', `/orders/${o2}/deposit`, { amount: 500, method: 'cash' }, ph); const c1 = await cashNow();
  await call('POST', `/orders/${o2}/status`, { status: 'cancelled' }, ph);
  assert.equal((await call('POST', `/orders/${o2}/deposit/refund`, { reason: 'commande annulée' }, ph)).body.refunded, 500); assert.equal(await cashNow(), c1 - 500);
  assert.equal((await call('POST', `/orders/${o2}/deposit/refund`, { reason: 'commande annulée' }, ph)).status, 409, 'pas de double remboursement');
});

test('clôture de période : jours révolus seulement, plus de remboursement sur les ventes verrouillées', async () => {
  const adm = await login('admin'), cpt = await login('comptable'), ph = await login('pharmacien'); await openCash('pharmacien');
  const p = await pid('PAR500'); const s = await call('POST', '/sales', { lines: [{ product_id: p, qty: 1 }], payments: [{ method: 'cash', amount: 1200 }] }, ph); assert.equal(s.status, 201);
  const today = new Date().toISOString().slice(0, 10), yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  assert.equal((await call('POST', '/accounting/locks', { locked_until: today }, cpt)).body.error.code, 'PERIOD_OPEN');
  assert.equal((await call('POST', '/accounting/locks', { locked_until: yest }, await login('stock'))).status, 403, 'réservé à la comptabilité');
  run('UPDATE sales SET created_at = ? WHERE id = ?', yest + ' 10:00:00', s.body.id);
  run("UPDATE cash_sessions SET opened_at = ? WHERE status='open'", yest + ' 08:00:00');
  const own = await call('POST', '/accounting/locks', { locked_until: yest }, cpt);
  assert.equal(own.body.error?.code, 'OPEN_CASH_SESSIONS', 'une session ouverte hier ou avant bloque la clôture');
  run("UPDATE cash_sessions SET opened_at = ? WHERE status='open'", today + ' 01:00:00');
  const lock = await call('POST', '/accounting/locks', { locked_until: yest }, cpt); assert.equal(lock.status, 201, JSON.stringify(lock.body));
  assert.equal((await call('POST', '/accounting/locks', { locked_until: yest }, cpt)).body.error.code, 'ALREADY_LOCKED');
  const rf = await call('POST', `/sales/${s.body.id}/refund`, { reason: 'trop tard', method: 'cash', lines: [{ sale_line_id: s.body.lines[0].id, qty: 1 }] }, ph);
  assert.equal(rf.body.error.code, 'PERIOD_LOCKED');
  const z = await call('GET', `/accounting/z-report?date=${yest}`, null, cpt); assert.equal(z.status, 200); assert.equal(z.body.locked, true); assert.equal(z.body.sales.tickets >= 1, true);
});

test('exports : Excel, PDF et ticket PDF valides', async () => {
  const cpt = await login('comptable'), ph = await login('pharmacien');
  const x = await call('GET', '/reports/sales?format=xlsx', null, cpt); assert.equal(x.status, 200); assert.equal(x.raw.subarray(0, 2).toString(), 'PK');
  assert.equal(x.raw.includes(Buffer.from('xl/worksheets/sheet1.xml')), true);
  const pdf = await call('GET', '/reports/top-products?format=pdf', null, cpt); assert.equal(pdf.status, 200); assert.equal(pdf.raw.subarray(0, 5).toString(), '%PDF-'); assert.equal(pdf.raw.subarray(-6).toString().includes('%%EOF'), true);
  const sale = (await call('GET', '/sales', null, ph)).body.data[0];
  const t = await call('GET', `/sales/${sale.id}/pdf`, null, ph); assert.equal(t.status, 200); assert.equal(t.headers.get('content-type'), 'application/pdf'); assert.equal(t.raw.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await call('GET', '/reports/sales?format=pdf', null, await login('caissier'))).status, 403);
  const z = await call('GET', '/accounting/z-report?format=pdf', null, cpt); assert.equal(z.status, 200); assert.equal(z.raw.subarray(0, 5).toString(), '%PDF-');
});
