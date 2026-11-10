// Tests de l'administration complète des comptes par le super-administrateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pharma-acc-'));
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

const raw = (email, password) => call('POST', '/auth/login', { email, password });
const mk = async (b) => { const r = await call('POST', '/users', b, await login('superadmin')); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };

test('le super-admin voit, crée, modifie et suspend les comptes CLIENTS', async () => {
  const sa = await login('superadmin');
  const list = await call('GET', '/users?kind=customer', null, sa); assert.equal(list.status, 200); assert.ok(list.body.data.some((u) => u.email === 'client@demo.local'));
  const c = await mk({ name: 'Nadia Cliente', email: 'nadia@test.local', role_code: 'customer', pharmacy_id: 1, password: 'Client#Test2026' });
  assert.equal((await raw('nadia@test.local', 'Client#Test2026')).status, 200);
  const up = await call('PUT', '/users/' + c.id, { name: 'Nadia B.', email: 'nadia2@test.local', phone: '55 123 456' }, sa); assert.equal(up.status, 200, JSON.stringify(up.body));
  const det = await call('GET', '/users/' + c.id, null, sa); assert.equal(det.body.email, 'nadia2@test.local'); assert.ok(det.body.customer, 'fiche client liée'); assert.equal(det.body.password_hash, undefined);
  assert.equal((await call('PUT', '/users/' + c.id, { status: 'suspended', status_reason: 'impayé', suspended_until: '2020-01-01' }, sa)).status, 400, 'échéance passée refusée');
  assert.equal((await call('PUT', '/users/' + c.id, { status: 'suspended', status_reason: 'impayé' }, sa)).status, 200);
  const r = await raw('nadia2@test.local', 'Client#Test2026'); assert.equal(r.status, 403); assert.equal(r.body.error.code, 'ACCOUNT_DISABLED');
  assert.equal((await call('PUT', '/users/' + c.id, { status: 'active' }, sa)).status, 200); assert.equal((await raw('nadia2@test.local', 'Client#Test2026')).status, 200);
  assert.equal((await call('PUT', '/users/' + c.id, { role_code: 'stock_manager' }, sa)).status, 400, 'client ↔ personnel interdit');
});
test('suspension temporaire : expire seule ; motif conservé', async () => {
  const sa = await login('superadmin'); const u = await mk({ name: 'Temp', email: 'temp@test.local', role_code: 'stock_manager', pharmacy_id: 1, password: 'Temp#Test2026' });
  const future = new Date(Date.now() + 3600e3).toISOString();
  assert.equal((await call('PUT', '/users/' + u.id, { status: 'suspended', status_reason: 'congé', suspended_until: future }, sa)).status, 200);
  assert.equal((await raw('temp@test.local', 'Temp#Test2026')).status, 403);
  run("UPDATE users SET suspended_until='2020-01-01 00:00:00' WHERE id=?", u.id);
  assert.equal((await raw('temp@test.local', 'Temp#Test2026')).status, 200, 'réactivé automatiquement');
  assert.equal((await call('GET', '/users/' + u.id, null, sa)).body.status, 'active');
});
test('déverrouillage, mot de passe imposé, MFA, sessions', async () => {
  const sa = await login('superadmin'); const u = await mk({ name: 'Lock', email: 'lock@test.local', role_code: 'cashier', pharmacy_id: 1, password: 'Lock#Test2026' });
  for (let i = 0; i < 6; i++) await raw('lock@test.local', 'mauvais');
  assert.notEqual((await raw('lock@test.local', 'Lock#Test2026')).status, 200, 'verrouillé');
  assert.equal((await call('POST', `/users/${u.id}/unlock`, {}, sa)).status, 200); assert.equal((await raw('lock@test.local', 'Lock#Test2026')).status, 200);
  assert.equal((await call('POST', `/users/${u.id}/set-password`, { password: 'faible' }, sa)).status, 400);
  assert.equal((await call('POST', `/users/${u.id}/set-password`, { password: 'Nouveau#Pass2026' }, sa)).status, 200); assert.equal((await raw('lock@test.local', 'Nouveau#Pass2026')).status, 200);
  assert.equal((await call('POST', `/users/${u.id}/reset-mfa`, {}, sa)).status, 200); assert.equal((await call('POST', `/users/${u.id}/revoke-sessions`, {}, sa)).status, 200);
});
test('protections : soi-même, dernier super-admin, droits du pharmacien-admin', async () => {
  const sa = await login('superadmin'); const me = (await call('GET', '/auth/me', null, sa)).body.user;
  assert.equal((await call('DELETE', '/users/' + me.id, null, sa)).status, 403); assert.equal((await call('PUT', '/users/' + me.id, { status: 'disabled' }, sa)).status, 403);
  const second = await mk({ name: 'Second SA', email: 'sa2@test.local', role_code: 'super_admin', password: 'Second#Test2026' });
  const sa2 = (await raw('sa2@test.local', 'Second#Test2026')).body.access_token;
  assert.equal((await call('PUT', '/users/' + me.id, { status: 'disabled' }, sa2)).status, 200, 'le 2e peut désactiver le 1er');
  assert.equal((await call('DELETE', '/users/' + second.id, null, sa2)).status, 403, 'pas soi-même');
  assert.equal((await call('PUT', '/users/' + me.id, { status: 'active' }, sa2)).status, 200);
  assert.equal((await call('PUT', '/users/' + second.id, { status: 'disabled' }, sa)).status, 200);
  const adm = await login('admin'); const target = await mk({ name: 'X', email: 'x@test.local', role_code: 'cashier', pharmacy_id: 1, password: 'Xxxxx#Test2026' });
  assert.equal((await call('PUT', '/users/' + target.id, { email: 'y@test.local' }, adm)).status, 403, 'e-mail réservé au super-admin');
  assert.equal((await call('PUT', '/users/' + target.id, { pharmacy_id: 2 }, adm)).status, 403, 'changer d\'établissement : super-admin seulement');
  assert.equal((await call('DELETE', '/users/' + second.id, null, adm)).status, 403, 'un admin ne touche pas un super-admin');
});
test('suppression : définitive si vierge, anonymisation si historique ; actions groupées', async () => {
  const sa = await login('superadmin');
  const clean = await mk({ name: 'Vierge', email: 'vierge@test.local', role_code: 'cashier', pharmacy_id: 1, password: 'Vierge#Test2026' });
  const trashId = async (uid) => (await call('GET', '/trash?entity=user', null, sa)).body.items.find((x) => x.entity_id === uid).id;
  const d1x = await call('DELETE', '/users/' + clean.id, null, sa); assert.equal(d1x.body.mode, 'trashed'); const d1 = await call('DELETE', '/trash/' + await trashId(clean.id), null, sa); assert.equal(d1.status, 200); assert.equal(d1.body.mode, 'deleted'); assert.equal((await call('GET', '/users/' + clean.id, null, sa)).status, 404);
  await openCash('caissier'); const used = (await call('GET', '/users?q=caissier@demo.local', null, sa)).body.data[0];
  assert.equal((await call('DELETE', '/users/' + used.id, null, sa)).body.mode, 'trashed'); const d2 = await call('DELETE', '/trash/' + await trashId(used.id), null, sa); assert.equal(d2.status, 200); assert.equal(d2.body.mode, 'anonymized');
  const after = (await call('GET', '/users/' + used.id, null, sa)).body; assert.equal(after.status, 'deleted'); assert.match(after.email, /deleted\.invalid/); assert.equal((await raw('caissier@demo.local', 'Demo#Pharma2026')).status, 401);
  assert.equal((await call('GET', '/users?kind=staff', null, sa)).body.data.some((u) => u.id === used.id), false, 'masqué de la liste');
  const a = await mk({ name: 'B1', email: 'b1@test.local', role_code: 'cashier', pharmacy_id: 1, password: 'Bulk1#Test2026' }), b = await mk({ name: 'B2', email: 'b2@test.local', role_code: 'cashier', pharmacy_id: 1, password: 'Bulk2#Test2026' });
  const r = await call('POST', '/users-bulk', { ids: [a.id, b.id], action: 'suspend', reason: 'audit' }, sa); assert.equal(r.body.done, 2);
  assert.equal((await raw('b1@test.local', 'Bulk1#Test2026')).status, 403);
  assert.equal((await call('POST', '/users-bulk', { ids: [a.id, b.id], action: 'delete' }, sa)).body.done, 2);
});
test('établissements : désactivation bloque les comptes, suppression refusée si utilisé', async () => {
  const sa = await login('superadmin'); const ph = (await call('POST', '/pharmacies', { name: 'Annexe', currency: 'TND', currency_decimals: 3 }, sa)).body.id;
  const u = await mk({ name: 'Annexe U', email: 'annexe@test.local', role_code: 'pharmacy_admin', pharmacy_id: ph, password: 'Annexe#Test2026' });
  assert.equal((await raw('annexe@test.local', 'Annexe#Test2026')).status, 200);
  assert.equal((await call('POST', `/pharmacies/${ph}/status`, { status: 'disabled' }, sa)).status, 200);
  const r = await raw('annexe@test.local', 'Annexe#Test2026'); assert.equal(r.status, 403); assert.equal(r.body.error.code, 'PHARMACY_DISABLED');
  assert.equal((await call('DELETE', '/pharmacies/' + ph, null, sa)).status, 409, 'un compte y est rattaché');
  assert.equal((await call('DELETE', '/users/' + u.id, null, sa)).status, 200);
  assert.equal((await call('DELETE', '/pharmacies/' + ph, null, sa)).status, 409, 'toujours en corbeille');
  assert.equal((await call('DELETE', '/pharmacies/1', null, sa)).status, 409, 'établissement principal utilisé');
  const empty = (await call('POST', '/pharmacies', { name: 'Vide', currency: 'TND', currency_decimals: 3 }, sa)).body.id;
  assert.equal((await call('DELETE', '/pharmacies/' + empty, null, sa)).status, 200);
});
test('rôles personnalisés et référentiels', async () => {
  const sa = await login('superadmin');
  assert.equal((await call('POST', '/roles', { code: 'Bad Code', label: 'x' }, sa)).status, 400);
  assert.equal((await call('POST', '/roles', { code: 'auditeur_stock', label: 'Auditeur stock', permissions: ['stock.view', 'reports.view'] }, sa)).status, 201);
  const u = await mk({ name: 'Role U', email: 'roleu@test.local', role_code: 'auditeur_stock', pharmacy_id: 1, password: 'Roleu#Test2026' });
  const lg = await raw('roleu@test.local', 'Roleu#Test2026'); assert.equal(lg.status, 200); assert.ok(lg.body.permissions.includes('stock.view'));
  assert.equal((await call('DELETE', '/roles/auditeur_stock', null, sa)).status, 409, 'rôle utilisé');
  assert.equal((await call('DELETE', '/roles/cashier', null, sa)).status, 403, 'rôle intégré');
  await call('DELETE', '/users/' + u.id, null, sa); assert.equal((await call('DELETE', '/roles/auditeur_stock', null, sa)).status, 409, 'compte en corbeille');
  await call('DELETE', '/trash/' + (await call('GET', '/trash?entity=user', null, sa)).body.items.find((x) => x.entity_id === u.id).id, null, sa);
  assert.equal((await call('DELETE', '/roles/auditeur_stock', null, sa)).status, 200);
  const cat = (await call('POST', '/categories', { name: 'Test cat' }, sa)).body; assert.equal((await call('PUT', '/categories/' + cat.id, { name: 'Test cat 2' }, sa)).status, 200);
  assert.equal((await call('DELETE', '/categories/' + cat.id, null, sa)).status, 200);
  const used = (await call('GET', '/categories', null, sa)).body.find((c) => c.id); assert.equal((await call('DELETE', '/categories/' + used.id, null, sa)).status, 409, 'catégorie utilisée par des produits');
});
test('permissions individuelles : accorder/refuser par-dessus le rôle', async () => {
  const sa = await login('superadmin'); const u = await mk({ name: 'Perm', email: 'perm@test.local', role_code: 'cashier', pharmacy_id: 1, password: 'Perm#Test2026x' });
  const tok = async () => (await raw('perm@test.local', 'Perm#Test2026x')).body;
  assert.equal((await call('GET', '/audit', null, (await tok()).access_token)).status, 403);
  assert.equal((await call('PUT', `/users/${u.id}/permissions`, { overrides: { 'audit.view': 'grant', 'sales.create': 'deny' } }, sa)).status, 200);
  const t = await tok(); assert.ok(t.permissions.includes('audit.view')); assert.ok(!t.permissions.includes('sales.create'));
  assert.equal((await call('GET', '/audit', null, t.access_token)).status, 200, 'droit accordé à cette personne seulement');
  assert.equal((await call('POST', '/sales', { lines: [], payments: [] }, t.access_token)).status, 403, 'droit du rôle retiré');
  assert.equal((await call('PUT', `/users/${u.id}/permissions`, { overrides: { 'inconnu.x': 'grant' } }, sa)).status, 400);
  assert.equal((await call('PUT', `/users/${u.id}/permissions`, { overrides: { 'audit.view': null, 'sales.create': null } }, await login('admin'))).status, 403, 'réservé au super-admin');
  await call('PUT', `/users/${u.id}/permissions`, { overrides: { 'audit.view': null, 'sales.create': null } }, sa); assert.equal((await tok()).permissions.includes('audit.view'), false);
});
test('prise de contrôle : tracée, limitée, impossible sur un super-admin', async () => {
  const sa = await login('superadmin'); const cu = (await call('GET', '/users?kind=customer', null, sa)).body.data[0];
  const imp = await call('POST', `/users/${cu.id}/impersonate`, {}, sa); assert.equal(imp.status, 200); assert.equal(imp.body.user.role, 'customer');
  assert.equal((await call('GET', '/auth/me', null, imp.body.access_token)).body.user.email, cu.email);
  assert.equal((await call('POST', '/auth/change-password', { current: 'x', password: 'Aaaaaaaa#12345' }, imp.body.access_token)).status, 403);
  assert.equal((await call('POST', `/users/${cu.id}/set-password`, { password: 'Aaaaaaaa#12345' }, imp.body.access_token)).status, 403);
  assert.equal((await call('POST', `/users/${cu.id}/impersonate`, {}, imp.body.access_token)).status, 403);
  const me = (await call('GET', '/auth/me', null, sa)).body.user; assert.equal((await call('POST', `/users/${me.id}/impersonate`, {}, sa)).status, 403);
  assert.equal((await call('POST', `/users/${cu.id}/impersonate`, {}, await login('admin'))).status, 403, 'super-admin seulement');
  const log = (await call('GET', '/audit?action=user.impersonate', null, sa)).body.data; assert.ok(log.length >= 1);
});
