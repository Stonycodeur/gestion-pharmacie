// Administration complète des comptes et des référentiels : déverrouillage, sessions, MFA, mot de passe, suppression,
// actions groupées, établissements (désactivation/suppression), rôles personnalisés, référentiels.
import { router, audit, can, config } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { bad, conflict, notFound, forbidden, str, oneOf } from '../util.js';
import { hashPassword, passwordPolicy, randomToken, signJwt } from '../security.js';
import { ROLES, PERMISSIONS, reloadPerms, userPerms, overridesOf, permsOf } from '../rbac.js';
import { loadUser } from './admin.js';
import { trashUser, moveToTrash } from './network.js';

const isSuper = (ctx) => ctx.user.role === 'super_admin';
const needSuper = (ctx) => { if (!isSuper(ctx)) throw forbidden('Réservé au super-administrateur'); };
const lastSuper = (id) => get("SELECT COUNT(*) n FROM users WHERE role_code='super_admin' AND status='active' AND id != ?", id).n < 1;
const FK = /FOREIGN KEY|foreign key|a foreign key constraint|REFERENCE/;
// Suppression d'une ligne de référentiel : refusée proprement si elle est utilisée ailleurs
function tryDelete(fn, what) { try { return tx(fn); } catch (e) { if (FK.test(String(e.message))) throw conflict('IN_USE', `${what} est utilisé ailleurs : désactivez-le plutôt que de le supprimer`); throw e; } }

// ---------- comptes ----------
router.post('/users/:id/unlock', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const u = loadUser(ctx, ctx.params.id); run('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?', u.id); audit(ctx, 'user.unlock', 'user', u.id); return { ok: true };
});
router.post('/users/:id/revoke-sessions', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const u = loadUser(ctx, ctx.params.id); const n = run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=? AND revoked=0', u.id); audit(ctx, 'user.revoke_sessions', 'user', u.id); return { ok: true, revoked: n?.changes ?? undefined };
});
router.post('/users/:id/reset-mfa', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const u = loadUser(ctx, ctx.params.id); run('UPDATE users SET mfa_enabled=0, mfa_secret=NULL WHERE id=?', u.id); run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=?', u.id); audit(ctx, 'user.reset_mfa', 'user', u.id); return { ok: true };
});
router.post('/users/:id/set-password', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const u = loadUser(ctx, ctx.params.id); const pw = String(ctx.body.password || ''); const pol = passwordPolicy(pw); if (pol) throw bad('WEAK_PASSWORD', pol);
  run("UPDATE users SET password_hash=?, must_change_password=?, failed_attempts=0, locked_until=NULL, updated_at=datetime('now') WHERE id=?", hashPassword(pw), ctx.body.must_change === false ? 0 : 1, u.id);
  run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=?', u.id); audit(ctx, 'user.set_password', 'user', u.id); return { ok: true };
});
router.post('/users/:id/force-password-change', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const u = loadUser(ctx, ctx.params.id); run('UPDATE users SET must_change_password=1 WHERE id=?', u.id); audit(ctx, 'user.force_pw_change', 'user', u.id); return { ok: true };
});

// Suppression : définitive si le compte n'a laissé aucune trace métier ; sinon anonymisation + verrouillage définitif
// (ventes, mouvements de stock, ordonnances et journal d'audit doivent rester traçables : obligation pharmaceutique et comptable).
export function deleteAccount(ctx, u) {
  if (u.id === ctx.user.id) throw forbidden('Vous ne pouvez pas supprimer votre propre compte');
  if (u.role_code === 'super_admin' && lastSuper(u.id)) throw conflict('LAST_SUPER_ADMIN', 'Il doit rester au moins un super-administrateur actif');
  const cust = get('SELECT id FROM customers WHERE user_id=?', u.id);
  try {
    tx(() => {
      run('DELETE FROM refresh_tokens WHERE user_id=?', u.id); run('DELETE FROM login_attempts WHERE email=?', u.email);
      run('UPDATE customers SET user_id=NULL WHERE user_id=?', u.id); run('DELETE FROM users WHERE id=?', u.id);
      audit(ctx, 'user.delete', 'user', u.id, { email: u.email, role: u.role_code }, { mode: 'hard' });
    });
    if (cust) { try { tx(() => { run('DELETE FROM loyalty_transactions WHERE customer_id=?', cust.id); run('DELETE FROM customers WHERE id=?', cust.id); }); } catch (e2) { if (!FK.test(String(e2.message))) throw e2; run("UPDATE customers SET name=?, phone=NULL, email=NULL, address=NULL, birth_date=NULL, marketing_consent=0, status='anonymized' WHERE id=?", `Client supprimé #${cust.id}`, cust.id); run('UPDATE prescriptions SET patient_name=? WHERE customer_id=?', `Patient anonymisé #${cust.id}`, cust.id); } }
    return { mode: 'deleted' };
  } catch (e) {
    if (!FK.test(String(e.message))) throw e;
    tx(() => {
      run("UPDATE users SET email=?, name=?, phone=NULL, password_hash=?, mfa_enabled=0, mfa_secret=NULL, status='deleted', status_reason='Compte supprimé', suspended_until=NULL, deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?", `deleted-${u.id}@deleted.invalid`, `Compte supprimé #${u.id}`, hashPassword(randomToken(24) + 'aA1'), u.id);
      run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=?', u.id);
      if (cust) { run("UPDATE customers SET name=?, phone=NULL, email=NULL, address=NULL, birth_date=NULL, marketing_consent=0, status='anonymized' WHERE user_id=?", `Client supprimé #${cust.id}`, u.id); run('UPDATE prescriptions SET patient_name=? WHERE customer_id=?', `Patient anonymisé #${cust.id}`, cust.id); }
      audit(ctx, 'user.delete', 'user', u.id, { email: u.email, role: u.role_code }, { mode: 'anonymized' });
    });
    return { mode: 'anonymized' };
  }
}
router.delete('/users/:id', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const u = loadUser(ctx, ctx.params.id); return trashUser(ctx, u);
});
// Actions groupées (super-administrateur)
router.post('/users-bulk', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const action = oneOf(ctx.body.action, 'action', ['suspend', 'activate', 'disable', 'revoke_sessions', 'delete'], { required: true });
  const ids = [...new Set((Array.isArray(ctx.body.ids) ? ctx.body.ids : []).map(Number).filter(Boolean))]; if (!ids.length || ids.length > 200) throw bad('VALIDATION', 'Sélection invalide (1 à 200 comptes)');
  const reason = str(ctx.body.reason, 'motif', { max: 300 }); const res = { done: 0, failed: [] };
  for (const id of ids) {
    try {
      const u = loadUser(ctx, id); if (id === ctx.user.id) throw forbidden('Votre propre compte est exclu');
      if (action === 'delete') trashUser(ctx, u);
      else if (action === 'revoke_sessions') { run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=?', u.id); audit(ctx, 'user.revoke_sessions', 'user', u.id); }
      else {
        const st = { suspend: 'suspended', activate: 'active', disable: 'disabled' }[action];
        if (st !== 'active' && u.role_code === 'super_admin' && lastSuper(u.id)) throw conflict('LAST_SUPER_ADMIN', 'Dernier super-administrateur actif');
        tx(() => { run("UPDATE users SET status=?, status_reason=?, suspended_until=NULL, updated_at=datetime('now') WHERE id=? AND status != 'deleted'", st, st === 'active' ? null : reason, u.id); if (st !== 'active') run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=?', u.id); audit(ctx, 'user.update', 'user', u.id, { status: u.status }, { status: st, bulk: true }); });
      }
      res.done++;
    } catch (e) { res.failed.push({ id, error: e.message }); }
  }
  return res;
});

// ---------- clients (fiche) ----------
router.delete('/customers/:id', { perm: 'customers.manage', ok200: true }, (ctx) => {
  if (!can(ctx.user, 'users.manage')) throw forbidden('Réservé à un administrateur');
  const c = get('SELECT * FROM customers WHERE id=?' + (isSuper(ctx) ? '' : ' AND pharmacy_id=?'), ...(isSuper(ctx) ? [ctx.params.id] : [ctx.params.id, ctx.ph])); if (!c) throw notFound('Client');
  if (c.user_id) { const u = get('SELECT * FROM users WHERE id=?', c.user_id); if (u) return deleteAccount(ctx, u); }
  try { tryDelete(() => { run('DELETE FROM loyalty_transactions WHERE customer_id=?', c.id); run('DELETE FROM customers WHERE id=?', c.id); audit(ctx, 'customer.delete', 'customer', c.id); }, 'Ce client'); return { mode: 'deleted' }; }
  catch (e) {
    if (e.code !== 'IN_USE') throw e;
    tx(() => { run("UPDATE customers SET name=?, phone=NULL, email=NULL, address=NULL, birth_date=NULL, marketing_consent=0, status='anonymized' WHERE id=?", `Client supprimé #${c.id}`, c.id); run('UPDATE prescriptions SET patient_name=? WHERE customer_id=?', `Patient anonymisé #${c.id}`, c.id); audit(ctx, 'customer.delete', 'customer', c.id, undefined, { mode: 'anonymized' }); });
    return { mode: 'anonymized' };
  }
});

// ---------- établissements ----------
router.post('/pharmacies/:id/status', { perm: 'pharmacies.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const id = Number(ctx.params.id), st = oneOf(ctx.body.status, 'statut', ['active', 'disabled'], { required: true });
  if (!get('SELECT 1 FROM pharmacies WHERE id=?', id)) throw notFound('Établissement');
  if (st === 'disabled' && get("SELECT COUNT(*) n FROM pharmacies WHERE status='active' AND id != ?", id).n < 1) throw conflict('LAST_PHARMACY', 'Impossible de désactiver le dernier établissement actif');
  tx(() => { run('UPDATE pharmacies SET status=? WHERE id=?', st, id); if (st === 'disabled') run("UPDATE refresh_tokens SET revoked=1 WHERE user_id IN (SELECT id FROM users WHERE pharmacy_id=? AND role_code != 'super_admin')", id); audit(ctx, 'pharmacy.status', 'pharmacy', id, undefined, { status: st }); });
  return { ok: true };
});
router.delete('/pharmacies/:id', { perm: 'pharmacies.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const id = Number(ctx.params.id); if (!get('SELECT 1 FROM pharmacies WHERE id=?', id)) throw notFound('Établissement');
  if (get('SELECT COUNT(*) n FROM pharmacies WHERE id != ?', id).n < 1) throw conflict('LAST_PHARMACY', 'Impossible de supprimer le dernier établissement');
  tryDelete(() => { run('DELETE FROM cash_registers WHERE pharmacy_id=?', id); run('DELETE FROM settings WHERE pharmacy_id=?', id); run('DELETE FROM pharmacies WHERE id=?', id); audit(ctx, 'pharmacy.delete', 'pharmacy', id); }, 'Cet établissement (ventes, stocks ou comptes rattachés)');
  return { ok: true };
});
router.delete('/cash/registers/:id', { perm: 'settings.manage', ok200: true }, (ctx) => {
  const r = get('SELECT * FROM cash_registers WHERE id=?' + (isSuper(ctx) ? '' : ' AND pharmacy_id=?'), ...(isSuper(ctx) ? [ctx.params.id] : [ctx.params.id, ctx.ph])); if (!r) throw notFound('Caisse');
  tryDelete(() => { run('DELETE FROM cash_registers WHERE id=?', r.id); audit(ctx, 'register.delete', 'register', r.id); }, 'Cette caisse'); return { ok: true };
});

// ---------- rôles personnalisés ----------
router.post('/roles', { perm: 'roles.manage', needsPharmacy: false }, (ctx) => {
  needSuper(ctx); const code = String(ctx.body.code || '').trim().toLowerCase(); if (!/^[a-z][a-z0-9_]{2,30}$/.test(code)) throw bad('VALIDATION', 'Code : 3 à 31 caractères (a-z, 0-9, _), commençant par une lettre');
  if (get('SELECT 1 FROM roles WHERE code=?', code)) throw conflict('DUPLICATE', 'Ce rôle existe déjà');
  const label = str(ctx.body.label, 'libellé', { required: true, max: 80 }), perms = (Array.isArray(ctx.body.permissions) ? ctx.body.permissions : []).filter((p) => PERMISSIONS[p]);
  tx(() => { run('INSERT INTO roles(code,label,privileged) VALUES (?,?,?)', code, label, ctx.body.privileged ? 1 : 0); for (const p of perms) run('INSERT INTO role_permissions(role_code,permission_code) VALUES (?,?)', code, p); audit(ctx, 'role.create', 'role', code, undefined, { label, perms: perms.length }); });
  reloadPerms(); return { code };
});
router.put('/roles/:code', { perm: 'roles.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const r = get('SELECT * FROM roles WHERE code=?', ctx.params.code); if (!r) throw notFound('Rôle'); if (ROLES[r.code]) throw forbidden('Les rôles intégrés ne sont pas renommables (seules leurs permissions le sont)');
  run('UPDATE roles SET label=?, privileged=? WHERE code=?', str(ctx.body.label ?? r.label, 'libellé', { required: true, max: 80 }), ctx.body.privileged === undefined ? r.privileged : ctx.body.privileged ? 1 : 0, r.code); audit(ctx, 'role.update', 'role', r.code); return { ok: true };
});
router.delete('/roles/:code', { perm: 'roles.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const r = get('SELECT * FROM roles WHERE code=?', ctx.params.code); if (!r) throw notFound('Rôle'); if (ROLES[r.code]) throw forbidden('Un rôle intégré ne peut pas être supprimé');
  const n = get('SELECT COUNT(*) n FROM users WHERE role_code=?', r.code).n; if (n) throw conflict('IN_USE', `${n} compte(s) utilisent ce rôle : réattribuez-les d'abord`);
  tx(() => { run('DELETE FROM role_permissions WHERE role_code=?', r.code); run('DELETE FROM roles WHERE code=?', r.code); audit(ctx, 'role.delete', 'role', r.code); }); reloadPerms(); return { ok: true };
});

// ---------- référentiels ----------
for (const [path, table, label, perm] of [['categories', 'categories', 'Cette catégorie', 'products.manage'], ['manufacturers', 'manufacturers', 'Ce fabricant', 'products.manage']]) {
  router.put(`/${path}/:id`, { perm, needsPharmacy: false, ok200: true }, (ctx) => {
    const r = get(`SELECT * FROM ${table} WHERE id=?`, ctx.params.id); if (!r) throw notFound(label); const name = str(ctx.body.name, 'nom', { required: true, max: 120 });
    if (get(`SELECT 1 FROM ${table} WHERE name=? AND id != ?`, name, r.id)) throw conflict('DUPLICATE', 'Ce nom existe déjà');
    run(`UPDATE ${table} SET name=? WHERE id=?`, name, r.id); audit(ctx, `${table}.update`, table, r.id, { name: r.name }, { name }); return { ok: true };
  });
  router.delete(`/${path}/:id`, { perm, needsPharmacy: false, ok200: true }, (ctx) => {
    const r = get(`SELECT * FROM ${table} WHERE id=?`, ctx.params.id); if (!r) throw notFound(label);
    tryDelete(() => { run(`DELETE FROM ${table} WHERE id=?`, r.id); audit(ctx, `${table}.delete`, table, r.id, { name: r.name }); }, label); return { ok: true };
  });
}
router.delete('/suppliers/:id', { perm: 'suppliers.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const r = get('SELECT * FROM suppliers WHERE id=?', ctx.params.id); if (!r) throw notFound('Fournisseur');
  return moveToTrash(ctx, 'supplier', r);
});

// ---------- permissions individuelles (par-dessus le rôle) ----------
router.get('/users/:id/permissions', { perm: 'users.manage', needsPharmacy: false }, (ctx) => {
  needSuper(ctx); const u = loadUser(ctx, ctx.params.id);
  return { role: u.role_code, role_permissions: permsOf(u.role_code), overrides: overridesOf(u.id), effective: userPerms(u.id, u.role_code), catalog: Object.entries(PERMISSIONS).map(([code, label]) => ({ code, label })), locked: u.role_code === 'super_admin' };
});
router.put('/users/:id/permissions', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const u = loadUser(ctx, ctx.params.id); if (u.role_code === 'super_admin') throw forbidden('Le super-administrateur possède toujours tous les droits');
  const ov = ctx.body.overrides; if (!ov || typeof ov !== 'object' || Array.isArray(ov)) throw bad('VALIDATION', 'overrides attendu');
  const before = overridesOf(u.id);
  tx(() => { for (const [code, eff] of Object.entries(ov)) {
    if (!PERMISSIONS[code]) throw bad('VALIDATION', 'Permission inconnue : ' + code); if (eff !== null && eff !== 'grant' && eff !== 'deny') throw bad('VALIDATION', 'Valeur invalide pour ' + code);
    run('DELETE FROM user_permissions WHERE user_id=? AND permission_code=?', u.id, code);
    if (eff) run('INSERT INTO user_permissions(user_id,permission_code,effect,updated_by) VALUES (?,?,?,?)', u.id, code, eff, ctx.user.id);
  } audit(ctx, 'user.permissions', 'user', u.id, before, ov); });
  reloadPerms(); return { ok: true, effective: userPerms(u.id, u.role_code) };
});
router.post('/users/:id/impersonate', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); if (ctx.user.impersonator) throw forbidden('Déjà en prise de contrôle');
  const u = loadUser(ctx, ctx.params.id); if (u.id === ctx.user.id || u.role_code === 'super_admin') throw forbidden('Prise de contrôle impossible sur ce compte'); if (u.status !== 'active') throw conflict('INACTIVE', 'Le compte doit être actif');
  audit(ctx, 'user.impersonate', 'user', u.id, undefined, { email: u.email });
  return { access_token: signJwt({ typ: 'access', sub: u.id, imp: ctx.user.id }, config.secret, 1800), expires_in: 1800, user: { id: u.id, email: u.email, name: u.name, role: u.role_code, pharmacy_id: u.pharmacy_id, lang: u.lang, mfa_enabled: !!u.mfa_enabled }, permissions: userPerms(u.id, u.role_code), impersonating: true };
});
