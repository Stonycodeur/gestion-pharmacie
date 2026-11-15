import { reviveExpired } from '../account-status.js';
import { router, config, audit, can } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { HttpError, bad, str, email as vEmail, addDays, nowSql } from '../util.js';
import { hashPassword, verifyPassword, passwordPolicy, signJwt, randomToken, sha256, rateLimit, newTotpSecret, verifyTotp } from '../security.js';
import { userPerms } from '../rbac.js';
import { ensurePharmacyMethods } from '../paymodes.js';
import { sendMail, mailEnabled } from '../mailer.js';

const publicUser = (u) => ({ avatar_url: u.avatar_path ? `/api/v1/public/file/${u.avatar_path}` : null, is_primary: !!u.is_primary, is_guest: !!u.is_guest, phone: u.phone ?? null, id: u.id, email: u.email, name: u.name, role: u.role_code ?? u.role, pharmacy_id: u.pharmacy_id, lang: u.lang, mfa_enabled: !!u.mfa_enabled, must_change_password: !!u.must_change_password });
const isPrivileged = (u) => !!get('SELECT privileged FROM roles WHERE code=?', u.role_code)?.privileged;

function issue(u, ctx, family = randomToken(12)) {
  const mfaPending = config.mfaRequired && isPrivileged(u) && !u.mfa_enabled;
  const access = signJwt({ typ: 'access', sub: u.id, mfa_pending: mfaPending || undefined }, config.secret, config.accessTtl);
  const refresh = randomToken(40);
  insert('INSERT INTO refresh_tokens(user_id,token_hash,family,expires_at,device,ip) VALUES (?,?,?,?,?,?)', u.id, sha256(refresh), family, addDays(nowSql(), config.refreshDays), String(ctx.req.headers['user-agent'] || '').slice(0, 200), ctx.ip);
  const cookie = `rt=${refresh}; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=${config.refreshDays * 86400}${config.prod ? '; Secure' : ''}`;
  const out = { access_token: access, expires_in: config.accessTtl, user: publicUser(u), permissions: userPerms(u.id, u.role_code), mfa_setup_required: mfaPending };
  if (ctx.req.headers['x-client'] === 'mobile') out.refresh_token = refresh;
  return { out, cookie };
}
const cookieOf = (req, n) => (req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).find(([k]) => k === n)?.[1];

router.post('/auth/login', { public: true, ok200: true }, (ctx) => {
  const em = vEmail(ctx.body.email, 'e-mail', { required: true });
  const pw = str(ctx.body.password, 'mot de passe', { required: true, max: 200 });
  const rl = rateLimit(`login:${ctx.ip}:${em}`, 10, 15 * 60000);
  if (!rl.ok) throw new HttpError(429, 'RATE_LIMITED', 'Trop de tentatives, réessayez plus tard', { retryAfter: rl.retryAfter });
  const u = get('SELECT * FROM users WHERE email=?', em); reviveExpired(u);
  const fail = (why) => { insert('INSERT INTO login_attempts(email,ip,success) VALUES (?,?,0)', em, ctx.ip); audit({ ...ctx, email: em, ph: u?.pharmacy_id }, 'auth.login_failed', 'user', u?.id, undefined, { why }); };
  if (u?.locked_until && u.locked_until > nowSql()) { fail('locked'); throw new HttpError(423, 'ACCOUNT_LOCKED', 'Compte temporairement verrouillé suite à des échecs répétés'); }
  if (!u || !verifyPassword(pw, u.password_hash)) {
    if (u) {
      const n = u.failed_attempts + 1;
      const lock = n >= 5 ? addDays(nowSql(), 0) : null;
      run('UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?', n, n >= 5 ? new Date(Date.now() + Math.min(60, 5 * (n - 4)) * 60000).toISOString().slice(0, 19).replace('T', ' ') : null, u.id);
      void lock;
    }
    fail('bad_credentials'); throw new HttpError(401, 'INVALID_CREDENTIALS', 'Identifiants invalides');
  }
  if (u.status !== 'active') { fail('inactive'); throw new HttpError(403, 'ACCOUNT_DISABLED', 'Compte suspendu ou désactivé'); }
  if (u.role_code !== 'super_admin' && u.pharmacy_id && get('SELECT status FROM pharmacies WHERE id=?', u.pharmacy_id)?.status !== 'active') { fail('inactive'); throw new HttpError(403, 'PHARMACY_DISABLED', 'Établissement désactivé : contactez le super-administrateur'); }
  if (u.mfa_enabled) {
    const otp = ctx.body.otp;
    if (!otp) throw new HttpError(401, 'OTP_REQUIRED', 'Code de double authentification requis');
    if (!verifyTotp(u.mfa_secret, otp)) { fail('bad_otp'); throw new HttpError(401, 'INVALID_OTP', 'Code invalide'); }
  }
  run("UPDATE users SET failed_attempts=0, locked_until=NULL, last_login_at=datetime('now') WHERE id=?", u.id);
  insert('INSERT INTO login_attempts(email,ip,success) VALUES (?,?,1)', em, ctx.ip);
  audit({ ...ctx, email: em, user: u, ph: u.pharmacy_id }, 'auth.login', 'user', u.id);
  const { out, cookie } = issue(u, ctx);
  ctx.res.setHeader('Set-Cookie', cookie);
  return out;
});

// Mode invité : compte éphémère sans e-mail ni historique (seules les commandes en cours restent visibles).
router.post('/auth/guest', { public: true, ok200: true }, (ctx) => {
  const rl = rateLimit(`guest:${ctx.ip}`, 20, 60 * 60000); if (!rl.ok) throw new HttpError(429, 'RATE_LIMITED', 'Trop de sessions invité, réessayez plus tard', { retryAfter: rl.retryAfter });
  const tag = randomToken(6);
  const gc = Number(ctx.body?.country_id) ? get('SELECT id FROM countries WHERE id=? AND active=1', Number(ctx.body.country_id))?.id ?? null : null;
  const id = insert("INSERT INTO users(email,password_hash,name,role_code,pharmacy_id,must_change_password,is_guest,country_id) VALUES (?,?,?,?,NULL,0,1,?)", `guest-${tag}@guest.invalid`, hashPassword(randomToken(24) + 'aA1'), 'Invité', 'guest', gc);
  const u = get('SELECT * FROM users WHERE id=?', id); const { out, cookie } = issue(u, ctx); ctx.res.setHeader('Set-Cookie', cookie); audit({ ...ctx, ph: null }, 'auth.guest', 'user', id); return out;
});
// Une session reprenable existe-t-elle ? (ne consomme pas le jeton ; répond toujours 200 : pas d'erreur 401 à l'ouverture de la page de connexion)
router.get('/auth/session', { public: true }, (ctx) => {
  const token = cookieOf(ctx.req, 'rt'); if (!token) return { active: false };
  const t = get('SELECT revoked,expires_at FROM refresh_tokens WHERE token_hash=?', sha256(token));
  return { active: !!t && !t.revoked && t.expires_at >= nowSql() };
});
router.post('/auth/refresh', { public: true, ok200: true }, (ctx) => {
  const fromCookie = cookieOf(ctx.req, 'rt');
  if (fromCookie && ctx.req.headers['x-requested-with'] !== 'XMLHttpRequest') throw new HttpError(403, 'CSRF', 'En-tête requis');
  const token = ctx.body.refresh_token || fromCookie;
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Session absente');
  let reuse = false;
  const res = tx(() => {
    const t = get('SELECT * FROM refresh_tokens WHERE token_hash=?', sha256(token));
    if (!t) throw new HttpError(401, 'UNAUTHENTICATED', 'Session invalide');
    if (t.revoked) { run('UPDATE refresh_tokens SET revoked=1 WHERE family=?', t.family); audit(ctx, 'auth.refresh_reuse', 'user', t.user_id); reuse = true; return null; } // la révocation de la famille doit être VALIDÉE (pas annulée par une exception)
    if (t.expires_at < nowSql()) throw new HttpError(401, 'UNAUTHENTICATED', 'Session expirée');
    const u = get('SELECT * FROM users WHERE id=?', t.user_id); reviveExpired(u);
    if (!u || u.status !== 'active') throw new HttpError(401, 'UNAUTHENTICATED', 'Compte inactif');
    run('UPDATE refresh_tokens SET revoked=1 WHERE id=?', t.id);
    const { out, cookie } = issue(u, ctx, t.family);
    ctx.res.setHeader('Set-Cookie', cookie);
    return out;
  });
  if (reuse) throw new HttpError(401, 'UNAUTHENTICATED', 'Session révoquée');
  return res;
});

router.post('/auth/logout', { public: true, ok200: true }, (ctx) => {
  const token = ctx.body.refresh_token || cookieOf(ctx.req, 'rt');
  if (token) run('UPDATE refresh_tokens SET revoked=1 WHERE token_hash=?', sha256(token));
  ctx.res.setHeader('Set-Cookie', `rt=; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=0`);
  return { ok: true };
});

router.get('/auth/me', { allowMfaPending: true, needsPharmacy: false }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.user.id);
  return { user: publicUser(u), permissions: userPerms(u.id, u.role_code), pharmacy: ctx.ph ? get('SELECT p.id,p.name,p.currency,p.currency_decimals,p.timezone,p.invoice_prefix,p.country_id,p.logo_path,c.dial_code,c.iso2 FROM pharmacies p LEFT JOIN countries c ON c.id=p.country_id WHERE p.id=?', ctx.ph) : null, avatar_url: u.avatar_path ? `/api/v1/public/file/${u.avatar_path}` : null, mfa_setup_required: ctx.user.mfaPending };
});

router.post('/auth/change-password', { allowMfaPending: true, needsPharmacy: false, ok200: true }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.user.id);
  if (!verifyPassword(String(ctx.body.current || ''), u.password_hash)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Mot de passe actuel incorrect');
  const pol = passwordPolicy(ctx.body.password); if (pol) throw bad('WEAK_PASSWORD', pol);
  run("UPDATE users SET password_hash=?, must_change_password=0, updated_at=datetime('now') WHERE id=?", hashPassword(ctx.body.password), u.id);
  run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=?', u.id);
  audit(ctx, 'auth.password_change', 'user', u.id);
  return { ok: true };
});

router.post('/auth/mfa/setup', { allowMfaPending: true, needsPharmacy: false, ok200: true }, (ctx) => {
  const secret = newTotpSecret();
  run('UPDATE users SET mfa_secret=?, mfa_enabled=0 WHERE id=?', secret, ctx.user.id);
  return { secret, otpauth: `otpauth://totp/Gestion_pharmacie:${encodeURIComponent(ctx.user.email)}?secret=${secret}&issuer=Gestion_pharmacie` };
});
router.post('/auth/mfa/enable', { allowMfaPending: true, needsPharmacy: false, ok200: true }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.user.id);
  if (!u.mfa_secret || !verifyTotp(u.mfa_secret, ctx.body.code)) throw new HttpError(400, 'INVALID_OTP', 'Code invalide');
  run('UPDATE users SET mfa_enabled=1 WHERE id=?', u.id);
  audit(ctx, 'auth.mfa_enable', 'user', u.id);
  const { out, cookie } = issue({ ...u, mfa_enabled: 1 }, ctx);
  ctx.res.setHeader('Set-Cookie', cookie);
  return out;
});
router.post('/auth/mfa/disable', { needsPharmacy: false, ok200: true }, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.user.id);
  if (!verifyPassword(String(ctx.body.password || ''), u.password_hash) || !verifyTotp(u.mfa_secret, ctx.body.code)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Vérification échouée');
  if (config.mfaRequired && isPrivileged(u)) throw new HttpError(403, 'MFA_MANDATORY', 'La MFA est obligatoire pour ce rôle');
  run('UPDATE users SET mfa_enabled=0, mfa_secret=NULL WHERE id=?', u.id);
  audit(ctx, 'auth.mfa_disable', 'user', u.id);
  return { ok: true };
});

// Inscription d'un client (espace client)
router.post('/auth/register', { public: true }, (ctx) => {
  const b = ctx.body;
  const name = str(b.name, 'nom', { required: true, max: 120 }), em = vEmail(b.email, 'e-mail', { required: true });
  const pol = passwordPolicy(b.password); if (pol) throw bad('WEAK_PASSWORD', pol);
  const rl = rateLimit('register:' + ctx.ip, 5, 3600e3); if (!rl.ok) throw new HttpError(429, 'RATE_LIMITED', 'Trop d\'inscriptions');
  // Le pays est obligatoire : l'inscription n'est possible que s'il existe au moins une pharmacie active dans ce pays.
  const country = Number(b.country_id) ? get('SELECT * FROM countries WHERE id=? AND active=1', Number(b.country_id)) : null; if (!country) throw bad('VALIDATION', 'Choisissez votre pays');
  const inCountry = all("SELECT id FROM pharmacies WHERE status='active' AND public_listed=1 AND country_id=? ORDER BY id", country.id);
  if (!inCountry.length) throw bad('NO_PHARMACY_IN_COUNTRY', `Aucune pharmacie n'est encore disponible en ${country.name_fr} : l'inscription est impossible pour le moment`);
  const ph = Number(b.pharmacy_id) || inCountry[0].id; if (!inCountry.some((x) => x.id === ph)) throw bad('VALIDATION', 'Cette pharmacie n\'est pas dans votre pays');
  if (get('SELECT 1 FROM users WHERE email=?', em)) throw new HttpError(409, 'DUPLICATE', 'Un compte existe déjà avec cet e-mail');
  return tx(() => {
    const uid = insert("INSERT INTO users(email,password_hash,name,role_code,pharmacy_id,phone,country_id) VALUES (?,?,?,'customer',?,?,?)", em, hashPassword(b.password), name, ph, str(b.phone, 'téléphone', { max: 40 }), country.id);
    insert('INSERT INTO customers(pharmacy_id,user_id,name,phone,email,marketing_consent,consent_at) VALUES (?,?,?,?,?,?,?)', ph, uid, name, str(b.phone, 'téléphone', { max: 40 }), em, b.marketing_consent ? 1 : 0, b.marketing_consent ? nowSql() : null);
    audit({ ...ctx, email: em, ph }, 'auth.register', 'user', uid);
    return { id: uid };
  });
});

// ---------- première configuration (aucun compte n'existe) ----------
router.get('/auth/setup-status', { public: true }, () => ({ needed: get('SELECT COUNT(*) n FROM users').n === 0, token_required: config.prod }));
router.post('/auth/setup', { public: true }, (ctx) => {
  if (config.prod && (!process.env.SETUP_TOKEN || ctx.req.headers['x-setup-token'] !== process.env.SETUP_TOKEN)) throw new HttpError(403, 'SETUP_TOKEN', 'Jeton de première configuration invalide');
  const rl = rateLimit('setup:' + ctx.ip, 10, 3600e3); if (!rl.ok) throw new HttpError(429, 'RATE_LIMITED', 'Trop de tentatives');
  const b = ctx.body, p = b.pharmacy || {}, a = b.admin || {};
  const pol = passwordPolicy(a.password); if (pol) throw bad('WEAK_PASSWORD', pol);
  const em = vEmail(a.email, 'e-mail', { required: true }), name = str(a.name, 'nom', { required: true, max: 120 });
  const ph = { name: str(p.name, 'nom de la pharmacie', { required: true, max: 160 }), address: str(p.address, 'adresse', { max: 300 }), phone: str(p.phone, 'téléphone', { max: 40 }), currency: str(p.currency || 'TND', 'devise', { max: 8 }), dec: Number.isInteger(p.currency_decimals) ? p.currency_decimals : 3, tz: str(p.timezone || 'Africa/Tunis', 'fuseau', { max: 60 }) };
  return tx(() => {
    if (get('SELECT COUNT(*) n FROM users').n > 0) throw new HttpError(409, 'ALREADY_SETUP', 'Le système est déjà configuré');
    const phId = insert('INSERT INTO pharmacies(name,address,phone,currency,currency_decimals,timezone) VALUES (?,?,?,?,?,?)', ph.name, ph.address, ph.phone, ph.currency, ph.dec, ph.tz);
    insert('INSERT INTO cash_registers(pharmacy_id,name) VALUES (?,?)', phId, 'Caisse 1'); ensurePharmacyMethods(phId);
    const uid = insert("INSERT INTO users(email,password_hash,name,role_code,pharmacy_id) VALUES (?,?,?,'super_admin',NULL)", em, hashPassword(a.password), name);
    audit({ ...ctx, email: em, ph: phId }, 'system.setup', 'pharmacy', phId, undefined, { pharmacy: ph.name, admin: em });
    return { ok: true, user_id: uid, pharmacy_id: phId };
  });
});

// Identité visuelle (couleur d'accent et nom affiché) : publique, pour personnaliser l'écran de connexion avant authentification
router.get('/branding', { public: true }, () => {
  const ph = get("SELECT id,name FROM pharmacies WHERE status='active' ORDER BY id LIMIT 1");
  const v = (k) => get('SELECT svalue v FROM settings WHERE pharmacy_id IN (0,?) AND skey=? ORDER BY pharmacy_id DESC LIMIT 1', ph?.id ?? 0, k)?.v;
  return { name: v('brand_name') || ph?.name || 'Gestion Pharmacie', color: /^#[0-9a-fA-F]{6}$/.test(v('brand_color') || '') ? v('brand_color') : '#0f766e' };
});

// ---------- mot de passe oublié (libre-service) ----------
const sqlIn = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
router.post('/auth/forgot', { public: true, ok200: true }, (ctx) => {
  const em = vEmail(ctx.body.email, 'e-mail', { required: true });
  const r1 = rateLimit(`forgot-ip:${ctx.ip}`, 10, 3600000), r2 = rateLimit(`forgot:${em}`, 3, 3600000);
  if (!r1.ok || !r2.ok) throw new HttpError(429, 'RATE_LIMITED', 'Trop de demandes, réessayez plus tard');
  const u = get("SELECT * FROM users WHERE email=? AND status='active'", em);
  if (u) {
    const token = randomToken(32); run('UPDATE password_resets SET used_at=datetime(\'now\') WHERE user_id=? AND used_at IS NULL', u.id);
    insert('INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES (?,?,?)', u.id, sha256(token), sqlIn(3600000));
    const link = `${(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/#/reset?token=${token}`;
    audit({ ...ctx, email: em, ph: u.pharmacy_id }, 'auth.forgot', 'user', u.id);
    if (mailEnabled()) sendMail({ to: u.email, subject: 'Réinitialisation de votre mot de passe', text: `Bonjour ${u.name},\n\nPour choisir un nouveau mot de passe (lien valable 1 heure) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.` }).catch((e) => console.error('[mail]', e.message));
    else if (!config.prod) console.log(`[DEV] SMTP non configuré — lien de réinitialisation pour ${u.email} : ${link}`);
    else console.error('[mail] SMTP non configuré : impossible d\'envoyer le lien de réinitialisation');
  }
  return { ok: true, message: 'Si un compte existe pour cet e-mail, un lien vient d\'être envoyé.' }; // réponse identique : pas d'énumération de comptes
});
router.post('/auth/reset', { public: true, ok200: true }, (ctx) => {
  const rl = rateLimit(`reset:${ctx.ip}`, 20, 3600000); if (!rl.ok) throw new HttpError(429, 'RATE_LIMITED', 'Trop de tentatives');
  const pw = String(ctx.body.password || ''); const pol = passwordPolicy(pw); if (pol) throw bad('WEAK_PASSWORD', pol);
  const row = get("SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at > datetime('now')", sha256(String(ctx.body.token || '')));
  if (!row) throw new HttpError(400, 'INVALID_TOKEN', 'Lien invalide ou expiré : refaites une demande');
  const u = get("SELECT * FROM users WHERE id=? AND status='active'", row.user_id); if (!u) throw new HttpError(400, 'INVALID_TOKEN', 'Lien invalide ou expiré');
  tx(() => { run("UPDATE users SET password_hash=?, must_change_password=0, failed_attempts=0, locked_until=NULL, updated_at=datetime('now') WHERE id=?", hashPassword(pw), u.id); run("UPDATE password_resets SET used_at=datetime('now') WHERE user_id=? AND used_at IS NULL", u.id); run('UPDATE refresh_tokens SET revoked=1 WHERE user_id=?', u.id); audit({ ...ctx, email: u.email, ph: u.pharmacy_id }, 'auth.reset_password', 'user', u.id); });
  return { ok: true };
});
