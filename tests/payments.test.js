// Tests de l'administration complète des comptes par le super-administrateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-pay-'));
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
import { createHmac } from 'node:crypto';
const PW2 = 'Client#Test2026';
async function login(who) { if (tokens[who]) return tokens[who]; const r = await call('POST', '/auth/login', { email: `${who}@demo.local`, password: PW }); assert.equal(r.status, 200); return (tokens[who] = r.body.access_token); }
const fake = (handler) => new Promise((res) => { const s = http.createServer(handler); s.listen(0, () => res({ s, url: `http://127.0.0.1:${s.address().port}` })); });
async function customerWithOrder() {
  const email = `pay${Math.random().toString(36).slice(2, 7)}@t.local`;
  assert.equal((await call('POST', '/users', { name: 'Client Pay', email, role_code: 'customer', pharmacy_id: 1, password: PW2 }, await login('superadmin'))).status, 201);
  const t = (await call('POST', '/auth/login', { email, password: PW2 })).body.access_token;
  const cat = await call('GET', '/portal/catalog?q=parac', null, t); const free = cat.body.find((x) => x.rx_status === 'free');
  const o = await call('POST', '/portal/orders', { lines: [{ product_id: free.id, qty: 2 }] }, t); assert.equal(o.status, 201);
  return { t, id: o.body.id };
}
const mkMethod = async (b) => { const r = await call('POST', '/payment-methods', b, await login('superadmin')); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id; };

test('modes de paiement : seul le super-admin configure ; secrets chiffrés et masqués', async () => {
  const sa = await login('superadmin'), ad = await login('admin');
  assert.equal((await call('POST', '/payment-methods', { code: 'x1', label: 'X', kind: 'card' }, ad)).status, 403);
  const id = await mkMethod({ code: 'stripe_t', label: 'Carte en ligne', kind: 'card', provider: 'stripe', config: { secret_key: 'sk_test_SECRET123', webhook_secret: 'whsec_abc' } });
  const list = await call('GET', '/payment-methods?all=1', null, sa); const m = list.body.methods.find((x) => x.id === id);
  assert.equal(JSON.stringify(list.body).includes('sk_test_SECRET123'), false); assert.equal(m.has_config.secret_key, true);
  assert.equal(JSON.stringify(await call('GET', '/payment-methods?all=1', null, ad)).includes('SECRET123'), false);
  const raw = (await import('../server/db.js')).get('SELECT config FROM payment_methods WHERE id=?', id).config; assert.equal(raw.includes('SECRET123'), false);
  assert.equal((await call('GET', `/payment-methods/${id}/reveal`, null, ad)).status, 403);
  assert.equal((await call('GET', `/payment-methods/${id}/reveal`, null, sa)).body.config.secret_key, 'sk_test_SECRET123');
  assert.equal((await call('POST', '/payment-methods', { code: 'bad', label: 'B', kind: 'card', provider: 'stripe', channel_pos: true }, sa)).status, 400);
  const pos = await call('GET', '/payment-methods?channel=pos', null, ad); assert.ok(pos.body.some((x) => x.code === 'cash')); assert.equal(pos.body.some((x) => x.code === 'stripe_t'), false);
  assert.equal((await call('DELETE', '/payment-methods/' + (list.body.methods.find((x) => x.code === 'cash').id), null, sa)).status, 403);
});

test('mode configuré utilisable en caisse (acompte) ; mode inconnu refusé', async () => {
  const sa = await login('superadmin'); await mkMethod({ code: 'edinar', label: 'e-DINAR', kind: 'wallet', provider: 'manual', channel_pos: true });
  const { id } = await customerWithOrder(); const ph = await login('pharmacien'); await call('POST', `/orders/${id}/confirm`, {}, ph);
  const cash = await login('caissier'); const regs = (await call('GET', '/cash/registers', null, cash)).body; let reg = regs[0]?.id; if (!reg) reg = (await call('POST', '/cash/registers', { name: 'P1' }, await login('admin'))).body.id;
  if (!(await call('GET', '/cash/current', null, cash)).body) assert.equal((await call('POST', '/cash/open', { register_id: reg, opening_float: 1000 }, cash)).status, 201);
  assert.equal((await call('POST', `/orders/${id}/deposit`, { amount: 100, method: 'bitcoin' }, cash)).status, 400);
  assert.equal((await call('POST', `/orders/${id}/deposit`, { amount: 100, method: 'edinar' }, cash)).status, 201);
  const d = (await call('GET', `/orders/${id}/deposits`, null, cash)).body.data[0]; assert.equal(d.method, 'wallet'); assert.equal(d.method_code, 'edinar');
  void sa;
});

test('paiement en ligne bac à sable : crédité uniquement après confirmation du prestataire', async () => {
  const id = await mkMethod({ code: 'sbx', label: 'Test', kind: 'card', provider: 'sandbox' }); void id;
  const { t, id: oid } = await customerWithOrder();
  const p = await call('POST', `/portal/orders/${oid}/pay`, { method_code: 'sbx' }, t); assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.mode, 'redirect');
  const before = await call('GET', `/portal/orders/${oid}/payments`, null, t); assert.equal(before.body.paid, 0);
  assert.equal((await call('POST', `/portal/orders/${oid}/pay`, { method_code: 'sbx' }, t)).status, 409); // déjà un paiement en cours pour la totalité
  const ref = new URL(p.body.checkout_url).pathname.split('/').pop();
  const page = await fetch(`${base}/pay/sandbox/${ref}`); assert.equal(page.status, 200);
  const ok = await fetch(`${base}/pay/sandbox/${ref}/ok`, { redirect: 'manual' }); assert.equal(ok.status, 302);
  const after = await call('GET', `/portal/orders/${oid}/payments`, null, t); assert.equal(after.body.paid, after.body.total); assert.equal(after.body.payments[0].status, 'paid');
  await fetch(`${base}/pay/sandbox/${ref}/ok`, { redirect: 'manual' }); assert.equal((await call('GET', `/portal/orders/${oid}/payments`, null, t)).body.paid, after.body.total); // idempotent
  const other = await customerWithOrder(); assert.equal((await call('POST', `/portal/orders/${oid}/pay`, { method_code: 'sbx' }, other.t)).status, 404); // pas la commande d'un autre
});

test('Stripe : session créée chez le prestataire, webhook signé obligatoire', async () => {
  let seen; const f = await fake((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { seen = { auth: req.headers.authorization, body: new URLSearchParams(b) }; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' })); }); });
  await mkMethod({ code: 'stripe_live', label: 'Carte', kind: 'card', provider: 'stripe', config: { secret_key: 'sk_test_k', webhook_secret: 'whsec_k', base_url: f.url } });
  const { t, id: oid } = await customerWithOrder();
  const p = await call('POST', `/portal/orders/${oid}/pay`, { method_code: 'stripe_live' }, t); assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.checkout_url, 'https://checkout.stripe.test/cs_test_1'); assert.equal(seen.auth, 'Bearer sk_test_k');
  const opId = Number(seen.body.get('client_reference_id'));
  const ev = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', client_reference_id: String(opId) } } });
  const sign = (body, secret, ts = Math.floor(Date.now() / 1000)) => `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
  const hook = (sig) => fetch(`${base}/payments/webhook/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'stripe-signature': sig } : {}) }, body: ev });
  assert.equal((await hook()).status, 403); assert.equal((await hook(sign(ev, 'mauvais'))).status, 403); assert.equal((await hook(sign(ev, 'whsec_k', 1000))).status, 403); // rejeu ancien
  assert.equal((await call('GET', `/portal/orders/${oid}/payments`, null, t)).body.paid, 0);
  assert.equal((await hook(sign(ev, 'whsec_k'))).status, 200); const r = await call('GET', `/portal/orders/${oid}/payments`, null, t); assert.equal(r.body.paid, r.body.total);
  f.s.close();
});

test('Konnect : le statut est relu chez le prestataire, jamais cru depuis la requête', async () => {
  let status = 'pending'; const f = await fake((req, res) => { res.setHeader('content-type', 'application/json'); if (req.method === 'POST') return res.end(JSON.stringify({ payUrl: 'https://pay.konnect.test/x', paymentRef: 'kref1' })); res.end(JSON.stringify({ payment: { status } })); });
  await mkMethod({ code: 'konnect_t', label: 'Konnect', kind: 'card', provider: 'konnect', config: { api_key: 'k', wallet_id: 'w', base_url: f.url } });
  const { t, id: oid } = await customerWithOrder(); const p = await call('POST', `/portal/orders/${oid}/pay`, { method_code: 'konnect_t' }, t); assert.equal(p.status, 200, JSON.stringify(p.body));
  await fetch(`${base}/payments/webhook/konnect?payment_ref=kref1&status=completed`); assert.equal((await call('GET', `/portal/orders/${oid}/payments`, null, t)).body.paid, 0);
  status = 'completed'; await fetch(`${base}/payments/webhook/konnect?payment_ref=kref1`); const r = await call('GET', `/portal/orders/${oid}/payments`, null, t); assert.equal(r.body.paid, r.body.total); f.s.close();
});

test('prestataire en panne : erreur propre, aucun crédit ; paiement manuel confirmé par le personnel', async () => {
  await mkMethod({ code: 'stripe_down', label: 'Carte', kind: 'card', provider: 'stripe', config: { secret_key: 'sk', base_url: 'http://127.0.0.1:1' } });
  const a = await customerWithOrder(); const p = await call('POST', `/portal/orders/${a.id}/pay`, { method_code: 'stripe_down' }, a.t); assert.equal(p.status, 502); assert.equal((await call('GET', `/portal/orders/${a.id}/payments`, null, a.t)).body.paid, 0);
  const b = await customerWithOrder(); const m = await call('POST', `/portal/orders/${b.id}/pay`, { method_code: 'transfer' }, b.t); assert.equal(m.body.mode, 'manual');
  const ph = await login('pharmacien'); assert.equal((await call('POST', `/online-payments/${m.body.id}/confirm`, {}, b.t)).status, 403);
  assert.equal((await call('POST', `/online-payments/${m.body.id}/confirm`, {}, ph)).status, 200); const r = await call('GET', `/portal/orders/${b.id}/payments`, null, b.t); assert.equal(r.body.paid, r.body.total);
  assert.equal((await call('POST', `/online-payments/${m.body.id}/confirm`, {}, ph)).status, 409);
});
