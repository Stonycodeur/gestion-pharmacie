// Démarrage à vide (sans démo) : première configuration, puis création des comptes réels.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'pharma-setup-'));
process.env.DB_FILE = join(dir, 'empty.sqlite'); process.env.UPLOAD_DIR = join(dir, 'up'); process.env.NODE_ENV = 'test';
if (process.env.DB_DRIVER === 'mariadb') process.env.MARIADB_DATABASE = 'gp_t_' + Math.random().toString(36).slice(2, 10);
const { createApp } = await import('../server/index.js');
let server, base;
before(async () => { server = createApp(); await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}/api/v1`; });
after(async () => { server.close(); (await import('../server/db.js')).dropDatabase(); rmSync(dir, { recursive: true, force: true }); });
const call = async (m, p, b, t) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };

test('base vide : aucun compte démo, setup possible une seule fois', async () => {
  assert.equal((await call('GET', '/auth/setup-status')).body.needed, true);
  assert.equal((await call('POST', '/auth/login', { email: 'admin@demo.local', password: 'Demo#Pharma2026' })).status, 401);
  assert.equal((await call('POST', '/auth/setup', { pharmacy: { name: 'P' }, admin: { name: 'A', email: 'a@x.io', password: 'faible' } })).body.error.code, 'WEAK_PASSWORD');
  assert.equal((await call('POST', '/auth/setup', { pharmacy: { name: 'Ma Pharmacie', currency: 'TND' }, admin: { name: 'Patron', email: 'patron@pharma.tn', password: 'MotDePasse123' } })).status, 201);
  assert.equal((await call('POST', '/auth/setup', { pharmacy: { name: 'Autre' }, admin: { name: 'Pirate', email: 'p@x.io', password: 'MotDePasse123' } })).status, 409);
  assert.equal((await call('GET', '/auth/setup-status')).body.needed, false);
});

test('création des vrais comptes et du catalogue à la main', async () => {
  const t = (await call('POST', '/auth/login', { email: 'patron@pharma.tn', password: 'MotDePasse123' })).body.access_token; assert.ok(t);
  const u = await call('POST', '/users', { email: 'sana@pharma.tn', name: 'Sana', role_code: 'pharmacist' }, t); assert.equal(u.status, 201); assert.ok(u.body.temporary_password);
  const c = await call('POST', '/categories', { name: 'Médicaments' }, t); assert.equal(c.status, 201);
  const p = await call('POST', '/products', { sku: 'P1', name: 'Produit 1', category_id: c.body.id, sale_price: 1500, purchase_price: 900 }, t); assert.equal(p.status, 201);
  const me = await call('GET', '/auth/me', null, t); assert.equal(me.body.pharmacy.name, 'Ma Pharmacie');
  assert.equal((await call('GET', '/cash/registers', null, t)).body.length, 1);
  const login = await call('POST', '/auth/login', { email: 'sana@pharma.tn', password: u.body.temporary_password }); assert.equal(login.body.user.must_change_password, true);
});
