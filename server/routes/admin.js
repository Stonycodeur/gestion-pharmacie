import { ensurePharmacyMethods } from '../paymodes.js';
import { router, audit, paged, can, need, sseHandler, registry } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { HttpError, bad, conflict, notFound, forbidden, str, int, oneOf, email as vEmail, toCsv } from '../util.js';
import { hashPassword, passwordPolicy, randomToken } from '../security.js';
import { normalizePhone, dialOfPharmacy } from '../phone.js';
import { ROLES, PERMISSIONS, assignableRoles, reloadPerms } from '../rbac.js';
const ROLE_ORDER = (c) => { const i = Object.keys(ROLES).indexOf(c); return i < 0 ? 999 : i; };
import { refreshNotifications } from '../alerts.js';
import { sendWelcome } from '../emailtpl.js';
import { resolveZone } from '../timezones.js';

// ---------- utilisateurs ----------
const scope = (ctx) => (ctx.user.role === 'super_admin' ? { w: '1=1', p: [] } : { w: 'u.pharmacy_id=?', p: [ctx.ph] });
const isSuper = (ctx) => ctx.user.role === 'super_admin';
const superCount = (exceptId = 0) => get("SELECT COUNT(*) n FROM users WHERE role_code='super_admin' AND status='active' AND id != ?", exceptId).n;
export const loadUser = (ctx, id) => {
  const u = get('SELECT * FROM users WHERE id=?', id); if (!u) throw notFound('Utilisateur');
  if (!isSuper(ctx) && (u.pharmacy_id !== ctx.ph || u.role_code === 'super_admin')) throw forbidden();
  return u;
};
router.get('/users', { perm: 'users.manage', needsPharmacy: false }, (ctx) => {
  const s = scope(ctx); const w = [s.w], p = [...s.p];
  const kind = ctx.query.kind || 'staff';
  if (kind === 'staff') w.push("u.role_code != 'customer'"); else if (kind === 'customer') w.push("u.role_code = 'customer'");
  if (!isSuper(ctx)) w.push("u.role_code != 'super_admin'");
  if (ctx.query.status) { w.push('u.status=?'); p.push(ctx.query.status); } else if (ctx.query.include_deleted !== '1') w.push("u.status NOT IN ('deleted','trashed')");
  if (ctx.query.role) { w.push('u.role_code=?'); p.push(ctx.query.role); }
  if (ctx.query.pharmacy_id && isSuper(ctx)) { w.push('u.pharmacy_id=?'); p.push(Number(ctx.query.pharmacy_id)); }
  if (ctx.query.q) { w.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.role_code LIKE ?)'); p.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`, `%${ctx.query.q}%`, `%${ctx.query.q}%`); }
  return paged(ctx, `SELECT COUNT(*) n FROM users u WHERE ${w.join(' AND ')}`, `SELECT u.id,u.email,u.name,u.phone,u.role_code,u.pharmacy_id,u.status,u.status_reason,u.suspended_until,u.mfa_enabled,u.locked_until,u.last_login_at,u.created_at,u.is_primary,u.avatar_path,u.country_id,u.see_all_countries,ph.name pharmacy_name FROM users u LEFT JOIN pharmacies ph ON ph.id=u.pharmacy_id WHERE ${w.join(' AND ')} ORDER BY u.name`, p);
});
router.get('/users/:id', { perm: 'users.manage', needsPharmacy: false }, (ctx) => {
  const u = loadUser(ctx, ctx.params.id); const { password_hash, mfa_secret, ...pub } = u;
  const c = get('SELECT id,loyalty_points,marketing_consent,status FROM customers WHERE user_id=?', u.id);
  return { ...pub, customer: c || null, sales_count: get('SELECT COUNT(*) n FROM sales WHERE cashier_id=?', u.id).n, sessions_open: get('SELECT COUNT(*) n FROM refresh_tokens WHERE user_id=? AND revoked=0 AND expires_at > datetime(\'now\')', u.id).n };
});
router.post('/users', { perm: 'users.manage', needsPharmacy: false }, (ctx) => {
  const b = ctx.body, role = oneOf(b.role_code, 'rôle', all('SELECT code FROM roles').map((r) => r.code), { required: true });
  if (!assignableRoles(ctx.user.role).includes(role)) throw forbidden('Vous ne pouvez pas attribuer ce rôle');
  const ph = role === 'super_admin' ? null : (isSuper(ctx) ? int(b.pharmacy_id ?? ctx.ph, 'établissement', { required: true }) : ctx.ph);
  if (ph && !get('SELECT 1 FROM pharmacies WHERE id=?', ph)) throw bad('VALIDATION', 'Établissement invalide');
  const pw = b.password || randomToken(9) + 'aA1'; const pol = passwordPolicy(pw); if (pol) throw bad('WEAK_PASSWORD', pol);
  const em = vEmail(b.email, 'e-mail', { required: true }), name = str(b.name, 'nom', { required: true, max: 120 }), phone = normalizePhone(b.phone, dialOfPharmacy(ph ?? 0));
  if (get('SELECT 1 FROM users WHERE email=?', em)) throw conflict('DUPLICATE', 'Un compte existe déjà avec cet e-mail');
  const id = tx(() => {
    const id = insert('INSERT INTO users(email,password_hash,name,role_code,pharmacy_id,phone,must_change_password,lang) VALUES (?,?,?,?,?,?,?,?)', em, hashPassword(pw), name, role, ph, phone, b.must_change === false ? 0 : 1, oneOf(b.lang || 'fr', 'langue', ['fr', 'en', 'ar']));
    if (role === 'customer') insert('INSERT INTO customers(pharmacy_id,user_id,name,phone,email) VALUES (?,?,?,?,?)', ph, id, name, phone, em);
    audit(ctx, 'user.create', 'user', id, undefined, { email: em, role }); return id;
  });
  sendWelcome({ email: em, name, role_label: ROLES[role]?.label || role, pharmacyId: ph, password: b.password ? null : pw });
  return { id, temporary_password: b.password ? undefined : pw };
});
router.put('/users/:id', { perm: 'users.manage', needsPharmacy: false }, (ctx) => {
  const u = loadUser(ctx, ctx.params.id); const b = ctx.body, self = u.id === ctx.user.id;
  if (u.status === 'deleted') throw conflict('DELETED', 'Compte supprimé : modification impossible');
  const upd = {};
  if (b.name !== undefined) upd.name = str(b.name, 'nom', { required: true, max: 120 });
  if (b.phone !== undefined) upd.phone = normalizePhone(b.phone, dialOfPharmacy(u.pharmacy_id ?? 0));
  if (b.lang !== undefined) upd.lang = oneOf(b.lang, 'langue', ['fr', 'en', 'ar']);
  if (b.email !== undefined && b.email !== u.email) {
    if (!isSuper(ctx)) throw forbidden('Seul le super-administrateur modifie l\'e-mail');
    upd.email = vEmail(b.email, 'e-mail', { required: true }); if (get('SELECT 1 FROM users WHERE email=? AND id != ?', upd.email, u.id)) throw conflict('DUPLICATE', 'Cet e-mail est déjà utilisé');
  }
  if (b.pharmacy_id !== undefined && Number(b.pharmacy_id) !== u.pharmacy_id) {
    if (!isSuper(ctx)) throw forbidden('Seul le super-administrateur change d\'établissement');
    if (u.role_code === 'super_admin') throw bad('VALIDATION', 'Un super-administrateur n\'est rattaché à aucun établissement');
    const p = int(b.pharmacy_id, 'établissement', { required: true }); if (!get('SELECT 1 FROM pharmacies WHERE id=?', p)) throw bad('VALIDATION', 'Établissement invalide'); upd.pharmacy_id = p;
  }
  if (b.role_code !== undefined && b.role_code !== u.role_code) {
    const r = oneOf(b.role_code, 'rôle', all('SELECT code FROM roles').map((x) => x.code));
    const can_ = assignableRoles(ctx.user.role); if (!can_.includes(r) || !can_.includes(u.role_code)) throw forbidden('Rôle non attribuable');
    if (self) throw forbidden('Vous ne pouvez pas modifier votre propre rôle');
    if ((r === 'customer') !== (u.role_code === 'customer')) throw bad('VALIDATION', 'Un compte client ne peut pas devenir un compte du personnel (ni l\'inverse) : créez un nouveau compte');
    if (u.role_code === 'super_admin' && superCount(u.id) < 1) throw conflict('LAST_SUPER_ADMIN', 'Il doit rester au moins un super-administrateur actif');
    upd.role_code = r; if (r === 'super_admin') upd.pharmacy_id = null;
  }
  if (b.country_id !== undefined && u.role_code === 'customer') { const cid = b.country_id ? int(b.country_id, 'pays', { min: 1 }) : null; if (cid && !get('SELECT 1 FROM countries WHERE id=?', cid)) throw bad('VALIDATION', 'Pays inconnu'); if (cid !== u.country_id) upd.country_id = cid; }
  if (b.see_all_countries !== undefined && (b.see_all_countries ? 1 : 0) !== u.see_all_countries) { if (!isSuper(ctx)) throw forbidden('Seul le super-administrateur autorise l\'accès aux pharmacies de tous les pays'); upd.see_all_countries = b.see_all_countries ? 1 : 0; }
  if (b.status !== undefined && b.status !== u.status) {
    const st = oneOf(b.status, 'statut', ['active', 'suspended', 'disabled']);
    if (self && st !== 'active') throw forbidden('Vous ne pouvez pas suspendre ou désactiver votre propre compte');
    if (st !== 'active' && u.role_code === 'super_admin' && superCount(u.id) < 1) throw conflict('LAST_SUPER_ADMIN', 'Il doit rester au moins un super-administrateur actif');
    upd.status = st; upd.status_reason = st === 'active' ? null : str(b.status_reason, 'motif', { max: 300 });
    if (st === 'suspended' && b.suspended_until) { const d = new Date(b.suspended_until); if (isNaN(d) || d.getTime() <= Date.now()) throw bad('VALIDATION', 'La fin de suspension doit être dans le futur'); upd.suspended_until = d.toISOString().slice(0, 19).replace('T', ' '); } else upd.suspended_until = null;
  } else if (b.status_reason !== undefined && u.status !== 'active') upd.status_reason = str(b.status_reason, 'motif', { max: 300 });
  if (!Object.keys(upd).length) throw bad('VALIDATION', 'Aucune modification');
  tx(() => {
    run(`UPDATE users SET ${Object.keys(upd).map((k) => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`, ...Object.values(upd), u.id);
    if ((upd.status && upd.status !== 'active') || upd.role_code || upd.pharmacy_id !== undefined || upd.email) run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=?', u.id);
    if (u.role_code === 'customer') { const c = {}; for (const k of ['name', 'phone', 'email', 'pharmacy_id']) if (upd[k] !== undefined) c[k] = upd[k]; if (Object.keys(c).length) run(`UPDATE customers SET ${Object.keys(c).map((k) => k + '=?').join(',')} WHERE user_id=?`, ...Object.values(c), u.id); }
    audit(ctx, 'user.update', 'user', u.id, { role: u.role_code, status: u.status, pharmacy_id: u.pharmacy_id }, upd);
  });
  return { ok: true };
});
router.post('/users/:id/reset-password', { perm: 'users.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.params.id); if (!u) throw notFound('Utilisateur');
  if (ctx.user.role !== 'super_admin' && (u.pharmacy_id !== ctx.ph || u.role_code === 'super_admin')) throw forbidden();
  const pw = randomToken(9) + 'aA1';
  run("UPDATE users SET password_hash=?, must_change_password=1, failed_attempts=0, locked_until=NULL WHERE id=?", hashPassword(pw), u.id);
  run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=?', u.id); audit(ctx, 'user.reset_password', 'user', u.id);
  return { temporary_password: pw };
});
router.get('/users/:id/logins', { perm: 'users.manage', needsPharmacy: false }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.params.id); if (!u) throw notFound('Utilisateur');
  if (ctx.user.role !== 'super_admin' && u.pharmacy_id !== ctx.ph) throw forbidden();
  return { attempts: all('SELECT success, ip, created_at FROM login_attempts WHERE email=? ORDER BY id DESC LIMIT 30', u.email), sessions: all('SELECT device, ip, created_at, expires_at, revoked FROM refresh_tokens WHERE user_id=? ORDER BY id DESC LIMIT 15', u.id) };
});

// ---------- rôles & permissions ----------
router.get('/roles', { perm: 'users.manage', needsPharmacy: false }, () => ({
  permissions: Object.entries(PERMISSIONS).map(([code, label]) => ({ code, label })),
  roles: all('SELECT code,label,privileged FROM roles').sort((a, b) => ROLE_ORDER(a.code) - ROLE_ORDER(b.code) || a.code.localeCompare(b.code)).map((r) => ({ ...r, builtin: !!ROLES[r.code], users: get('SELECT COUNT(*) n FROM users WHERE role_code=?', r.code).n, permissions: all('SELECT permission_code p FROM role_permissions WHERE role_code=?', r.code).map((x) => x.p) })),
}));
router.put('/roles/:code/permissions', { perm: 'roles.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const r = get('SELECT * FROM roles WHERE code=?', ctx.params.code); if (!r) throw notFound('Rôle');
  if (r.code === 'super_admin') throw forbidden('Les permissions du super-administrateur sont figées');
  const perms = (Array.isArray(ctx.body.permissions) ? ctx.body.permissions : []).filter((p) => PERMISSIONS[p]);
  const before = all('SELECT permission_code p FROM role_permissions WHERE role_code=?', r.code).map((x) => x.p);
  tx(() => { run('DELETE FROM role_permissions WHERE role_code=?', r.code); for (const p of perms) insert('INSERT INTO role_permissions(role_code,permission_code) VALUES (?,?)', r.code, p); audit(ctx, 'role.permissions', 'role', r.code, before, perms); });
  reloadPerms(); return { ok: true };
});

// ---------- établissements & paramètres ----------
const num = (v, name, lo, hi) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw bad('VALIDATION', `${name} invalide`); return n; };
// Devises d'une pharmacie : obligatoirement choisies parmi celles du pays (un pays peut en avoir plusieurs) ; la première est la devise principale.
const curInput = (b, c) => {
  const allowed = String(c.currencies || '').split(',').filter(Boolean);
  let list = Array.isArray(b.currencies) ? b.currencies : String(b.currencies ?? '').split(/[\s,;]+/); list = [...new Set(list.map((x) => String(x).toUpperCase().trim()).filter(Boolean))];
  if (!list.length && b.currency) list = [String(b.currency).toUpperCase().trim()];
  if (b.currency && !list.includes(String(b.currency).toUpperCase().trim())) list.push(String(b.currency).toUpperCase().trim());
  if (!list.length) throw bad('VALIDATION', `Choisissez au moins une devise (${allowed.join(', ') || 'devises du pays'})`);
  for (const x of list) { if (!/^[A-Z]{3}$/.test(x)) throw bad('VALIDATION', 'Code devise invalide'); if (allowed.length && !allowed.includes(x)) throw bad('VALIDATION', `La devise ${x} n'est pas utilisée dans ce pays (${allowed.join(', ')})`); }
  const main = b.currency && list.includes(String(b.currency).toUpperCase().trim()) ? String(b.currency).toUpperCase().trim() : list[0];
  return { currency: main, currencies: [main, ...list.filter((x) => x !== main)].join(',') };
};
const phInput = (b) => {
  const cid = b.country_id ? int(b.country_id, 'pays', { min: 1 }) : get("SELECT id FROM countries WHERE iso2='TN'")?.id; const c = get('SELECT * FROM countries WHERE id=? AND active=1', cid); if (!c) throw bad('VALIDATION', 'Pays inconnu ou désactivé');
  return { name: str(b.name, 'nom', { required: true, max: 160 }), address: str(b.address, 'adresse', { max: 300 }), city: str(b.city, 'ville', { max: 80 }), country_id: c.id, phone: normalizePhone(b.phone, c.dial_code), email: str(b.email, 'e-mail', { max: 160 }),
    lat: num(b.lat, 'latitude', -90, 90), lng: num(b.lng, 'longitude', -180, 180), opening_hours: str(b.opening_hours, 'horaires', { max: 300 }), public_listed: b.public_listed === undefined ? 1 : b.public_listed ? 1 : 0,
    ...curInput(b, c), currency_decimals: int(b.currency_decimals ?? 3, 'décimales', { min: 0, max: 4 }), timezone: resolveZone(c.iso2, num(b.lat, 'latitude', -90, 90), num(b.lng, 'longitude', -180, 180), b.timezone), invoice_prefix: str(b.invoice_prefix || 'F', 'préfixe', { max: 8 }), legal_notice: str(b.legal_notice, 'mentions légales', { max: 600 }) };
};
const phView = (p) => ({ ...p, country: p.country_id ? get('SELECT iso2,name_fr,dial_code FROM countries WHERE id=?', p.country_id) : null, manager: p.manager_user_id ? get('SELECT id,name,email FROM users WHERE id=?', p.manager_user_id) : null, has_logo: !!p.logo_path, logo_url: p.logo_path ? '/api/v1/public/file/' + p.logo_path : null });
router.get('/pharmacies', { perm: 'settings.manage', needsPharmacy: false }, (ctx) => (ctx.user.role === 'super_admin' ? all('SELECT * FROM pharmacies ORDER BY id') : all('SELECT * FROM pharmacies WHERE id=?', ctx.ph)).map(phView));
router.post('/pharmacies', { perm: 'pharmacies.manage', needsPharmacy: false }, (ctx) => {
  const o = phInput(ctx.body); const src = ctx.body.copy_catalog_from ? int(ctx.body.copy_catalog_from, 'pharmacie source', { min: 1 }) : null; if (src && !get('SELECT 1 FROM pharmacies WHERE id=?', src)) throw bad('VALIDATION', 'Pharmacie source inconnue');
  const id = tx(() => { const id = insert(`INSERT INTO pharmacies(${Object.keys(o).join(',')},appointments_enabled) VALUES (${Object.keys(o).map(() => '?').join(',')},?)`, ...Object.values(o), ctx.body.appointments_enabled ? 1 : 0); insert('INSERT INTO cash_registers(pharmacy_id,name) VALUES (?,?)', id, 'Caisse 1'); ensurePharmacyMethods(id);
    if (src) run('INSERT INTO pharmacy_catalog(pharmacy_id,product_id) SELECT ?, product_id FROM pharmacy_catalog WHERE pharmacy_id=?', id, src); audit(ctx, 'pharmacy.create', 'pharmacy', id, undefined, { ...o, copy_catalog_from: src }); return id; });
  return { id };
});
router.put('/pharmacies/:id', { perm: 'settings.manage', needsPharmacy: false }, (ctx) => {
  const id = Number(ctx.params.id); if (ctx.user.role !== 'super_admin' && id !== ctx.ph) throw forbidden();
  const old = get('SELECT * FROM pharmacies WHERE id=?', id); if (!old) throw notFound('Établissement');
  const o = phInput({ ...old, ...ctx.body }); if (ctx.user.role !== 'super_admin' && o.country_id !== old.country_id) throw forbidden('Seul le super-administrateur change le pays');
  const ap = ctx.user.role === 'super_admin' && ctx.body.appointments_enabled !== undefined ? (ctx.body.appointments_enabled ? 1 : 0) : old.appointments_enabled;
  run(`UPDATE pharmacies SET ${Object.keys(o).map((k) => k + '=?').join(',')}, appointments_enabled=? WHERE id=?`, ...Object.values(o), ap, id); audit(ctx, 'pharmacy.update', 'pharmacy', id, old, { ...o, appointments_enabled: ap }); return { ok: true };
});
const SETTING_KEYS = { expiry_warning_days: 'int', stock_method: ['FEFO', 'FIFO'], max_discount_percent: 'int', refund_approval_threshold: 'int', reservation_hours: 'int', loyalty_points_per_unit: 'int', prescription_validity_days: 'int', min_days_before_expiry_sale: 'int', min_shelf_life_days_receipt: 'int', temp_min: 'int', temp_max: 'int', po_four_eyes: ['true', 'false'], credit_limit: 'int', brand_color: 'color', brand_name: 'text', delivery_fee: 'int' };
router.get('/settings', { perm: 'settings.manage' }, (ctx) => Object.fromEntries([...all('SELECT skey,svalue FROM settings WHERE pharmacy_id=0'), ...all('SELECT skey,svalue FROM settings WHERE pharmacy_id=?', ctx.ph)].map((r) => [r.skey, r.svalue])));
router.put('/settings', { perm: 'settings.manage', ok200: true }, (ctx) => {
  tx(() => {
    for (const [k, v] of Object.entries(ctx.body)) {
      const t = SETTING_KEYS[k]; if (!t) throw bad('VALIDATION', `Paramètre inconnu : ${k}`);
      if (t === 'int') int(Number(v), k, { min: -50, max: 10000000 }); else if (t === 'color') { if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) throw bad('VALIDATION', 'Couleur invalide (#RRGGBB)'); } else if (t === 'text') { if (String(v).length > 60) throw bad('VALIDATION', 'Texte trop long (60 max)'); } else oneOf(String(v), k, t);
      run('INSERT INTO settings(pharmacy_id,skey,svalue) VALUES (?,?,?) ON CONFLICT(pharmacy_id,skey) DO UPDATE SET svalue=excluded.svalue', ctx.ph, k, String(v));
    }
    audit(ctx, 'settings.update', 'settings', ctx.ph, undefined, ctx.body);
  }); return { ok: true };
});

// ---------- audit ----------
router.get('/audit', { perm: 'audit.view', needsPharmacy: false }, (ctx) => {
  const w = ['1=1'], p = [];
  if (ctx.user.role !== 'super_admin') { w.push('a.pharmacy_id=?'); p.push(ctx.ph); } else if (ctx.query.pharmacy_id) { w.push('a.pharmacy_id=?'); p.push(ctx.query.pharmacy_id); }
  for (const [k, c] of [['user_id', 'a.user_id'], ['entity', 'a.entity'], ['action', 'a.action']]) if (ctx.query[k]) { w.push(`${c}=?`); p.push(ctx.query[k]); }
  if (ctx.query.q) { w.push('(a.action LIKE ? OR a.user_email LIKE ? OR a.entity_id LIKE ? OR a.entity LIKE ? OR a.ip LIKE ?)'); p.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`, `%${ctx.query.q}%`, `%${ctx.query.q}%`, `%${ctx.query.q}%`); }
  if (ctx.query.from) { w.push('a.created_at >= ?'); p.push(ctx.query.from); } if (ctx.query.to) { w.push('a.created_at <= ?'); p.push(ctx.query.to + ' 23:59:59'); }
  const out = paged(ctx, `SELECT COUNT(*) n FROM audit_logs a WHERE ${w.join(' AND ')}`, `SELECT a.* FROM audit_logs a WHERE ${w.join(' AND ')} ORDER BY a.id DESC`, p);
  return resolveOrigins(out);
});
// Appareil lisible à partir du user-agent.
export function deviceOf(ua) {
  if (!ua) return null; const u = String(ua);
  const os = /Windows NT 1[01]/.test(u) ? 'Windows' : /Windows/.test(u) ? 'Windows' : /Android ([\d.]+)/.test(u) ? 'Android ' + u.match(/Android ([\d.]+)/)[1] : /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Mac OS X/.test(u) ? 'macOS' : /CrOS/.test(u) ? 'ChromeOS' : /Linux/.test(u) ? 'Linux' : 'Système inconnu';
  const br = /Edg\/([\d]+)/.test(u) ? 'Edge ' + u.match(/Edg\/(\d+)/)[1] : /OPR\/([\d]+)/.test(u) ? 'Opera ' + u.match(/OPR\/(\d+)/)[1] : /Firefox\/([\d]+)/.test(u) ? 'Firefox ' + u.match(/Firefox\/(\d+)/)[1] : /Chrome\/([\d]+)/.test(u) ? 'Chrome ' + u.match(/Chrome\/(\d+)/)[1] : /Safari\/[\d.]+/.test(u) && /Version\/([\d]+)/.test(u) ? 'Safari ' + u.match(/Version\/(\d+)/)[1] : /okhttp|Expo|ReactNative/i.test(u) ? 'Application mobile' : /node|curl|python|axios/i.test(u) ? 'Script / API' : 'Navigateur inconnu';
  const kind = /Mobile|iPhone|Android.*Mobile/.test(u) ? 'Téléphone' : /iPad|Tablet|Android(?!.*Mobile)/.test(u) ? 'Tablette' : 'Ordinateur';
  return `${kind} · ${os} · ${br}`;
}
const isPrivate = (ip) => !ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fe80:|fc|fd)/i.test(ip) || ip === 'localhost';
// Localisation approximative (ville / pays) via un service de géolocalisation d'adresses IP, mise en cache ; l'adresse reste affichée même si le service est injoignable.
async function resolveOrigins(out) {
  const ips = [...new Set(out.data.map((a) => a.ip).filter((x) => x && !isPrivate(x)))]; let budget = 8;
  for (const ip of ips) { if (get('SELECT 1 FROM ip_geo WHERE ip=?', ip) || budget <= 0) continue; budget--;
    try { const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,region,city,connection,latitude,longitude`, { signal: AbortSignal.timeout(2500) }); const j = await r.json();
      if (j.success) run('INSERT OR REPLACE INTO ip_geo(ip,country,region,city,isp,lat,lng) VALUES (?,?,?,?,?,?,?)', ip, j.country || null, j.region || null, j.city || null, j.connection?.isp || null, j.latitude ?? null, j.longitude ?? null); } catch { /* service injoignable : on réessaiera */ } }
  for (const a of out.data) { const g = a.ip && !isPrivate(a.ip) ? get('SELECT * FROM ip_geo WHERE ip=?', a.ip) : null; a.place = !a.ip ? null : isPrivate(a.ip) ? 'Réseau local / serveur de test' : g ? [g.city, g.region, g.country].filter(Boolean).join(', ') + (g.isp ? ` (${g.isp})` : '') : 'Localisation indisponible'; a.device = deviceOf(a.user_agent); delete a.user_agent; }
  return out;
}

// ---------- notifications & temps réel ----------
router.get('/notifications', { perm: 'dashboard.view', anyPerm: null }, (ctx) => notificationsFor(ctx));
router.get('/portal/notifications', { anyPerm: ['portal.use', 'portal.guest', 'driver.use', 'doctor.use'], needsPharmacy: false }, (ctx) => { return all('SELECT id,kind,title,body,link,is_read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', ctx.user.id); });
function notificationsFor(ctx) {
  const aud = ctx.user.role.startsWith('pharmacist') ? ['pharmacist', 'stock', 'staff'] : ['stock', 'staff'];
  const rows = all(`SELECT id,kind,title,body,link,is_read,created_at,audience FROM notifications WHERE (user_id=? OR (user_id IS NULL AND pharmacy_id=? AND (audience IS NULL OR audience IN (${aud.map(() => '?').join(',')})))) ORDER BY id DESC LIMIT 60`, ctx.user.id, ctx.ph, ...aud);
  return { unread: rows.filter((r) => !r.is_read).length, data: rows };
}
router.post('/notifications/read', { anyPerm: ['dashboard.view', 'portal.use', 'portal.guest', 'driver.use', 'doctor.use'], ok200: true, needsPharmacy: false }, (ctx) => {
  const ids = (Array.isArray(ctx.body.ids) ? ctx.body.ids : []).map(Number).filter(Number.isInteger);
  if (ids.length) run(`UPDATE notifications SET is_read=1 WHERE id IN (${ids.map(() => '?').join(',')}) AND (user_id=? OR user_id IS NULL)`, ...ids, ctx.user.id);
  else run('UPDATE notifications SET is_read=1 WHERE (user_id=? OR (user_id IS NULL AND pharmacy_id=?))', ctx.user.id, ctx.ph ?? -1);
  return { ok: true };
});
router.get('/events', { needsPharmacy: false, stream: true }, (ctx) => sseHandler(ctx));

// ---------- documentation OpenAPI (générée depuis la table de routes) ----------
router.get('/openapi.json', { public: true }, () => {
  const paths = {};
  for (const r of registry) {
    const p = r.path.replace(/^\/api\/v1/, '').replace(/:([a-zA-Z_]+)/g, '{$1}');
    (paths[p] ||= {})[r.method.toLowerCase()] = { summary: r.opts.perm ? `Permission : ${r.opts.perm}` : r.opts.public ? 'Public' : 'Authentifié', security: r.opts.public ? [] : [{ bearer: [] }], parameters: [...r.keys.map((k) => ({ name: k, in: 'path', required: true, schema: { type: 'string' } }))], responses: { 200: { description: 'OK' }, 401: { description: 'Non authentifié' }, 403: { description: 'Interdit' } } };
  }
  return { openapi: '3.0.3', info: { title: 'Gestion_pharmacie API', version: '1.0.0-dev' }, servers: [{ url: '/api/v1' }], components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } }, paths };
});
