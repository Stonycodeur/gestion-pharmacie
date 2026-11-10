// Tests de l'administration complète des comptes par le super-administrateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-rfq-'));
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
process.env.MAIL_SINK = 'memory';
async function login(who) { if (tokens[who]) return tokens[who]; const r = await call('POST', '/auth/login', { email: `${who}@demo.local`, password: PW }); assert.equal(r.status, 200); return (tokens[who] = r.body.access_token); }
test('demande de prix : envoi, devis, comparatif, attribution au meilleur prix', async () => {
  const st = await login('stock'), ad = await login('admin'), cs = await login('caissier');
  const sA = (await call('POST', '/suppliers', { name: 'Grossiste A', email: 'a@gros.test' }, st)).body.id, sB = (await call('POST', '/suppliers', { name: 'Grossiste B' }, st)).body.id;
  const prods = (await call('GET', '/products?limit=3', null, st)).body.data; assert.ok(prods.length >= 2);
  assert.equal((await call('GET', '/rfqs', null, cs)).status, 403);
  const rfq = await call('POST', '/rfqs', { title: 'Réassort hiver', lines: [{ product_id: prods[0].id, qty: 50 }, { product_id: prods[1].id, qty: 20 }], supplier_ids: [sA, sB] }, st); assert.equal(rfq.status, 201, JSON.stringify(rfq.body)); const id = rfq.body.id;
  assert.equal((await call('PUT', `/rfqs/${id}/quotes`, { supplier_id: sA, prices: { 1: 100 } }, st)).status, 409); // pas encore envoyée
  const sent = await call('POST', `/rfqs/${id}/send`, {}, st); assert.equal(sent.status, 200); assert.equal(sent.body.mailed, 1); assert.deepEqual(sent.body.to_contact_manually, ['Grossiste B']);
  assert.ok(globalThis.__mails.some((m) => m.to === 'a@gros.test' && /Demande de prix/.test(m.subject)));
  const d = (await call('GET', `/rfqs/${id}`, null, st)).body; const [l1, l2] = d.lines;
  assert.equal((await call('PUT', `/rfqs/${id}/quotes`, { supplier_id: sA, lead_days: 2, prices: { [l1.id]: 900, [l2.id]: 500 } }, st)).status, 200);
  assert.equal((await call('PUT', `/rfqs/${id}/quotes`, { supplier_id: sB, lead_days: 1, prices: { [l1.id]: 950, [l2.id]: 400 } }, st)).status, 200);
  assert.equal((await call('PUT', `/rfqs/${id}/quotes`, { supplier_id: sB, prices: { 99999: 1 } }, st)).status, 400);
  const c = (await call('GET', `/rfqs/${id}`, null, st)).body; assert.equal(c.best[l1.id], sA); assert.equal(c.best[l2.id], sB);
  assert.equal(c.suppliers.find((s) => s.supplier_id === sA).total, 900 * 50 + 500 * 20);
  const aw = await call('POST', `/rfqs/${id}/award`, { mode: 'best' }, st); assert.equal(aw.status, 201, JSON.stringify(aw.body)); assert.equal(aw.body.purchase_orders.length, 2);
  const po = (await call('GET', '/purchase-orders/' + aw.body.purchase_orders[0].id, null, st)).body; assert.equal(po.status, 'draft'); assert.ok(po.lines[0].unit_cost > 0);
  assert.equal((await call('POST', `/rfqs/${id}/award`, { mode: 'best' }, st)).status, 409); assert.equal((await call('GET', `/rfqs/${id}`, null, st)).body.status, 'closed');
  void ad;
});
test('demande de prix : attribution à un fournisseur exige un devis complet', async () => {
  const st = await login('stock'); const sup = (await call('POST', '/suppliers', { name: 'Grossiste C' }, st)).body.id; const prods = (await call('GET', '/products?limit=2', null, st)).body.data;
  const id = (await call('POST', '/rfqs', { title: 'Test partiel', lines: prods.map((p) => ({ product_id: p.id, qty: 5 })), supplier_ids: [sup] }, st)).body.id; await call('POST', `/rfqs/${id}/send`, {}, st);
  const l = (await call('GET', `/rfqs/${id}`, null, st)).body.lines; await call('PUT', `/rfqs/${id}/quotes`, { supplier_id: sup, prices: { [l[0].id]: 100 } }, st);
  assert.equal((await call('POST', `/rfqs/${id}/award`, { mode: 'single', supplier_id: sup }, st)).body.error.code, 'INCOMPLETE_QUOTE');
  assert.equal((await call('POST', `/rfqs/${id}/award`, { mode: 'best' }, st)).body.error.code, 'NO_QUOTE');
});
