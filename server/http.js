// Mini-framework HTTP : routeur, authentification, permissions, audit, SSE.
import { reviveExpired } from './account-status.js';
import { sendMail, sendSms, mailEnabled, smsEnabled } from './mailer.js';
import { sendPush } from './push.js';
import { get, all, run, insert } from './db.js';
import { HttpError, forbidden, paging } from './util.js';
import { verifyJwt, rateLimit } from './security.js';
import { userHas } from './rbac.js';

export const config = {
  prod: process.env.NODE_ENV === 'production',
  secret: process.env.JWT_SECRET || 'dev-only-change-me-dev-only-change-me',
  accessTtl: (parseInt(process.env.ACCESS_TTL_MIN) || 15) * 60,
  refreshDays: parseInt(process.env.REFRESH_TTL_DAYS) || 14,
  mfaRequired: process.env.MFA_REQUIRED_FOR_PRIVILEGED === 'true',
  cors: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};
if (config.prod && (config.secret.length < 32 || config.secret.startsWith('dev-only')))
  throw new Error('JWT_SECRET doit être défini (>= 32 caractères) en production');

const routes = [];
export const registry = routes;
const compile = (path) => {
  const keys = []; const re = new RegExp('^' + path.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { re, keys };
};
function add(method, path, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  routes.push({ method, path: '/api/v1' + path, ...compile('/api/v1' + path), opts, handler });
}
export const router = {
  get: (p, o, h) => add('GET', p, o, h), post: (p, o, h) => add('POST', p, o, h),
  put: (p, o, h) => add('PUT', p, o, h), patch: (p, o, h) => add('PATCH', p, o, h), delete: (p, o, h) => add('DELETE', p, o, h),
};

// ---------- contexte / droits ----------
export function can(user, perm) { return !!user && userHas(user.id, user.role, perm); }
export function need(ctx, perm) { if (!can(ctx.user, perm)) throw forbidden(`Permission requise : ${perm}`, 'PERMISSION_DENIED'); }

// Journal d'audit (ajout seul). `view` = consultation de donnée sensible.
export function audit(ctx, action, entity, entityId, oldV, newV) {
  insert('INSERT INTO audit_logs(pharmacy_id,user_id,user_email,action,entity,entity_id,old_json,new_json,ip) VALUES (?,?,?,?,?,?,?,?,?)',
    ctx.ph ?? ctx.user?.pharmacy_id ?? null, ctx.user?.id ?? null, ctx.user ? (ctx.user.email + (ctx.user.impersonatorEmail ? ` (par ${ctx.user.impersonatorEmail})` : '')) : (ctx.email ?? null), action, entity ?? null,
    entityId == null ? null : String(entityId), oldV === undefined ? null : JSON.stringify(oldV), newV === undefined ? null : JSON.stringify(newV), ctx.ip ?? null);
}

// ---------- SSE (temps réel) ----------
const clients = new Set();
export function publish(pharmacyId, event, data, userId = null) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if ((c.ph === pharmacyId || c.ph === null) && (userId == null ? c.staff : c.userId === userId)) { try { c.res.write(msg); } catch { clients.delete(c); } }
}
// Copie e-mail / SMS des notifications destinées aux CLIENTS (commande prête, ordonnance, etc.), si les canaux sont configurés
function deliverExternal(userId, title, body, link) {
  try {
    const u = get("SELECT email,phone,name,role_code,status FROM users WHERE id=?", userId); if (!u || u.status !== 'active') return;
    let n = {}; try { n = JSON.parse(get('SELECT data FROM user_preferences WHERE user_id=?', userId)?.data || '{}').notify || {}; } catch { /* préférences illisibles : valeurs par défaut */ }
    if (n.push !== false) sendPush(userId, title, body, link ? { link } : {}).catch((e) => console.error('[push]', e.message));
    if (u.role_code !== 'customer') return; // e-mail / SMS : réservés aux clients (le personnel a la cloche et le push)
    const text = body ? `${title}\n\n${body}` : title;
    if (n.email !== false && mailEnabled() && u.email) sendMail({ to: u.email, subject: title, text: `Bonjour ${u.name},\n\n${text}` }).catch((e) => console.error('[mail]', e.message));
    if (n.sms !== false && smsEnabled() && u.phone) sendSms({ to: u.phone, text }).catch((e) => console.error('[sms]', e.message));
  } catch (e) { console.error('[notify]', e.message); }
}
export function notify({ pharmacyId, userId = null, audience = null, kind, title, body = null, dedupe = null, link = null }) {
  if (dedupe && get('SELECT 1 FROM notifications WHERE dedupe_key=?', dedupe)) return null;
  const id = insert('INSERT INTO notifications(pharmacy_id,user_id,audience,kind,title,body,dedupe_key,link) VALUES (?,?,?,?,?,?,?,?)', pharmacyId, userId, audience, kind, title, body, dedupe, link);
  publish(pharmacyId, 'notification', { id, kind, title, body, audience, link }, userId);
  if (userId) deliverExternal(userId, title, body, link);
  return id;
}
setInterval(() => { for (const c of clients) try { c.res.write(': ping\n\n'); } catch { clients.delete(c); } }, 25000).unref();

// ---------- traitement des requêtes ----------
async function readBody(req, limit = 8 * 1024 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Requête trop volumineuse'); chunks.push(c); }
  if (!n) return {};
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON attendu');
  const rawText = Buffer.concat(chunks).toString('utf8'); req.rawBody = rawText;
  try { return JSON.parse(rawText); } catch { throw new HttpError(400, 'BAD_JSON', 'JSON invalide'); }
}

export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (config.prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

// X-Forwarded-For n'est pris en compte que derrière un proxy de confiance (TRUSTED_PROXY=true) et on lit le DERNIER saut (ajouté par le proxy), jamais une valeur fournie par le client.
export const clientIp = (req) => { const xf = process.env.TRUSTED_PROXY === 'true' && req.headers['x-forwarded-for']; return (xf ? String(xf).split(',').pop().trim() : req.socket.remoteAddress) || ''; };

export async function handleApi(req, res, url) {
  const origin = req.headers.origin;
  if (origin && config.cors.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,x-pharmacy-id,x-client,x-requested-with,idempotency-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  const ip = clientIp(req);
  const send = (status, obj, headers = {}) => {
    const body = JSON.stringify(obj); res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(body);
  };
  try {
    const rl = rateLimit('api:' + ip, 600, 60000);
    if (!rl.ok) throw new HttpError(429, 'RATE_LIMITED', 'Trop de requêtes', { retryAfter: rl.retryAfter });
    let route = null, params = {};
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      route = r; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]))); break;
    }
    if (!route) throw pathMatched ? new HttpError(405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée') : new HttpError(404, 'NOT_FOUND', 'Route inconnue');
    const ctx = { req, res, ip, params, query: Object.fromEntries(url.searchParams), body: {}, user: null, ph: null, send };
    if (!route.opts.public) {
      const h = req.headers.authorization || '';
      const claims = h.startsWith('Bearer ') ? verifyJwt(h.slice(7), config.secret) : null;
      if (!claims || claims.typ !== 'access') throw new HttpError(401, 'UNAUTHENTICATED', 'Authentification requise');
      const u = get('SELECT id,email,name,role_code,pharmacy_id,status,suspended_until,lang,mfa_enabled,must_change_password FROM users WHERE id=?', claims.sub); reviveExpired(u);
      if (!u || u.status !== 'active') throw new HttpError(401, 'UNAUTHENTICATED', 'Compte inactif');
      ctx.user = { ...u, role: u.role_code, mfaPending: !!claims.mfa_pending };
      if (claims.imp) { // session de prise de contrôle (super-administrateur) : tracée, courte, et sans action sur les comptes/mots de passe
        const adm = get("SELECT id,email FROM users WHERE id=? AND role_code='super_admin' AND status='active'", claims.imp); if (!adm) throw new HttpError(401, 'UNAUTHENTICATED', 'Session de prise de contrôle invalide');
        ctx.user.impersonator = adm.id; ctx.user.impersonatorEmail = adm.email;
        if (req.method !== 'GET' && /^\/api\/v1\/(auth\/(change-password|mfa)|users|roles|pharmacies)/.test(url.pathname)) throw new HttpError(403, 'IMPERSONATION_RESTRICTED', 'Action interdite pendant une prise de contrôle');
      }
      if (ctx.user.mfaPending && !route.opts.allowMfaPending) throw new HttpError(403, 'MFA_SETUP_REQUIRED', 'Activez la double authentification pour continuer');
      // établissement courant : imposé par le compte ; seul le super-admin peut en changer
      ctx.ph = u.pharmacy_id;
      const want = parseInt(req.headers['x-pharmacy-id']);
      if (u.role_code === 'super_admin') {
        ctx.ph = want && get('SELECT 1 FROM pharmacies WHERE id=?', want) ? want : (u.pharmacy_id ?? get('SELECT id FROM pharmacies ORDER BY id LIMIT 1')?.id ?? null);
      }
      if (u.role_code !== 'super_admin' && u.pharmacy_id && get('SELECT status FROM pharmacies WHERE id=?', u.pharmacy_id)?.status !== 'active') throw new HttpError(403, 'PHARMACY_DISABLED', 'Établissement désactivé : contactez le super-administrateur');
      if (route.opts.perm) need(ctx, route.opts.perm);
      if (route.opts.anyPerm && !route.opts.anyPerm.some((p) => can(ctx.user, p))) throw forbidden('Permission requise', 'PERMISSION_DENIED');
      if (route.opts.needsPharmacy !== false && !ctx.ph) throw new HttpError(400, 'NO_PHARMACY', 'Aucun établissement sélectionné');
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) ctx.body = await readBody(req, route.opts.bodyLimit);
    const out = await route.handler(ctx);
    if (res.writableEnded || res.headersSent) return;
    if (out === undefined) { res.statusCode = 204; return res.end(); }
    return send(route.opts.status || (req.method === 'POST' && !route.opts.ok200 ? 201 : 200), out);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return send(e.status, { error: { code: e.code, message: e.message, details: e.details } });
    if (e && /UNIQUE constraint failed/.test(e.message)) return send(409, { error: { code: 'DUPLICATE', message: 'Cet enregistrement existe déjà', details: e.message.split(': ')[1] } });
    if (e && /FOREIGN KEY constraint failed/.test(e.message)) return send(409, { error: { code: 'REFERENCE', message: 'Référence invalide ou élément utilisé ailleurs' } });
    if (e && /append-only|ajout seul|non supprimable|ne peut pas être supprimée/.test(e.message)) return send(409, { error: { code: 'IMMUTABLE', message: 'Opération interdite : données non modifiables' } });
    console.error('[ERR]', req.method, url.pathname, e);
    return send(500, { error: { code: 'INTERNAL', message: 'Erreur interne', ...(process.env.NODE_ENV === 'production' ? {} : { details: String(e && e.message || e).slice(0, 300) }) } });
  }
}

export function sseHandler(ctx) {
  const { req, res } = ctx;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 5000\n\n');
  const c = { res, ph: ctx.ph, userId: ctx.user.id, staff: ctx.user.role !== 'customer' }; // les évènements sans destinataire précis ne vont qu'au personnel
  clients.add(c);
  req.on('close', () => clients.delete(c));
}

// Liste paginée standard : renvoie { data, total, page, limit }
export function paged(ctx, sqlCount, sqlRows, params = []) {
  const { page, limit, offset } = paging(ctx.query);
  const total = get(sqlCount, ...params).n;
  const data = all(`${sqlRows} LIMIT ? OFFSET ?`, ...params, limit, offset);
  return { data, total, page, limit };
}
export { run, get, all };
