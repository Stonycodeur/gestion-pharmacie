// Tests du mode hors connexion (vente différée, contrôle du total, instantané catalogue) et de l'identité visuelle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-off-'));
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

test('instantané catalogue + identité visuelle publique', async () => {
  await openCash('caissier'); const c = await login('caissier');
  const snap = await call('GET', '/pos/snapshot', null, c); assert.equal(snap.status, 200); assert.ok(snap.body.products.length > 5); assert.ok('sellable' in snap.body.products[0]);
  assert.equal((await call('GET', '/pos/snapshot')).status, 401);
  const b = await call('GET', '/branding'); assert.equal(b.status, 200); assert.match(b.body.color, /^#[0-9a-f]{6}$/i);
  const adm = await login('admin');
  assert.equal((await call('PUT', '/settings', { brand_color: 'rouge' }, adm)).status, 400);
  assert.equal((await call('PUT', '/settings', { brand_color: '#2563eb', brand_name: 'Pharmacie Test' }, adm)).status, 200);
  const b2 = await call('GET', '/branding'); assert.equal(b2.body.color, '#2563eb'); assert.equal(b2.body.name, 'Pharmacie Test');
});
test('vente hors ligne : offline_at conservé, total attendu contrôlé, rejeu idempotent', async () => {
  await openCash('caissier'); const c = await login('caissier'); const p = await pid('PAR500');
  const prod = (await call('GET', '/products/' + p, null, c)).body;
  const body = (k, total) => ({ idempotency_key: k, offline_at: new Date(Date.now() - 3600e3).toISOString(), expected_total: total, lines: [{ product_id: p, qty: 2, discount: 0 }], payments: [{ method: 'cash', amount: total }] });
  const bad = await call('POST', '/sales', body('off-bad-1', prod.sale_price * 2 + 5), c); assert.equal(bad.status, 409); assert.equal(bad.body.error.code, 'TOTAL_MISMATCH');
  const ok = await call('POST', '/sales', body('off-ok-1', prod.sale_price * 2), c); assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.total, prod.sale_price * 2);
  const again = await call('POST', '/sales', body('off-ok-1', prod.sale_price * 2), c); assert.ok([200, 201].includes(again.status)); assert.equal(again.body.id, ok.body.id, 'rejeu = même vente');
  assert.equal((await call('POST', '/sales', { ...body('off-bad-2', 1), offline_at: 'pas-une-date' }, c)).status, 400);
});
