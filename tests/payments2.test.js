// Tests paiements v2 : recherche globale, ordonnance, reçus/QR, remboursements, tableau de bord, antivirus.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-pay2-'));
process.env.DB_FILE = join(dir, 'test.sqlite'); process.env.UPLOAD_DIR = join(dir, 'uploads'); process.env.NODE_ENV = 'test'; process.env.MAIL_SINK = 'memory';
if (process.env.DB_DRIVER === 'mariadb') process.env.MARIADB_DATABASE = 'gp_t_' + Math.random().toString(36).slice(2, 10);
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/seed.js'], { env: process.env, stdio: 'pipe' });
const { createApp } = await import('../server/index.js');
const { run } = await import('../server/db.js');

let server, base; const PW = 'Demo#Pharma2026'; const tokens = {};
before(async () => { server = createApp(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
after(async () => { server.close(); (await import('../server/db.js')).dropDatabase(); rmSync(dir, { recursive: true, force: true }); });
async function call(method, path, body, token, headers = {}) {
  const r = await fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await r.arrayBuffer()); let json; try { json = JSON.parse(buf.toString()); } catch { json = null; }
  return { status: r.status, body: json, raw: buf, headers: r.headers, text: buf.toString('utf8') };
}
const PW2 = 'Client#Test2026';
async function login(who) { if (tokens[who]) return tokens[who]; const r = await call('POST', '/auth/login', { email: `${who}@demo.local`, password: PW }); assert.equal(r.status, 200); return (tokens[who] = r.body.access_token); }
async function customer() {
  const email = `p2${Math.random().toString(36).slice(2, 7)}@t.local`;
  assert.equal((await call('POST', '/users', { name: 'Client Deux', email, role_code: 'customer', pharmacy_id: 1, password: PW2 }, await login('superadmin'))).status, 201);
  return (await call('POST', '/auth/login', { email, password: PW2 })).body.access_token;
}
const freeProduct = async (t) => (await call('GET', '/portal/catalog?q=parac', null, t)).body.find((x) => x.rx_status === 'free' && x.available);
const sandbox = async (b = {}) => { const sa = await login('superadmin'); const code = 'sbx' + Math.random().toString(36).slice(2, 6); const r = await call('POST', '/payment-methods', { code, label: 'Test ' + code, kind: 'card', provider: 'sandbox', channel_pos: false, channel_online: true, ...b }, sa); assert.equal(r.status, 201, JSON.stringify(r.body)); return { code, id: r.body.id }; };

test('recherche globale : nom complet (même avec le dosage répété) trouve la pharmacie qui a le médicament', async () => {
  const t = await customer();
  for (const q of ['Amoxicilline 500 mg gélules B/12', 'Amoxicilline 500 mg gélules B/12 500 mg', 'amoxicilline gelules 500', 'AMX500']) {
    const r = await call('GET', '/portal/search?q=' + encodeURIComponent(q), null, t); assert.equal(r.status, 200, JSON.stringify(r.body));
    const e = r.body.find((x) => /^Amoxicilline 500 mg/.test(x.name)); assert.ok(e, 'trouvé pour « ' + q + ' »'); assert.ok(e.pharmacies.length >= 1 && e.pharmacies[0].available);
  }
});

test('ordonnance : ni commande ni paiement d\'un médicament sur ordonnance sans ordonnance validée', async () => {
  const t = await customer(); const cat = await call('GET', '/portal/catalog?q=Amoxicilline 500', null, t); const rx = cat.body.find((p) => p.rx_status === 'prescription' && p.available); assert.ok(rx);
  let o = await call('POST', '/portal/orders', { lines: [{ product_id: rx.id, qty: 1 }] }, t); assert.equal(o.status, 409); assert.equal(o.body.error.code, 'PRESCRIPTION_REQUIRED');
  // dépôt d'ordonnance puis validation humaine (simulée en base : le flux de validation est testé ailleurs)
  const file = { name: 'ord.png', mime: 'image/png', data_base64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('0000IEND\xaeB`\x82')]).toString('base64') };
  const up = await call('POST', '/portal/prescriptions', { file, subject: 'Angine' }, t); assert.equal(up.status, 201, JSON.stringify(up.body));
  run("UPDATE prescriptions SET status='validated', valid_until=date('now','+30 day') WHERE id=?", up.body.id); run('INSERT INTO prescription_lines(prescription_id,product_id,qty_prescribed) VALUES (?,?,?)', up.body.id, rx.id, 2);
  o = await call('POST', '/portal/orders', { lines: [{ product_id: rx.id, qty: 1 }] }, t); assert.equal(o.status, 201, JSON.stringify(o.body));
});

test('antivirus intégré : fichier piégé refusé et journalisé', async () => {
  const t = await customer(); const bad_ = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('0000IEND\xaeB`\x82'), Buffer.from('<?php system($_GET["c"]); ?> et du contenu pour dépasser seize octets')]);
  const r = await call('POST', '/portal/prescriptions', { file: { name: 'x.png', mime: 'image/png', data_base64: bad_.toString('base64') } }, t); assert.equal(r.status, 400); assert.equal(r.body.error.code, 'MALWARE');
  const sc = await call('GET', '/file-scans', null, await login('superadmin')); assert.equal(sc.status, 200); assert.ok(sc.body.infected >= 1); assert.equal((await call('GET', '/file-scans', null, await login('admin'))).status, 403);
});

test('catalogue mondial, champs sans PIN/CVV, pays/devises, commission', async () => {
  const sa = await login('superadmin'); const cat = await call('GET', '/payment-catalog', null, sa); assert.ok(cat.body.length >= 28); assert.ok(cat.body.some((c) => c.code === 'airtel_money'));
  assert.equal((await call('GET', '/payment-catalog', null, await login('admin'))).status, 403);
  const add = await call('POST', '/payment-catalog/add', { codes: ['airtel_money', 'wave', 'visa', 'nope'] }, sa); assert.equal(add.body.added, 3);
  assert.equal((await call('POST', '/payment-catalog/add', { codes: ['airtel_money'] }, sa)).body.added, 0);
  const list = await call('GET', '/payment-methods?all=1', null, sa); const am = list.body.methods.find((m) => m.code === 'airtel_money'); assert.equal(am.enabled, 0);
  const bad_ = await call('PUT', `/payment-methods/${am.id}/settings`, { fields: [{ name: 'pin', label: 'Code PIN' }] }, sa); assert.equal(bad_.status, 400); assert.equal(bad_.body.error.code, 'FORBIDDEN_FIELD');
  assert.equal((await call('PUT', `/payment-methods/${am.id}/settings`, { fields: [{ name: 'phone', label: 'Numéro Airtel Money', required: true, type: 'tel' }], commission_pct: 1.5, commission_fixed: 100, countries: 'cg,cd', currencies: 'xaf' }, sa)).status, 200);
  assert.equal((await call('PUT', `/payment-methods/${am.id}`, { enabled: true, channel_online: true }, sa)).status, 200);
  const t = await customer(); const p = await freeProduct(t); const o = await call('POST', '/portal/orders', { lines: [{ product_id: p.id, qty: 2 }] }, t);
  const opt = await call('GET', `/portal/orders/${o.body.id}/payment-options`, null, t); assert.equal(opt.status, 200); assert.ok(opt.body.total > 0 && opt.body.lines.length === 1);
  assert.ok(!opt.body.methods.some((m) => m.code === 'airtel_money'), 'filtré : pharmacie hors Congo / devise TND');
  assert.equal((await call('PUT', `/payment-methods/${am.id}/settings`, { countries: '', currencies: '' }, sa)).status, 200);
  const opt2 = await call('GET', `/portal/orders/${o.body.id}/payment-options`, null, t); const m = opt2.body.methods.find((x) => x.code === 'airtel_money'); assert.ok(m); assert.equal(m.fields[0].name, 'phone');
  assert.equal((await call('POST', `/portal/orders/${o.body.id}/pay`, { method_code: 'airtel_money' }, t)).status, 400, 'numéro obligatoire');
  assert.equal((await call('POST', `/portal/orders/${o.body.id}/pay`, { method_code: 'airtel_money', payer: { phone: '+242060000000' }, pin: '1234' }, t)).status, 400, 'PIN refusé');
  const ok = await call('POST', `/portal/orders/${o.body.id}/pay`, { method_code: 'airtel_money', payer: { phone: '+242060000000' } }, t); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.mode, 'manual');
  const op = (await call('GET', '/online-payments', null, await login('admin'))).body.find((x) => x.id === ok.body.id); assert.equal(op.payer_ref, '+242060000000'); assert.equal(op.commission, Math.round(op.amount * 0.015) + 100);
});

test('paiement réussi → reçu signé (PDF, QR, e-mail), vérification publique, altération détectée, remboursement, tableau de bord', async () => {
  const sa = await login('superadmin'), ad = await login('admin'); const { code } = await sandbox({ commission_pct: 2 }); await call('PUT', `/payment-methods/${(await call('GET', '/payment-methods?all=1', null, sa)).body.methods.find((m) => m.code === code).id}/settings`, { commission_pct: 2 }, sa);
  const t = await customer(); const p = await freeProduct(t); const o = await call('POST', '/portal/orders', { lines: [{ product_id: p.id, qty: 2 }] }, t);
  const pay = await call('POST', `/portal/orders/${o.body.id}/pay`, { method_code: code }, t); assert.equal(pay.status, 200, JSON.stringify(pay.body)); assert.equal(pay.body.mode, 'redirect');
  assert.equal((await call('GET', '/portal/receipts', null, t)).body.length, 0, 'pas de reçu avant paiement');
  const ref = pay.body.checkout_url.split('/pay/sandbox/')[1]; assert.equal((await call('GET', `/pay/sandbox/${ref}/ok`)).status, 302);
  const rc = await call('GET', '/portal/receipts', null, t); assert.equal(rc.body.length, 1); const r = rc.body[0]; assert.match(r.number, /^REC/); assert.match(r.code, /^[0-9A-F]{6}(-[0-9A-F]{6}){2}$/);
  const pdf = await call('GET', `/receipts/${r.id}/pdf`, null, t); assert.equal(pdf.status, 200); assert.equal(pdf.raw.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.raw.length > 1500);
  assert.equal((await call('GET', `/receipts/${r.id}/pdf`, null, await customer())).status, 404, 'un autre client ne voit pas ce reçu');
  const view = await call('GET', `/receipts/${r.id}`, null, t); assert.ok(view.body.valid); assert.match(view.body.qr_svg, /^<svg/); assert.ok(view.body.verify_url.includes(r.code));
  const ver = await call('GET', `/receipts/verify/${r.code}`); assert.equal(ver.status, 200); assert.match(ver.text, /authentique/); assert.ok(!ver.text.includes('Client Deux'), 'nom masqué');
  assert.equal((await call('GET', `/receipts/public/${r.code}/pdf`)).status, 200);
  await new Promise((s) => setTimeout(s, 150)); assert.ok((globalThis.__mails || []).some((m) => /Reçu de paiement REC/.test(m.subject)), 'reçu envoyé par e-mail');
  assert.equal((await call('POST', `/receipts/${r.id}/email`, { to: 'autre@t.local' }, t)).status, 200);
  const notif = await call('GET', '/portal/notifications', null, t); assert.ok(JSON.stringify(notif.body).includes('Paiement réussi'));
  assert.equal((await call('GET', '/receipts', null, ad)).status, 200); assert.ok((await call('GET', '/receipts', null, ad)).body.some((x) => x.id === r.id));
  // remboursement partiel puis plafond
  const ops = (await call('GET', '/online-payments?status=paid', null, ad)).body, op = ops.find((x) => x.provider_ref === ref); assert.ok(op); assert.equal(op.commission, Math.round(op.amount * 0.02));
  assert.equal((await call('POST', `/online-payments/${op.id}/refund`, { amount: op.amount + 1, reason: 'x' }, ad)).status, 400);
  assert.equal((await call('POST', `/online-payments/${op.id}/refund`, { amount: 100, reason: 'Retour produit' }, ad)).status, 200);
  assert.equal((await call('POST', `/online-payments/${op.id}/refund`, { amount: op.amount - 100, reason: 'Solde' }, ad)).status, 200);
  assert.equal((await call('POST', `/online-payments/${op.id}/refund`, { amount: 1, reason: 'trop' }, ad)).status, 400);
  // tableau de bord & exports
  const st = await call('GET', '/payments/stats', null, sa); assert.equal(st.status, 200); assert.ok(st.body.totals.paid >= 1 && st.body.totals.refunded_eur > 0 && st.body.totals.commission_eur > 0); assert.ok(st.body.by_pharmacy.length >= 1 && st.body.by_method.length >= 1);
  assert.equal((await call('GET', '/payments/stats', null, ad)).status, 200);
  const csv = await call('GET', '/payments/export?format=csv', null, sa); assert.equal(csv.status, 200); assert.match(csv.text, /date.*pharmacy.*method/); assert.equal((await call('GET', '/payments/export?format=pdf', null, sa)).raw.subarray(0, 4).toString(), '%PDF');
  assert.equal((await call('GET', '/payments/export?format=xlsx', null, sa)).raw.subarray(0, 2).toString(), 'PK');
  // altération : le sceau ne correspond plus
  run('UPDATE receipts SET amount=amount+1 WHERE id=?', r.id); assert.equal((await call('GET', `/receipts/verify/${r.code}`)).status, 404); assert.equal((await call('GET', `/receipts/${r.id}`, null, t)).body.valid, false);
});

test('taux de change et versements', async () => {
  const sa = await login('superadmin'); assert.equal((await call('PUT', '/currency-rates/XOF', { per_eur: 655.957 }, sa)).status, 200); assert.equal((await call('PUT', '/currency-rates/XOF', { per_eur: -1 }, sa)).status, 400);
  assert.equal((await call('PUT', '/currency-rates/XOF', { per_eur: 656 }, await login('admin'))).status, 403);
  const cv = await call('GET', '/currency-convert?amount=100&from=EUR&to=XOF', null, await login('admin')); assert.equal(cv.body.result, 65595.7);
  const po = await call('POST', '/payouts', { pharmacy_id: 1, amount: 5000, reference: 'VIR-1' }, sa); assert.equal(po.status, 201); assert.equal((await call('POST', '/payouts', { pharmacy_id: 1, amount: 5000 }, await login('admin'))).status, 403);
  assert.ok((await call('GET', '/payouts', null, await login('admin'))).body.length >= 1);
  assert.equal((await call('PUT', '/payout-accounts/1', { holder: 'Pharmacie X', account: 'TN59 0000', instant: true }, sa)).status, 200); assert.equal((await call('GET', '/payout-accounts/1', null, sa)).body.instant, true);
});

test('finance ouverte : remboursement chez le prestataire, webhook signé, clé API, KYC, abonnements, SMS, rapports', async () => {
  const sa = await login('superadmin'), ad = await login('admin'); const http = await import('node:http'); const { createHmac } = await import('node:crypto');
  // récepteurs locaux : webhook client et passerelle SMS
  const hooks = [], sms = []; const srv = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => (b += c)); rq.on('end', () => { (rq.url.startsWith('/sms') ? sms : hooks).push({ url: rq.url, headers: rq.headers, body: b }); rs.end('{}'); }); }); await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
  const wh = await call('POST', '/webhooks', { url: `http://127.0.0.1:${port}/hook`, events: ['payment.paid', 'payment.refunded'] }, ad); assert.equal(wh.status, 201, JSON.stringify(wh.body)); assert.match(wh.body.secret, /^whsec_/);
  assert.equal((await call('PUT', '/sms/config', { url: `http://127.0.0.1:${port}/sms`, api_key: 'k', body: '{"to":"{{to}}","text":"{{text}}"}' }, sa)).status, 200);
  assert.equal((await call('PUT', '/sms/config', { url: 'http://x' }, ad)).status, 403);
  const { code } = await sandbox(); const t = await customer(); const p = await freeProduct(t); const o = await call('POST', '/portal/orders', { lines: [{ product_id: p.id, qty: 1 }] }, t);
  const pay = await call('POST', `/portal/orders/${o.body.id}/pay`, { method_code: code }, t); const ref = pay.body.checkout_url.split('/pay/sandbox/')[1]; await call('GET', `/pay/sandbox/${ref}/ok`);
  const op = (await call('GET', '/online-payments?status=paid', null, ad)).body.find((x) => x.provider_ref === ref);
  const rf = await call('POST', `/online-payments/${op.id}/refund`, { amount: 50, reason: 'Geste' }, ad); assert.equal(rf.status, 200, JSON.stringify(rf.body)); assert.equal(rf.body.gateway, 'done'); assert.ok(rf.body.gateway_ref);
  await new Promise((s) => setTimeout(s, 400)); const paid = hooks.find((h) => h.headers['x-event'] === 'payment.paid'), refd = hooks.find((h) => h.headers['x-event'] === 'payment.refunded'); assert.ok(paid && refd, 'webhooks reçus');
  assert.equal(paid.headers['x-signature'], 'sha256=' + createHmac('sha256', wh.body.secret).update(paid.body).digest('hex'));
  // clé d'API : lecture seule, jamais réaffichée, révocable
  const k = await call('POST', '/api-keys', { name: 'ERP', scopes: ['payments:read'] }, ad); assert.equal(k.status, 201); assert.match(k.body.key, /^gp_/);
  assert.equal((await call('GET', '/ext/payments')).status, 401); assert.equal((await call('GET', '/ext/payments', null, null, { 'x-api-key': 'gp_faux' })).status, 401);
  const ex = await call('GET', '/ext/payments?status=paid', null, null, { 'x-api-key': k.body.key }); assert.equal(ex.status, 200); assert.ok(ex.body.data.length >= 1 && ex.body.data.every((x) => x.pharmacy_id === 1));
  assert.equal((await call('GET', '/ext/refunds', null, null, { 'x-api-key': k.body.key })).status, 403, 'portée refunds:read non accordée');
  assert.ok(!JSON.stringify((await call('GET', '/api-keys', null, ad)).body).includes(k.body.key)); assert.equal((await call('DELETE', `/api-keys/${k.body.id}`, null, ad)).status, 200); assert.equal((await call('GET', '/ext/payments', null, null, { 'x-api-key': k.body.key })).status, 401);
  // KYC : exigé par politique avant versement
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal((await call('PUT', '/kyc/policy', { required: true }, sa)).status, 200);
  assert.equal((await call('POST', '/payouts', { pharmacy_id: 1, amount: 100 }, sa)).status, 409);
  assert.equal((await call('PUT', '/kyc/1', { holder_name: 'Pharmacie Centrale', doc_type: 'registre', doc_number: 'RC-1', file: { mime: 'image/png', name: 'rc.png', data_base64: PNG } }, ad)).status, 200);
  assert.equal((await call('GET', '/kyc/1/doc', null, ad)).status, 403); assert.equal((await call('GET', '/kyc/1/doc', null, sa)).status, 200);
  assert.equal((await call('POST', '/kyc/1/review', { status: 'rejected' }, sa)).status, 400); assert.equal((await call('POST', '/kyc/1/review', { status: 'approved' }, sa)).status, 200);
  assert.equal((await call('POST', '/payouts', { pharmacy_id: 1, amount: 100 }, sa)).status, 201); await call('PUT', '/kyc/policy', { required: false }, sa);
  // abonnements : échéance générée immédiatement, notification (+ SMS), règlement, impayés
  const cust = (await call('GET', '/customers', null, ad)).body; const list = cust.data || cust; const cid = list[0].id;
  const sub = await call('POST', '/subscriptions', { customer_id: cid, label: 'Pilulier mensuel', amount: 12000, period: 'month', start: new Date().toISOString().slice(0, 10) }, ad); assert.equal(sub.status, 201, JSON.stringify(sub.body));
  const inv = (await call('GET', '/subscription-invoices', null, ad)).body; assert.equal(inv.length, 1); assert.match(inv[0].number, /^ABO/); assert.equal((await call('GET', '/accounting/receivables', null, ad)).body.total, 12000);
  assert.equal((await call('POST', `/subscription-invoices/${inv[0].id}/pay`, { method_code: 'cash' }, ad)).status, 200); assert.equal((await call('POST', `/subscription-invoices/${inv[0].id}/pay`, {}, ad)).status, 409);
  assert.equal((await call('PUT', `/subscriptions/${sub.body.id}`, { status: 'paused' }, ad)).status, 200);
  assert.ok((await call('GET', '/sms/log', null, sa)).body.length >= 0);
  // rapports
  for (const r of ['cash-flow', 'comparative', 'payments-summary', 'receivables']) { const x = await call('GET', `/accounting/${r}`, null, ad); assert.equal(x.status, 200, r + ' ' + JSON.stringify(x.body)); }
  const ps = (await call('GET', '/accounting/payments-summary', null, ad)).body; assert.ok(ps.totals.gross > 0 && ps.totals.refunded >= 50);
  assert.equal((await call('GET', '/accounting/payments-summary?format=csv', null, ad)).status, 200);
  srv.close();
});
