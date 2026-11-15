// Finance ouverte : SMS, abonnements (paiements récurrents), KYC des bénéficiaires, clés d'API externes, webhooks sortants, rapports comptables détaillés.
import { router, audit, notify, can, setSmsHook } from '../http.js';
import { get, all, run, insert, tx, nextNumber } from '../db.js';
import { HttpError, bad, conflict, notFound, forbidden, str, int, oneOf, todaySql, addDays } from '../util.js';
import { sendSms, smsConfig, saveSmsConfig, smsEnabled } from '../sms.js';
import { newApiKey, apiKeyAuth, validWebhookUrl } from '../finance.js';
import { savePrivate, readPrivate, mimeOfName } from '../files.js';
import { journal, balances, START } from '../accounting.js';
import { sendCsv } from './reports.js';
import { randomBytes } from 'node:crypto';

const isSuper = (ctx) => ctx.user?.role === 'super_admin';
const needSuper = (ctx) => { if (!isSuper(ctx)) throw forbidden('Réservé au super-administrateur'); };
const D = /^\d{4}-\d{2}-\d{2}$/;
const money = (n, d) => (n / 10 ** d).toFixed(d);

// ================= SMS =================
setSmsHook(({ pharmacyId, userId, kind, title }) => {
  if (!smsEnabled()) return; const c = smsConfig(); if (!c.kinds.includes(kind)) return;
  const u = get('SELECT phone,role_code FROM users WHERE id=?', userId); if (!u?.phone) return;
  if (u.role_code === 'customer' && process.env.SMS_WEBHOOK_URL) return; // déjà envoyé par l'ancienne passerelle (variables d'environnement)
  let n = {}; try { n = JSON.parse(get('SELECT data FROM user_preferences WHERE user_id=?', userId)?.data || '{}').notify || {}; } catch { /* valeurs par défaut */ }
  if (n.sms === false) return; sendSms(u.phone, title, { pharmacyId, userId }).catch(() => {});
});
router.get('/sms/config', { needsPharmacy: false }, (ctx) => { needSuper(ctx); const c = smsConfig(); return { ...c, api_key: c.api_key ? '••••••••' : '', configured: !!c.url }; });
router.put('/sms/config', { needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const cur = smsConfig(), b = ctx.body; const url = str(b.url, 'URL', { max: 300 }) || '';
  if (url && !/^https?:\/\//.test(url)) throw bad('VALIDATION', 'URL invalide');
  saveSmsConfig({ url, api_key: b.api_key && b.api_key !== '••••••••' ? str(b.api_key, 'clé', { max: 300 }) : cur.api_key, auth_header: str(b.auth_header, 'en-tête', { max: 120 }) || cur.auth_header, body: str(b.body, 'modèle', { max: 600 }) || cur.body, sender: str(b.sender, 'expéditeur', { max: 20 }) || cur.sender, enabled: b.enabled !== false, kinds: Array.isArray(b.kinds) ? b.kinds.filter((k) => ['payment', 'delivery', 'appointment', 'order', 'stock'].includes(k)) : cur.kinds });
  audit(ctx, 'sms.config', 'platform', 'sms'); return { ok: true };
});
router.post('/sms/test', { needsPharmacy: false, ok200: true }, async (ctx) => { needSuper(ctx); const r = await sendSms(str(ctx.body.phone, 'téléphone', { required: true, max: 20 }), 'Test SMS — Gestion Pharmacie', { userId: ctx.user.id }); if (!r.ok) throw bad('SMS_FAILED', r.skipped ? 'SMS non configuré' : 'Envoi échoué (voir le journal SMS)'); return { ok: true }; });
router.get('/sms/log', { needsPharmacy: false }, (ctx) => { needSuper(ctx); return all('SELECT id,pharmacy_id,phone,body,status,error,created_at FROM sms_log ORDER BY id DESC LIMIT 200'); });

// ================= abonnements =================
const PERIODS = { week: 7, month: 30, quarter: 91, year: 365 };
const nextDate = (d, period) => { const x = new Date(d + 'T00:00:00Z'); if (period === 'week') x.setUTCDate(x.getUTCDate() + 7); else { const m = { month: 1, quarter: 3, year: 12 }[period]; const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); } return x.toISOString().slice(0, 10); };
export function runSubscriptions() {
  const today = todaySql(); let made = 0;
  for (const s of all("SELECT * FROM subscriptions WHERE status='active' AND next_run<=?", today)) tx(() => {
    if (s.ends_on && s.next_run > s.ends_on) { run("UPDATE subscriptions SET status='ended' WHERE id=?", s.id); return; }
    const number = nextNumber(s.pharmacy_id, 'sub_invoice', 'ABO'); insert('INSERT INTO subscription_invoices(subscription_id,pharmacy_id,customer_id,number,amount,currency,due_on) VALUES (?,?,?,?,?,?,?)', s.id, s.pharmacy_id, s.customer_id, number, s.amount, s.currency, s.next_run);
    run('UPDATE subscriptions SET next_run=?, runs=runs+1 WHERE id=?', nextDate(s.next_run, s.period), s.id); made++;
    const ph = get('SELECT currency_decimals d FROM pharmacies WHERE id=?', s.pharmacy_id), cu = get('SELECT user_id FROM customers WHERE id=?', s.customer_id)?.user_id;
    if (cu) notify({ pharmacyId: s.pharmacy_id, userId: cu, kind: 'payment', link: `#/portal?tab=subscriptions&id=${s.id}`, title: `Échéance ${number} : ${money(s.amount, ph.d)} ${s.currency}`, body: s.label });
  });
  for (const i of all("SELECT * FROM subscription_invoices WHERE status='due' AND due_on<=? AND reminded_at IS NULL", addDays(today, -3).slice(0, 10))) { // rappel après 3 jours d'impayé
    const cu = get('SELECT user_id FROM customers WHERE id=?', i.customer_id)?.user_id; run("UPDATE subscription_invoices SET reminded_at=datetime('now') WHERE id=?", i.id);
    if (cu) notify({ pharmacyId: i.pharmacy_id, userId: cu, kind: 'payment', link: `#/portal?tab=subscriptions&id=${i.id}`, title: `Rappel : échéance ${i.number} impayée`, body: `Échue le ${i.due_on}` });
  }
  return made;
}
router.get('/subscriptions', { perm: 'finance.admin' }, (ctx) => all('SELECT s.*, c.name customer, (SELECT COUNT(*) FROM subscription_invoices i WHERE i.subscription_id=s.id AND i.status=\'due\') unpaid FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.pharmacy_id=? ORDER BY s.id DESC', ctx.ph));
router.post('/subscriptions', { perm: 'finance.admin' }, (ctx) => {
  const c = get('SELECT id FROM customers WHERE id=? AND pharmacy_id=?', int(ctx.body.customer_id, 'client', { required: true }), ctx.ph); if (!c) throw notFound('Client'); const ph = get('SELECT currency FROM pharmacies WHERE id=?', ctx.ph);
  const start = String(ctx.body.start || todaySql()); if (!D.test(start)) throw bad('VALIDATION', 'Date de début invalide'); const ends = ctx.body.ends_on ? String(ctx.body.ends_on) : null; if (ends && (!D.test(ends) || ends < start)) throw bad('VALIDATION', 'Date de fin invalide');
  const id = insert('INSERT INTO subscriptions(pharmacy_id,customer_id,label,amount,currency,period,next_run,ends_on,method_code,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)', ctx.ph, c.id, str(ctx.body.label, 'libellé', { required: true, max: 120 }), int(ctx.body.amount, 'montant', { required: true, min: 1 }), ph.currency, oneOf(ctx.body.period || 'month', 'périodicité', Object.keys(PERIODS)), start, ends, str(ctx.body.method_code, 'moyen', { max: 40 }) || null, ctx.user.id);
  audit(ctx, 'subscription.create', 'subscription', id); runSubscriptions(); return { id };
});
router.put('/subscriptions/:id', { perm: 'finance.admin', ok200: true }, (ctx) => { const s = get('SELECT * FROM subscriptions WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!s) throw notFound('Abonnement'); const st = oneOf(ctx.body.status, 'statut', ['active', 'paused', 'cancelled'], { required: true }); run('UPDATE subscriptions SET status=? WHERE id=?', st, s.id); audit(ctx, 'subscription.' + st, 'subscription', s.id); return { ok: true }; });
router.get('/subscription-invoices', { perm: 'finance.admin' }, (ctx) => all('SELECT i.*, c.name customer FROM subscription_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.pharmacy_id=? ORDER BY i.id DESC LIMIT 300', ctx.ph));
router.post('/subscription-invoices/:id/pay', { perm: 'finance.admin', ok200: true }, (ctx) => { const i = get('SELECT * FROM subscription_invoices WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!i) throw notFound('Échéance'); if (i.status !== 'due') throw conflict('BAD_STATE', 'Échéance déjà réglée ou annulée'); run("UPDATE subscription_invoices SET status='paid', paid_at=datetime('now'), method_code=?, reference=? WHERE id=?", str(ctx.body.method_code, 'moyen', { max: 40 }) || 'manual', str(ctx.body.reference, 'référence', { max: 80 }) || null, i.id); audit(ctx, 'subscription.invoice_paid', 'subscription', i.subscription_id, undefined, { number: i.number }); return { ok: true }; });
router.get('/portal/subscriptions', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => { const cs = all('SELECT id FROM customers WHERE user_id=?', ctx.user.id).map((c) => c.id); if (!cs.length) return { subscriptions: [], invoices: [] }; const q = cs.join(','); return { subscriptions: all(`SELECT id,label,amount,currency,period,next_run,status FROM subscriptions WHERE customer_id IN (${q}) ORDER BY id DESC`), invoices: all(`SELECT id,number,amount,currency,due_on,status,paid_at FROM subscription_invoices WHERE customer_id IN (${q}) ORDER BY id DESC LIMIT 100`) }; });

// ================= KYC des bénéficiaires (établissements recevant des versements) =================
const kycRequired = () => get("SELECT svalue FROM platform_settings WHERE skey='kyc_required'")?.svalue === '1';
export function kycOk(pharmacyId) { return !kycRequired() || get("SELECT 1 FROM kyc_records WHERE pharmacy_id=? AND status='approved'", pharmacyId); }
const kycPh = (ctx) => { const id = Number(ctx.params.pharmacyId); if (!isSuper(ctx) && id !== ctx.ph) throw forbidden('Accès refusé'); return id; };
router.get('/kyc/policy', { needsPharmacy: false }, (ctx) => ({ required: kycRequired() }));
router.put('/kyc/policy', { needsPharmacy: false, ok200: true }, (ctx) => { needSuper(ctx); run("INSERT INTO platform_settings(skey,svalue,updated_at) VALUES ('kyc_required',?,datetime('now')) ON CONFLICT(skey) DO UPDATE SET svalue=excluded.svalue, updated_at=datetime('now')", ctx.body.required ? '1' : '0'); audit(ctx, 'kyc.policy', 'platform', 'kyc', undefined, { required: !!ctx.body.required }); return { ok: true }; });
router.get('/kyc', { needsPharmacy: false }, (ctx) => { if (!isSuper(ctx) && !ctx.ph) throw forbidden('Accès refusé'); return all(`SELECT k.id,k.pharmacy_id,ph.name pharmacy,k.holder_name,k.doc_type,k.doc_number,k.status,k.note,k.created_at,k.reviewed_at FROM kyc_records k JOIN pharmacies ph ON ph.id=k.pharmacy_id ${isSuper(ctx) ? '' : 'WHERE k.pharmacy_id=' + Number(ctx.ph)} ORDER BY k.id DESC`); });
router.put('/kyc/:pharmacyId', { needsPharmacy: false, ok200: true }, (ctx) => {
  const ph = kycPh(ctx); if (!isSuper(ctx) && !can(ctx.user, 'finance.admin')) throw forbidden('Permission requise : finance.admin'); if (!get('SELECT 1 FROM pharmacies WHERE id=?', ph)) throw notFound('Établissement');
  const cur = get('SELECT * FROM kyc_records WHERE pharmacy_id=?', ph); const f = ctx.body.file ? savePrivate(ctx.body.file, 5 * 1024 * 1024).path : cur?.doc_file; if (!f) throw bad('VALIDATION', 'Joignez la pièce d\'identité du bénéficiaire');
  const proof = ctx.body.proof ? savePrivate(ctx.body.proof, 5 * 1024 * 1024).path : cur?.proof_file || null; const v = [str(ctx.body.holder_name, 'titulaire', { required: true, max: 120 }), oneOf(ctx.body.doc_type || 'cni', 'type de pièce', ['cni', 'passport', 'permis', 'registre', 'autre']), str(ctx.body.doc_number, 'numéro', { max: 40 }) || null, f, proof];
  if (cur) run("UPDATE kyc_records SET holder_name=?,doc_type=?,doc_number=?,doc_file=?,proof_file=?,status='pending',note=NULL,submitted_by=?,reviewed_by=NULL,reviewed_at=NULL WHERE id=?", ...v, ctx.user.id, cur.id); else insert('INSERT INTO kyc_records(holder_name,doc_type,doc_number,doc_file,proof_file,pharmacy_id,submitted_by) VALUES (?,?,?,?,?,?,?)', ...v, ph, ctx.user.id);
  audit(ctx, 'kyc.submit', 'pharmacy', ph); for (const u of all("SELECT id FROM users WHERE role_code='super_admin' AND status='active'")) notify({ pharmacyId: ph, userId: u.id, kind: 'payment', title: 'Dossier KYC à vérifier', body: get('SELECT name FROM pharmacies WHERE id=?', ph).name, link: '#/payments-admin' }); return { ok: true };
});
router.get('/kyc/:pharmacyId/doc', { needsPharmacy: false }, (ctx) => { needSuper(ctx); const k = get('SELECT * FROM kyc_records WHERE pharmacy_id=?', ctx.params.pharmacyId); if (!k) throw notFound('Dossier'); const which = ctx.query.file === 'proof' ? k.proof_file : k.doc_file; const buf = which && readPrivate(which); if (!buf) throw notFound('Pièce'); audit(ctx, 'kyc.view', 'pharmacy', k.pharmacy_id); ctx.res.writeHead(200, { 'Content-Type': mimeOfName(which), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); ctx.res.end(buf); });
router.post('/kyc/:pharmacyId/review', { needsPharmacy: false, ok200: true }, (ctx) => { needSuper(ctx); const k = get('SELECT * FROM kyc_records WHERE pharmacy_id=?', ctx.params.pharmacyId); if (!k) throw notFound('Dossier'); const st = oneOf(ctx.body.status, 'décision', ['approved', 'rejected'], { required: true }); const note = str(ctx.body.note, 'note', { max: 300 }); if (st === 'rejected' && !note) throw bad('VALIDATION', 'Indiquez le motif du refus'); run("UPDATE kyc_records SET status=?, note=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?", st, note || null, ctx.user.id, k.id); audit(ctx, 'kyc.' + st, 'pharmacy', k.pharmacy_id); notify({ pharmacyId: k.pharmacy_id, audience: 'manager', kind: 'payment', title: st === 'approved' ? 'Vérification d\'identité (KYC) approuvée' : 'Vérification d\'identité (KYC) refusée', body: note || undefined }); return { ok: true }; });

// ================= clés d'API externes + webhooks =================
const SCOPES = ['payments:read', 'refunds:read'];
const keyScope = (ctx) => (isSuper(ctx) ? (ctx.body.pharmacy_id ? Number(ctx.body.pharmacy_id) : null) : ctx.ph);
router.get('/api-keys', { perm: 'finance.admin', needsPharmacy: false }, (ctx) => all(`SELECT id,pharmacy_id,name,prefix,scopes,last_used_at,revoked_at,created_at FROM api_keys ${isSuper(ctx) ? '' : 'WHERE pharmacy_id=' + Number(ctx.ph)} ORDER BY id DESC`));
router.post('/api-keys', { perm: 'finance.admin', needsPharmacy: false }, (ctx) => { if (!isSuper(ctx) && !ctx.ph) throw forbidden('Établissement requis'); const k = newApiKey(); const scopes = (Array.isArray(ctx.body.scopes) && ctx.body.scopes.length ? ctx.body.scopes : ['payments:read']).filter((s) => SCOPES.includes(s)); const id = insert('INSERT INTO api_keys(pharmacy_id,name,prefix,key_hash,scopes,created_by) VALUES (?,?,?,?,?,?)', keyScope(ctx), str(ctx.body.name, 'nom', { required: true, max: 80 }), k.prefix, k.hash, scopes.join(','), ctx.user.id); audit(ctx, 'apikey.create', 'api_key', id); return { id, key: k.key, note: 'Copiez cette clé maintenant : elle ne sera plus affichée.' }; });
router.delete('/api-keys/:id', { perm: 'finance.admin', needsPharmacy: false, ok200: true }, (ctx) => { const k = get('SELECT * FROM api_keys WHERE id=?', ctx.params.id); if (!k || (!isSuper(ctx) && k.pharmacy_id !== ctx.ph)) throw notFound('Clé'); run("UPDATE api_keys SET revoked_at=datetime('now') WHERE id=?", k.id); audit(ctx, 'apikey.revoke', 'api_key', k.id); return { ok: true }; });
function extAuth(ctx, scope) { const k = apiKeyAuth(ctx, scope); if (k === null) throw new HttpError(401, 'UNAUTHORIZED', 'Clé d\'API manquante ou invalide'); if (k === false) throw forbidden('Portée insuffisante pour cette clé'); return k; }
const extWhere = (k) => (k.pharmacy_id ? ' AND o.pharmacy_id=' + Number(k.pharmacy_id) : '');
router.get('/ext/payments', { public: true, needsPharmacy: false }, (ctx) => { const k = extAuth(ctx, 'payments:read'); const lim = Math.min(200, Number(ctx.query.limit) || 50), st = ctx.query.status; return { data: all(`SELECT o.id,o.pharmacy_id,o.order_id,o.method_code,o.amount,o.currency,o.commission,o.refunded,o.status,o.provider_ref,o.created_at,o.paid_at FROM online_payments o WHERE 1=1 ${extWhere(k)} ${st ? 'AND o.status=?' : ''} ORDER BY o.id DESC LIMIT ${lim}`, ...(st ? [String(st)] : [])) }; });
router.get('/ext/payments/:id', { public: true, needsPharmacy: false }, (ctx) => { const k = extAuth(ctx, 'payments:read'); const o = get(`SELECT o.id,o.pharmacy_id,o.order_id,o.method_code,o.amount,o.currency,o.commission,o.refunded,o.status,o.provider_ref,o.created_at,o.paid_at FROM online_payments o WHERE o.id=? ${extWhere(k)}`, ctx.params.id); if (!o) throw notFound('Paiement'); return { ...o, refunds: all('SELECT amount,reason,gateway_status,created_at FROM payment_refunds WHERE online_payment_id=? ORDER BY id', o.id), receipt: get('SELECT number,code FROM receipts WHERE online_payment_id=?', o.id) || null }; });
router.get('/ext/refunds', { public: true, needsPharmacy: false }, (ctx) => { const k = extAuth(ctx, 'refunds:read'); return { data: all(`SELECT r.id,r.online_payment_id,r.amount,r.reason,r.gateway_status,r.gateway_ref,r.created_at FROM payment_refunds r JOIN online_payments o ON o.id=r.online_payment_id WHERE 1=1 ${extWhere(k)} ORDER BY r.id DESC LIMIT 200`) }; });
router.get('/webhooks', { perm: 'finance.admin', needsPharmacy: false }, (ctx) => all(`SELECT id,pharmacy_id,url,events,active,last_status,last_at,created_at FROM webhook_endpoints ${isSuper(ctx) ? '' : 'WHERE pharmacy_id=' + Number(ctx.ph)} ORDER BY id DESC`));
router.post('/webhooks', { perm: 'finance.admin', needsPharmacy: false }, (ctx) => { const url = str(ctx.body.url, 'URL', { required: true, max: 300 }); if (!validWebhookUrl(url)) throw bad('VALIDATION', 'URL invalide (HTTPS public requis en production)'); const secret = 'whsec_' + randomBytes(20).toString('hex'); const events = (Array.isArray(ctx.body.events) && ctx.body.events.length ? ctx.body.events : ['payment.paid', 'payment.refunded']).filter((e) => ['payment.paid', 'payment.refunded'].includes(e)); const id = insert('INSERT INTO webhook_endpoints(pharmacy_id,url,secret,events,created_by) VALUES (?,?,?,?,?)', keyScope(ctx), url, secret, events.join(','), ctx.user.id); audit(ctx, 'webhook.create', 'webhook', id); return { id, secret, note: 'Conservez ce secret : il sert à vérifier l\'en-tête X-Signature (HMAC-SHA256 du corps).' }; });
router.delete('/webhooks/:id', { perm: 'finance.admin', needsPharmacy: false, ok200: true }, (ctx) => { const w = get('SELECT * FROM webhook_endpoints WHERE id=?', ctx.params.id); if (!w || (!isSuper(ctx) && w.pharmacy_id !== ctx.ph)) throw notFound('Webhook'); run('DELETE FROM webhook_endpoints WHERE id=?', w.id); audit(ctx, 'webhook.delete', 'webhook', w.id); return { ok: true }; });

// ================= rapports comptables détaillés =================
const range = (q) => { const to = q.to || todaySql(), from = q.from || to.slice(0, 4) + '-01-01'; if (!D.test(from) || !D.test(to) || from > to) throw bad('VALIDATION', 'Période invalide'); return { from, to }; };
const out = (ctx, name, rows, cols, extra = {}) => (['csv', 'xlsx', 'pdf'].includes(ctx.query.format) ? sendCsv(ctx, name, rows, cols) : { ...extra, data: rows });
router.get('/accounting/cash-flow', { perm: 'accounting.view' }, (ctx) => { // flux de trésorerie : mouvements des comptes de classe 5, regroupés par origine
  const { from, to } = range(ctx.query); const by = new Map(); let open = 0;
  for (const e of journal(ctx.ph, START, addDays(from, -1).slice(0, 10))) for (const l of e.lines) if (String(l.a).startsWith('5')) open += (l.d || 0) - (l.c || 0);
  for (const e of journal(ctx.ph, from, to)) for (const l of e.lines) if (String(l.a).startsWith('5')) { const k = e.source || 'manuel'; const x = by.get(k) || { source: k, inflow: 0, outflow: 0 }; x.inflow += l.d || 0; x.outflow += l.c || 0; by.set(k, x); }
  const rows = [...by.values()].map((x) => ({ ...x, net: x.inflow - x.outflow })); const net = rows.reduce((a, x) => a + x.net, 0);
  return out(ctx, 'flux_tresorerie', rows, ['source', 'inflow', 'outflow', 'net'], { opening: open, net, closing: open + net });
});
router.get('/accounting/comparative', { perm: 'accounting.view' }, (ctx) => { // compte de résultat comparé à la période équivalente de l'année précédente
  const { from, to } = range(ctx.query); const py = (d) => String(Number(d.slice(0, 4)) - 1) + d.slice(4); const a = balances(ctx.ph, from, to), b = balances(ctx.ph, py(from), py(to)); const codes = [...new Set([...a, ...b].filter((x) => ['income', 'expense'].includes(x.type)).map((x) => x.code))].sort();
  const rows = codes.map((c) => { const x = a.find((y) => y.code === c), y = b.find((z) => z.code === c); const cur = x?.balance || 0, prev = y?.balance || 0; return { code: c, label: (x || y).label, type: (x || y).type, current: cur, previous: prev, delta: cur - prev, pct: prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null }; });
  const res = (list, k) => list.filter((r) => r.type === 'income').reduce((s, r) => s + r[k], 0) - list.filter((r) => r.type === 'expense').reduce((s, r) => s + r[k], 0);
  return out(ctx, 'comparatif', rows, ['code', 'label', 'current', 'previous', 'delta', 'pct'], { result_current: res(rows, 'current'), result_previous: res(rows, 'previous'), period: { from, to } });
});
router.get('/accounting/payments-summary', { perm: 'accounting.view' }, (ctx) => { // encaissements en ligne par mois et moyen : brut, commissions, remboursements, net
  const { from, to } = range(ctx.query); const m = new Map();
  for (const o of all("SELECT substr(paid_at,1,7) month, method_code, COUNT(*) n, SUM(amount) gross, SUM(commission) commission, SUM(refunded) refunded FROM online_payments WHERE pharmacy_id=? AND status='paid' AND substr(paid_at,1,10) BETWEEN ? AND ? GROUP BY substr(paid_at,1,7), method_code ORDER BY 1, 2", ctx.ph, from, to)) m.set(o.month + o.method_code, { ...o, net: o.gross - o.commission - o.refunded });
  const rows = [...m.values()]; const tot = rows.reduce((a, r) => ({ gross: a.gross + r.gross, commission: a.commission + r.commission, refunded: a.refunded + r.refunded, net: a.net + r.net }), { gross: 0, commission: 0, refunded: 0, net: 0 });
  return out(ctx, 'encaissements', rows, ['month', 'method_code', 'n', 'gross', 'commission', 'refunded', 'net'], { totals: tot });
});
router.get('/accounting/receivables', { perm: 'accounting.view' }, (ctx) => { // échéances d'abonnement impayées, par ancienneté
  const today = todaySql(); const rows = all("SELECT i.number, c.name customer, i.amount, i.currency, i.due_on FROM subscription_invoices i JOIN customers c ON c.id=i.customer_id WHERE i.pharmacy_id=? AND i.status='due' ORDER BY i.due_on", ctx.ph).map((r) => { const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(r.due_on)) / 864e5)); return { ...r, days_late: days, bucket: days <= 30 ? '0-30 j' : days <= 60 ? '31-60 j' : days <= 90 ? '61-90 j' : '> 90 j' }; });
  return out(ctx, 'echeances_impayees', rows, ['number', 'customer', 'amount', 'currency', 'due_on', 'days_late', 'bucket'], { total: rows.reduce((a, r) => a + r.amount, 0) });
});
