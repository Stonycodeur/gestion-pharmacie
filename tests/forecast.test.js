// Tests de l'administration complète des comptes par le super-administrateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-fc-'));
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
const { holt, analyse } = await import('../server/forecast.js');
async function login(who) { if (tokens[who]) return tokens[who]; const r = await call('POST', '/auth/login', { email: `${who}@demo.local`, password: PW }); assert.equal(r.status, 200); return (tokens[who] = r.body.access_token); }
test('Holt : suit une tendance croissante, reste positif, plat si constant', () => {
  const up = holt([10, 12, 14, 16, 18, 20, 22, 24], 4); assert.ok(up[0] > 24 && up[3] > up[0]);
  const flat = holt([10, 10, 10, 10, 10, 10], 3); assert.ok(flat.every((x) => Math.abs(x - 10) < 0.5));
  const down = holt([50, 30, 10, 4, 1, 0, 0], 4); assert.ok(down.every((x) => x >= 0)); assert.deepEqual(holt([], 3), [0, 0, 0]);
});
test('prévisions : API cohérente (suggestions, ABC, droits, RFQ depuis prévisions)', async () => {
  const st = await login('stock'), cs = await login('caissier'), ad = await login('admin');
  assert.equal((await call('GET', '/forecast/overview', null, cs)).status, 403);
  const ov = await call('GET', '/forecast/overview', null, st); assert.equal(ov.status, 200); assert.ok(ov.body.products > 0);
  const pr = (await call('GET', '/forecast/products?sort=name', null, st)).body; assert.ok(pr.data.length); for (const x of pr.data) { assert.ok(x.suggested >= 0 && x.forecast_qty >= 0 && ['A', 'B', 'C'].includes(x.abc)); assert.ok(x.on_hand >= 0); }
  const a = analyse(1, {}); assert.equal(a.items.length, pr.total);
  assert.equal((await call('GET', '/forecast/products?format=csv', null, st)).status, 403); assert.equal((await call('GET', '/forecast/products?format=csv', null, await login('comptable'))).status, 200);
  const sup = (await call('POST', '/suppliers', { name: 'Fournisseur prévisions' }, st)).body.id; const r = await call('POST', '/forecast/create-rfq', { supplier_ids: [sup] }, ad);
  if (a.items.some((x) => x.suggested > 0)) assert.equal(r.status, 201, JSON.stringify(r.body)); else assert.equal(r.status, 400);
});
