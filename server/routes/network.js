// Comptes avancés : super-admin principal, profil personnel + photo, corbeille (90 jours), fichiers publics (avatars/logos).
import { router, audit, can } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { bad, conflict, notFound, forbidden, str, oneOf } from '../util.js';
import { savePublicImage, dropPublic, readPublic, mimeOfName } from '../files.js';
import { normalizePhone, dialOfPharmacy } from '../phone.js';
import { deleteAccount } from './accounts.js';
import { loadUser } from './admin.js';

const isSuper = (ctx) => ctx.user.role === 'super_admin';
const isPrimary = (ctx) => !!get('SELECT is_primary p FROM users WHERE id=?', ctx.user.id)?.p;
const SYSTEM = { user: { id: null }, ph: null, ip: null };
const RETENTION = '+90 days';

// ---------- fichiers publics (avatars, logos) ----------
router.get('/public/file/:name', { public: true, needsPharmacy: false }, (ctx) => {
  const buf = readPublic(ctx.params.name); if (!buf) throw notFound('Fichier');
  ctx.res.writeHead(200, { 'Content-Type': mimeOfName(ctx.params.name), 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  ctx.res.end(buf);
});
export const fileUrl = (n) => (n ? `/api/v1/public/file/${n}` : null);

// ---------- profil personnel (tout utilisateur) ----------
const profile = (u) => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, lang: u.lang, role: u.role_code, pharmacy_id: u.pharmacy_id, is_primary: !!u.is_primary, is_guest: !!u.is_guest, avatar_url: fileUrl(u.avatar_path) });
router.get('/me/profile', { needsPharmacy: false }, (ctx) => profile(get('SELECT * FROM users WHERE id=?', ctx.user.id)));
router.put('/me/profile', { needsPharmacy: false, ok200: true }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.user.id); if (u.is_guest) throw forbidden('Créez un compte pour modifier votre profil');
  const b = ctx.body, upd = {};
  if (b.name !== undefined) upd.name = str(b.name, 'nom', { required: true, max: 120 });
  if (b.phone !== undefined) upd.phone = normalizePhone(b.phone, b.dial || dialOfPharmacy(u.pharmacy_id ?? 0));
  if (b.lang !== undefined) upd.lang = oneOf(b.lang, 'langue', ['fr', 'en', 'ar']);
  if (!Object.keys(upd).length) throw bad('VALIDATION', 'Aucune modification');
  tx(() => {
    run(`UPDATE users SET ${Object.keys(upd).map((k) => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`, ...Object.values(upd), u.id);
    const c = {}; for (const k of ['name', 'phone']) if (upd[k] !== undefined) c[k] = upd[k];
    if (Object.keys(c).length) run(`UPDATE customers SET ${Object.keys(c).map((k) => k + '=?').join(',')} WHERE user_id=?`, ...Object.values(c), u.id);
    audit(ctx, 'profile.update', 'user', u.id, { name: u.name, phone: u.phone }, upd);
  });
  return profile(get('SELECT * FROM users WHERE id=?', u.id));
});
router.post('/me/avatar', { needsPharmacy: false, ok200: true, bodyLimit: 2 * 1024 * 1024 }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.user.id); if (u.is_guest) throw forbidden('Créez un compte pour ajouter une photo');
  const name = savePublicImage(ctx.body.file); run("UPDATE users SET avatar_path=?, updated_at=datetime('now') WHERE id=?", name, u.id); if (u.avatar_path) dropPublic(u.avatar_path);
  audit(ctx, 'profile.avatar', 'user', u.id); return { avatar_url: fileUrl(name) };
});
router.delete('/me/avatar', { needsPharmacy: false, ok200: true }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.user.id); run('UPDATE users SET avatar_path=NULL WHERE id=?', u.id); if (u.avatar_path) dropPublic(u.avatar_path); return { ok: true };
});

// ---------- super-admin principal ----------
router.post('/users/:id/primary', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  if (!isSuper(ctx) || !isPrimary(ctx)) throw forbidden('Seul le super-administrateur principal attribue ou retire cette fonction');
  const u = loadUser(ctx, ctx.params.id); if (u.role_code !== 'super_admin') throw bad('VALIDATION', 'Seul un super-administrateur peut être principal');
  const value = ctx.body.value === false || ctx.body.value === 0 ? 0 : 1;
  if (u.id === ctx.user.id && !value) throw forbidden('Vous ne pouvez pas retirer votre propre statut principal');
  run('UPDATE users SET is_primary=? WHERE id=?', value, u.id); audit(ctx, value ? 'user.primary_grant' : 'user.primary_revoke', 'user', u.id); return { ok: true, is_primary: !!value };
});

// ---------- corbeille ----------
const ENT = {
  user: { table: 'users', trashed: 'trashed', label: (r) => `${r.name} (${r.email})` },
  supplier: { table: 'suppliers', trashed: 'trashed', label: (r) => r.name },
  product: { table: 'products', trashed: 'trashed', label: (r) => `${r.name}${r.dosage ? ' ' + r.dosage : ''}` },
  driver: { table: 'drivers', trashed: 'inactive', label: (r) => r.name },
};
export function moveToTrash(ctx, entity, row) {
  const e = ENT[entity]; const phId = row.pharmacy_id ?? null;
  tx(() => {
    run(`UPDATE ${e.table} SET status=? WHERE id=?`, e.trashed, row.id);
    run('DELETE FROM trash WHERE entity=? AND entity_id=?', entity, row.id);
    insert("INSERT INTO trash(pharmacy_id,entity,entity_id,label,data,deleted_by,purge_at) VALUES (?,?,?,?,?,?,datetime('now',?))", phId, entity, row.id, e.label(row), JSON.stringify({ prev_status: row.status ?? 'active' }), ctx.user?.id ?? null, RETENTION);
    if (entity === 'user') run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=?', row.id);
    audit(ctx, `${entity}.trash`, entity, row.id, { status: row.status }, { status: e.trashed });
  });
  return { mode: 'trashed', purge_in_days: 90 };
}
export function trashUser(ctx, u) {
  if (u.id === ctx.user.id) throw forbidden('Vous ne pouvez pas supprimer votre propre compte');
  if (!can(ctx.user, 'users.delete')) throw forbidden('Vous n\'avez pas le droit de supprimer des comptes');
  if (u.status === 'deleted' || u.status === 'trashed') throw conflict('DELETED', 'Compte déjà supprimé');
  if (u.is_primary && !(isSuper(ctx) && isPrimary(ctx))) throw forbidden('Le super-administrateur principal ne peut être supprimé que par un autre principal');
  if (u.role_code === 'super_admin' && !isSuper(ctx)) throw forbidden('Réservé au super-administrateur');
  if (u.role_code === 'super_admin' && get("SELECT COUNT(*) n FROM users WHERE role_code='super_admin' AND status='active' AND id != ?", u.id).n < 1) throw conflict('LAST_SUPER_ADMIN', 'Il doit rester au moins un super-administrateur actif');
  return moveToTrash(ctx, 'user', u);
}
const scopeTrash = (ctx) => (isSuper(ctx) ? { w: '1=1', p: [] } : { w: 'pharmacy_id=?', p: [ctx.ph] });
const loadTrash = (ctx, id) => { const s = scopeTrash(ctx); const t = get(`SELECT * FROM trash WHERE id=? AND ${s.w}`, id, ...s.p); if (!t) throw notFound('Élément de la corbeille'); return t; };
router.get('/trash', { perm: 'trash.manage', needsPharmacy: false }, (ctx) => {
  const s = scopeTrash(ctx); if (!isSuper(ctx) && !ctx.ph) throw forbidden();
  const w = [s.w], p = [...s.p]; if (ctx.query.entity) { w.push('entity=?'); p.push(ctx.query.entity); }
  return { retention_days: 90, items: all(`SELECT id,pharmacy_id,entity,entity_id,label,deleted_by,deleted_at,purge_at FROM trash WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT 500`, ...p) };
});
router.post('/trash/:id/restore', { perm: 'trash.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const t = loadTrash(ctx, ctx.params.id), e = ENT[t.entity]; const prev = JSON.parse(t.data).prev_status || 'active';
  tx(() => { run(`UPDATE ${e.table} SET status=? WHERE id=?`, prev === 'trashed' ? 'active' : prev, t.entity_id); run('DELETE FROM trash WHERE id=?', t.id); audit(ctx, `${t.entity}.restore`, t.entity, t.entity_id); });
  return { ok: true };
});
export function purgeOne(ctx, t) {
  const e = ENT[t.entity];
  let mode = 'deleted';
  if (t.entity === 'user') { const u = get('SELECT * FROM users WHERE id=?', t.entity_id); if (u) mode = deleteAccount({ ...ctx, user: { ...ctx.user, id: ctx.user?.id ?? null } }, u).mode; }
  else { try { tx(() => { run(`DELETE FROM ${e.table} WHERE id=?`, t.entity_id); }); } catch { run(`UPDATE ${e.table} SET status='inactive' WHERE id=?`, t.entity_id); mode = 'archived'; } }
  run('DELETE FROM trash WHERE id=?', t.id); audit(ctx, `${t.entity}.purge`, t.entity, t.entity_id); return mode;
}
router.delete('/trash/:id', { perm: 'trash.manage', needsPharmacy: false, ok200: true }, (ctx) => ({ ok: true, mode: purgeOne(ctx, loadTrash(ctx, ctx.params.id)) }));
router.post('/trash/empty', { perm: 'trash.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const s = scopeTrash(ctx); let n = 0; for (const t of all(`SELECT * FROM trash WHERE ${s.w}`, ...s.p)) { try { purgeOne(ctx, t); n++; } catch {} } return { purged: n };
});
export function purgeExpired() {
  for (const t of all("SELECT * FROM trash WHERE purge_at <= datetime('now')")) { try { purgeOne(SYSTEM, t); } catch (e) { console.error('[trash]', e.message); } }
}

// ---------- établissements : logo, gestionnaire, catalogue ----------
import { hashPassword, passwordPolicy, randomToken } from '../security.js';
import { sendWelcome } from '../emailtpl.js';
import { ROLES } from '../rbac.js';
const needSuper = (ctx) => { if (!isSuper(ctx)) throw forbidden('Réservé au super-administrateur'); };
const loadPh = (id) => { const p = get('SELECT * FROM pharmacies WHERE id=?', id); if (!p) throw notFound('Établissement'); return p; };
router.post('/pharmacies/:id/logo', { perm: 'settings.manage', needsPharmacy: false, ok200: true, bodyLimit: 2 * 1024 * 1024 }, (ctx) => {
  const p = loadPh(ctx.params.id); if (!isSuper(ctx) && ctx.user.pharmacy_id !== p.id) throw forbidden();
  const name = savePublicImage(ctx.body.file); run('UPDATE pharmacies SET logo_path=? WHERE id=?', name, p.id); if (p.logo_path) dropPublic(p.logo_path); audit(ctx, 'pharmacy.logo', 'pharmacy', p.id); return { logo_url: fileUrl(name) };
});
router.delete('/pharmacies/:id/logo', { perm: 'settings.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const p = loadPh(ctx.params.id); if (!isSuper(ctx) && ctx.user.pharmacy_id !== p.id) throw forbidden(); run('UPDATE pharmacies SET logo_path=NULL WHERE id=?', p.id); if (p.logo_path) dropPublic(p.logo_path); return { ok: true };
});
// Gestionnaire d'établissement : un compte existant (de cet établissement) ou un compte créé à la volée, avec les droits décidés par le super-administrateur.
router.post('/pharmacies/:id/manager', { perm: 'pharmacies.manage', needsPharmacy: false }, (ctx) => {
  needSuper(ctx); const p = loadPh(ctx.params.id); const b = ctx.body;
  const out = tx(() => {
    let uid, pw;
    if (b.user_id) {
      const u = get('SELECT * FROM users WHERE id=?', Number(b.user_id)); if (!u || ['customer', 'guest', 'super_admin'].includes(u.role_code)) throw bad('VALIDATION', 'Compte invalide');
      if (u.pharmacy_id !== p.id) throw bad('VALIDATION', 'Ce compte n\'appartient pas à cet établissement'); uid = u.id;
      if (b.role_code && b.role_code !== u.role_code) { if (!ROLES[b.role_code] || ['super_admin', 'customer', 'guest'].includes(b.role_code)) throw bad('VALIDATION', 'Rôle invalide'); run('UPDATE users SET role_code=? WHERE id=?', b.role_code, u.id); }
    } else {
      const role = b.role_code || 'pharmacy_admin'; if (!ROLES[role] || ['super_admin', 'customer', 'guest'].includes(role)) throw bad('VALIDATION', 'Rôle invalide');
      const email = String(b.email || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('VALIDATION', 'E-mail invalide'); if (get('SELECT 1 FROM users WHERE email=?', email)) throw conflict('DUPLICATE', 'Un compte existe déjà avec cet e-mail');
      pw = b.password || randomToken(9) + 'aA1'; const pol = passwordPolicy(pw); if (pol) throw bad('WEAK_PASSWORD', pol);
      uid = insert('INSERT INTO users(email,password_hash,name,role_code,pharmacy_id,phone,must_change_password,created_by) VALUES (?,?,?,?,?,?,1,?)', email, hashPassword(pw), str(b.name, 'nom', { required: true, max: 120 }), role, p.id, normalizePhone(b.phone, dialOfPharmacy(p.id)), ctx.user.id);
      sendWelcome({ email, name: b.name, role_label: ROLES[role].label, pharmacyId: p.id, password: b.password ? null : pw });
    }
    if (b.overrides && typeof b.overrides === 'object') for (const [code, eff] of Object.entries(b.overrides)) {
      run('DELETE FROM user_permissions WHERE user_id=? AND permission_code=?', uid, code); if (eff === 'grant' || eff === 'deny') run('INSERT INTO user_permissions(user_id,permission_code,effect,updated_by) VALUES (?,?,?,?)', uid, code, eff, ctx.user.id);
    }
    run('UPDATE pharmacies SET manager_user_id=? WHERE id=?', uid, p.id); audit(ctx, 'pharmacy.manager', 'pharmacy', p.id, { manager: p.manager_user_id }, { manager: uid });
    return { manager_user_id: uid, temporary_password: b.password ? undefined : pw };
  });
  return out;
});
router.get('/pharmacies/:id/catalog', { perm: 'pharmacies.manage', needsPharmacy: false }, (ctx) => {
  needSuper(ctx); const p = loadPh(ctx.params.id); const q = `%${ctx.query.q || ''}%`;
  const rows = all(`SELECT pr.id, pr.sku, pr.name, pr.dosage, pr.form, pr.status, EXISTS(SELECT 1 FROM pharmacy_catalog pc WHERE pc.pharmacy_id=? AND pc.product_id=pr.id) in_catalog FROM products pr WHERE pr.status != 'trashed' AND (pr.name LIKE ? OR pr.sku LIKE ?) ORDER BY pr.name LIMIT 300`, p.id, q, q);
  return { pharmacy: { id: p.id, name: p.name }, total_in_catalog: get('SELECT COUNT(*) n FROM pharmacy_catalog WHERE pharmacy_id=?', p.id).n, data: rows };
});
// Affecter des médicaments à une pharmacie : copie complète depuis une autre, ou sélection de produits.
router.post('/pharmacies/:id/catalog', { perm: 'pharmacies.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const p = loadPh(ctx.params.id); const b = ctx.body; let added = 0;
  tx(() => {
    if (b.replace === true) run('DELETE FROM pharmacy_catalog WHERE pharmacy_id=?', p.id);
    if (b.copy_from) { const src = loadPh(b.copy_from); added += run('INSERT OR IGNORE INTO pharmacy_catalog(pharmacy_id,product_id) SELECT ?, product_id FROM pharmacy_catalog WHERE pharmacy_id=?', p.id, src.id)?.changes ?? 0; }
    for (const id of Array.isArray(b.product_ids) ? b.product_ids.map(Number).filter(Boolean) : []) if (get("SELECT 1 FROM products WHERE id=? AND status != 'trashed'", id)) added += run('INSERT OR IGNORE INTO pharmacy_catalog(pharmacy_id,product_id) VALUES (?,?)', p.id, id)?.changes ?? 0;
    audit(ctx, 'pharmacy.catalog', 'pharmacy', p.id, undefined, { copy_from: b.copy_from ?? null, count: Array.isArray(b.product_ids) ? b.product_ids.length : 0, replace: !!b.replace });
  });
  return { ok: true, total_in_catalog: get('SELECT COUNT(*) n FROM pharmacy_catalog WHERE pharmacy_id=?', p.id).n };
});
router.delete('/pharmacies/:id/catalog/:productId', { perm: 'pharmacies.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const p = loadPh(ctx.params.id);
  if (get('SELECT 1 FROM stock_levels s JOIN batches b ON b.id=s.batch_id WHERE s.pharmacy_id=? AND b.product_id=? AND s.qty_available > 0', p.id, ctx.params.productId)) throw conflict('IN_STOCK', 'Ce produit a du stock dans cette pharmacie : écoulez ou transférez-le d\'abord');
  run('DELETE FROM pharmacy_catalog WHERE pharmacy_id=? AND product_id=?', p.id, ctx.params.productId); audit(ctx, 'pharmacy.catalog_remove', 'pharmacy', p.id, { product_id: Number(ctx.params.productId) }); return { ok: true };
});
