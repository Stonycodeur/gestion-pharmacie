// Paiements v2 : catalogue mondial, réglages avancés (pays, devises, commissions, champs), options client, reçus (PDF, QR, e-mail),
// remboursements, tableau de bord & exports, taux de change, versements aux établissements, journal antivirus, webhook générique.
import { exportMeta } from '../exportmeta.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { router, audit, can, config, notify } from '../http.js';
import { get, all, run, insert, tx, getSetting } from '../db.js';
import { bad, conflict, notFound, forbidden, str, int, oneOf, toCsv, HttpError } from '../util.js';
import { modesFor, ensurePharmacyMethods } from '../paymodes.js';
import { cfgOf, markPaid, markFailed, verifyGeneric, orderTotal, orderPaid, deliveryOf, getPath, FORBIDDEN_FIELD } from '../payments.js';
import { MODES } from '../delivery_config.js';
import { CATALOG } from '../payment-catalog.js';
import { receiptView, receiptPdf, emailReceipt, receiptPublicPdfUrl, verifyUrl, sealValid } from '../receipts.js';
import { qrSvg } from '../qr.js';
import { xlsx, pdfTable, toColumns } from '../export.js';
import { refundAtGateway, emitEvent } from '../finance.js';
import { kycOk } from './finance2.js';

const isSuper = (ctx) => ctx.user.role === 'super_admin';
const needSuper = (ctx) => { if (!isSuper(ctx)) throw forbidden('Réservé au super-administrateur'); };
const pdfRes = (res, buf, name) => { res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"`, 'Cache-Control': 'no-store' }); res.end(buf); };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const csvList = (v, re) => { if (v === undefined || v === null || v === '') return null; const a = String(v).toUpperCase().split(/[\s,;]+/).filter(Boolean); if (a.some((x) => !re.test(x))) throw bad('VALIDATION', 'Liste invalide'); return [...new Set(a)].join(','); };

// ---------- catalogue ----------
router.get('/payment-catalog', { needsPharmacy: false }, (ctx) => {
  needSuper(ctx); const have = new Set(all('SELECT code FROM payment_methods').map((m) => m.code));
  return CATALOG.map((c) => ({ ...c, added: have.has(c.code) }));
});
router.post('/payment-catalog/add', { needsPharmacy: false }, (ctx) => {
  needSuper(ctx); const codes = Array.isArray(ctx.body.codes) ? ctx.body.codes : []; let n = 0;
  tx(() => { for (const code of codes) { const c = CATALOG.find((x) => x.code === code); if (!c || get('SELECT 1 FROM payment_methods WHERE code=?', c.code)) continue;
    insert('INSERT INTO payment_methods(code,label,kind,provider,enabled,channel_pos,channel_online,instructions,sort_order,family,countries,currencies,fields) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', c.code, c.label, c.kind, 'manual', 0, 0, 1,
      c.hosted ? 'Paiement sécurisé sur la page du prestataire.' : 'Après votre paiement, la pharmacie confirmera sa réception.', 200 + n, c.family, c.countries || null, c.currencies || null, c.fields?.length ? JSON.stringify(c.fields) : null); n++; } });
  audit(ctx, 'payment_method.catalog_add', 'payment_method', 0, undefined, { added: n }); return { added: n };
});

// ---------- réglages avancés d'un moyen ----------
function cleanFields(v) {
  if (v === null || v === '') return null; const a = typeof v === 'string' ? JSON.parse(v) : v; if (!Array.isArray(a) || a.length > 6) throw bad('VALIDATION', 'Champs : 6 maximum');
  return JSON.stringify(a.map((f) => { const name = String(f.name || '').trim().toLowerCase(); if (!/^[a-z][a-z0-9_]{0,23}$/.test(name)) throw bad('VALIDATION', 'Nom de champ invalide'); if (FORBIDDEN_FIELD.test(name) || FORBIDDEN_FIELD.test(String(f.label || ''))) throw bad('FORBIDDEN_FIELD', 'Interdit : l\'application ne collecte ni PIN, ni mot de passe, ni numéro/CVV de carte (ils se saisissent chez le prestataire)');
    return { name, label: str(f.label, 'libellé du champ', { required: true, max: 60 }), type: ['text', 'tel', 'email'].includes(f.type) ? f.type : 'text', required: !!f.required }; }));
}
router.put('/payment-methods/:id/settings', { needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const m = get('SELECT * FROM payment_methods WHERE id=?', ctx.params.id); if (!m) throw notFound('Mode de paiement'); const b = ctx.body, o = {};
  if ('countries' in b) o.countries = csvList(b.countries, /^[A-Z]{2}$/); if ('currencies' in b) o.currencies = csvList(b.currencies, /^[A-Z]{3}$/);
  if ('commission_pct' in b) o.commission_bp = Math.round(Number(b.commission_pct || 0) * 100); if ('commission_fixed' in b) o.commission_fixed = int(b.commission_fixed, 'commission fixe', { min: 0, max: 1e9 });
  if (o.commission_bp !== undefined && !(o.commission_bp >= 0 && o.commission_bp <= 5000)) throw bad('VALIDATION', 'Commission : 0 à 50 %');
  if ('family' in b) o.family = str(b.family, 'groupe', { max: 30 }) || null; if ('merchant_account' in b) o.merchant_account = str(b.merchant_account, 'compte marchand', { max: 200 }) || null;
  if ('payout' in b) { if (!['instant', 'deferred'].includes(b.payout)) throw bad('VALIDATION', 'Versement : instant ou différé'); o.payout = b.payout; }
  if ('otp_required' in b) o.otp_required = b.otp_required ? 1 : 0; if ('otp_ttl' in b) o.otp_ttl = int(b.otp_ttl, 'durée du code', { min: 30, max: 900 });
  if ('instructions' in b) o.instructions = str(b.instructions, 'message au client', { max: 400 }) || null;
  if ('fields' in b) o.fields = cleanFields(Array.isArray(b.fields) ? b.fields.map((f, i) => ({ ...f, name: f.name || ('champ' + (i + 1)) })) : b.fields);
  if (!Object.keys(o).length) throw bad('VALIDATION', 'Aucune modification');
  run(`UPDATE payment_methods SET ${Object.keys(o).map((k) => k + '=?').join(',')} WHERE id=?`, ...Object.values(o), m.id); audit(ctx, 'payment_method.settings', 'payment_method', m.id, undefined, o); return { ok: true };
});

// ---------- côté client : devis + moyens disponibles ----------
const quote = (o) => {
  const lines = all('SELECT p.name label, p.sale_price unit, l.qty, l.qty*p.sale_price total, p.tax_rate FROM order_lines l JOIN products p ON p.id=l.product_id WHERE l.order_id=?', o.id);
  const total = lines.reduce((a, l) => a + l.total, 0), tax = lines.reduce((a, l) => a + (l.total - Math.round(l.total / (1 + l.tax_rate / 100))), 0);
  // Total à payer = commande + livraison (si une course est enclenchée) ; recalculé à chaque appel
  const dl = deliveryOf(o.id), fee = dl?.fee || 0, paid = orderPaid(o.id);
  return { lines, goods_total: total, delivery_fee: fee, delivery: dl ? { id: dl.id, status: dl.status, mode: dl.mode, mode_label: MODES[dl.mode]?.label || dl.mode } : null, total: total + fee, tax, paid, due: Math.max(0, total + fee - paid) };
};
router.get('/portal/orders/:id/payment-options', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => {
  const o = get('SELECT * FROM customer_orders WHERE id=? AND customer_id IN (SELECT id FROM customers WHERE user_id=?)', ctx.params.id, ctx.user.id); if (!o) throw notFound('Commande');
  const ph = get('SELECT p.name,p.currency,p.currency_decimals,c.iso2 FROM pharmacies p LEFT JOIN countries c ON c.id=p.country_id WHERE p.id=?', o.pharmacy_id);
  const modes = modesFor(o.pharmacy_id);
  return { pharmacy: ph.name, currency: ph.currency, decimals: ph.currency_decimals, ...quote(o), order_number: o.number, methods: modes.online, modes, ...(deliveryOf(o.id) ? { wants_delivery: 1 } : { wants_delivery: o.wants_delivery }), pay_mode: o.pay_mode, pay_method_code: o.pay_method_code, has_delivery: !!deliveryOf(o.id) };
});
// Règlement « plus tard » : à la caisse (retrait) ou à la livraison (espèces / carte au livreur). Aucune donnée sensible ; la pharmacie est prévenue.
router.post('/portal/orders/:id/pay-later', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false, ok200: true }, (ctx) => {
  const o = get('SELECT * FROM customer_orders WHERE id=? AND customer_id IN (SELECT id FROM customers WHERE user_id=?)', ctx.params.id, ctx.user.id); if (!o) throw notFound('Commande');
  if (['cancelled', 'expired', 'picked_up'].includes(o.status)) throw conflict('BAD_STATE', 'Cette commande n\'est plus modifiable');
  const mode = oneOf(String(ctx.body.mode || ''), 'mode', ['counter', 'delivery']); if (mode === 'counter' && deliveryOf(o.id)) throw conflict('DELIVERY_REQUESTED', 'Une livraison est déjà demandée : le règlement se fait en ligne ou au livreur'); const modes = modesFor(o.pharmacy_id), m = modes[mode].find((x) => x.code === String(ctx.body.method_code || ''));
  if (!m) throw bad('VALIDATION', 'Mode de paiement indisponible dans cette pharmacie');
  run('UPDATE customer_orders SET wants_delivery=?, pay_mode=?, pay_method_code=? WHERE id=?', mode === 'delivery' ? 1 : 0, mode, m.code, o.id);
  notify({ pharmacyId: o.pharmacy_id, audience: 'staff', kind: 'order', link: '#/orders?id=' + o.id, title: `Commande ${o.number} : ${mode === 'counter' ? 'paiement à la caisse' : 'paiement à la livraison'}`, body: `Mode choisi : ${m.label}` });
  audit(ctx, 'order.pay_later', 'order', o.id, undefined, { mode, method: m.code });
  const qt = quote(o); return { ok: true, amounts: { goods: qt.goods_total, delivery: qt.delivery_fee, total: qt.total, due: qt.due }, instructions: mode === 'counter' ? `Réglez ${m.label.toLowerCase()} à la caisse de la pharmacie lors du retrait de votre commande.` : `Vous réglerez (${m.label.toLowerCase()}) au livreur à la réception de votre commande.` };
});
router.post('/portal/orders/:id/wants-delivery', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false, ok200: true }, (ctx) => {
  const o = get('SELECT id FROM customer_orders WHERE id=? AND customer_id IN (SELECT id FROM customers WHERE user_id=?)', ctx.params.id, ctx.user.id); if (!o) throw notFound('Commande');
  run('UPDATE customer_orders SET wants_delivery=? WHERE id=?', ctx.body.value ? 1 : 0, o.id); return { ok: true };
});

// ---------- modes de paiement de LA pharmacie (caisse / livraison / en ligne) ----------
const phScope = (ctx) => { const id = isSuper(ctx) ? Number(ctx.query.pharmacy_id || ctx.body?.pharmacy_id || ctx.ph) : ctx.ph; if (!id || !get('SELECT 1 FROM pharmacies WHERE id=?', id)) throw bad('VALIDATION', 'Pharmacie requise'); return id; };
router.get('/pharmacy-payment-methods', { perm: 'settings.manage', needsPharmacy: false }, (ctx) => {
  const ph = phScope(ctx); ensurePharmacyMethods(ph);
  return all('SELECT m.code,m.label,m.kind,m.provider,m.enabled global_enabled,m.channel_online global_online,x.enabled,x.at_counter,x.on_delivery,x.online FROM payment_methods m JOIN pharmacy_payment_methods x ON x.method_code=m.code AND x.pharmacy_id=? ORDER BY m.sort_order,m.id', ph);
});
router.put('/pharmacy-payment-methods/:code', { perm: 'settings.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const ph = phScope(ctx); ensurePharmacyMethods(ph); const x = get('SELECT * FROM pharmacy_payment_methods WHERE pharmacy_id=? AND method_code=?', ph, ctx.params.code); if (!x) throw notFound('Mode de paiement');
  const o = {}; for (const k of ['enabled', 'at_counter', 'on_delivery', 'online']) if (k in ctx.body) o[k] = ctx.body[k] ? 1 : 0; if (!Object.keys(o).length) throw bad('VALIDATION', 'Aucune modification');
  run(`UPDATE pharmacy_payment_methods SET ${Object.keys(o).map((k) => k + '=?').join(',')} WHERE id=?`, ...Object.values(o), x.id); audit(ctx, 'pharmacy_method.update', 'pharmacy', ph, x, o); return { ok: true };
});

// ---------- reçus ----------
const canSeeReceipt = (ctx, r) => isSuper(ctx) || (ctx.ph === r.pharmacy_id && (can(ctx.user, 'sales.deposit') || can(ctx.user, 'orders.view') || can(ctx.user, 'reports.view')))
  || !!get('SELECT 1 FROM customers WHERE id=? AND user_id=?', r.customer_id, ctx.user.id);
const myReceipt = (ctx) => { const r = get('SELECT * FROM receipts WHERE id=?', ctx.params.id); if (!r || !canSeeReceipt(ctx, r)) throw notFound('Reçu'); return r; };
const RC = 'r.id,r.number,r.code,r.amount,r.currency,r.decimals,r.method_label,r.reference,r.created_at,r.emailed_at,r.payer_name,r.service,r.pharmacy_id,(SELECT name FROM pharmacies WHERE id=r.pharmacy_id) pharmacy_name';
router.get('/portal/receipts', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => all(`SELECT ${RC} FROM receipts r WHERE r.customer_id IN (SELECT id FROM customers WHERE user_id=?) ORDER BY r.id DESC LIMIT 500`, ctx.user.id).map((r) => ({ ...r, pdf_public_url: receiptPublicPdfUrl(r.code), verify_url: verifyUrl(r.code) })));
router.get('/receipts', { needsPharmacy: false }, (ctx) => {
  const w = [], p = []; if (!isSuper(ctx)) { if (!ctx.ph || !(can(ctx.user, 'sales.deposit') || can(ctx.user, 'orders.view') || can(ctx.user, 'reports.view'))) throw forbidden('Permission requise'); w.push('r.pharmacy_id=?'); p.push(ctx.ph); } else if (ctx.query.pharmacy_id) { w.push('r.pharmacy_id=?'); p.push(Number(ctx.query.pharmacy_id)); }
  if (ctx.query.from) { w.push('r.created_at>=?'); p.push(String(ctx.query.from)); } if (ctx.query.to) { w.push('r.created_at<?'); p.push(String(ctx.query.to) + ' 23:59:59'); }
  if (ctx.query.q) { w.push('(r.number LIKE ? OR r.reference LIKE ? OR r.payer_name LIKE ?)'); const q = `%${String(ctx.query.q).slice(0, 40)}%`; p.push(q, q, q); }
  return all(`SELECT ${RC} FROM receipts r ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY r.id DESC LIMIT 500`, ...p);
});
router.get('/receipts/:id', { needsPharmacy: false }, (ctx) => { const r = myReceipt(ctx); const v = receiptView(r.id); return { ...v, qr_svg: qrSvg(v.verify_url, { size: 180 }), pdf_public_url: receiptPublicPdfUrl(r.code) }; });
router.get('/receipts/:id/pdf', { needsPharmacy: false }, (ctx) => { const r = myReceipt(ctx); audit(ctx, 'receipt.download', 'receipt', r.id); pdfRes(ctx.res, receiptPdf(r.id), r.number); });
router.post('/receipts/:id/email', { needsPharmacy: false, ok200: true }, async (ctx) => {
  const r = myReceipt(ctx); const to = String(ctx.body.to || '').trim() || get('SELECT email FROM users WHERE id=?', ctx.user.id).email;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw bad('VALIDATION', 'Adresse e-mail invalide');
  try { if (!(await emailReceipt(r.id, to))) throw new Error('e-mail non configuré'); } catch (e) { console.error('[reçu e-mail]', e.message); throw new HttpError(502, 'MAIL_ERROR', 'Envoi impossible pour le moment (e-mail non configuré ou refusé)'); }
  audit(ctx, 'receipt.email', 'receipt', r.id); return { ok: true };
});
// Vérification publique (QR code) : n'expose ni le nom complet ni le contenu de la commande.
const maskName = (n) => String(n || '').split(' ').map((p) => p.slice(0, 1) + '***').join(' ');
router.get('/receipts/verify/:code', { public: true }, (ctx) => {
  const r = get('SELECT * FROM receipts WHERE code=?', String(ctx.params.code).toUpperCase()); const ok = !!r && sealValid(r);
  const ph = r && get('SELECT name FROM pharmacies WHERE id=?', r.pharmacy_id), amt = r ? (r.amount / 10 ** r.decimals).toFixed(r.decimals) + ' ' + r.currency : '';
  const body = ok ? `<h2 style="color:#0a7d3c">✔ Reçu authentique</h2><p><b>${esc(r.number)}</b><br>Établissement : <b>${esc(ph.name)}</b><br>Montant : <b>${esc(amt)}</b><br>Date : ${esc(r.created_at)} UTC<br>Payeur : ${esc(maskName(r.payer_name))}<br>Référence : ${esc(r.reference)}</p>` : '<h2 style="color:#b42318">✖ Reçu introuvable ou altéré</h2><p>Ce code ne correspond à aucun reçu valide émis par la plateforme.</p>';
  ctx.res.writeHead(ok ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
  ctx.res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Vérification de reçu</title><body style="font-family:system-ui;max-width:440px;margin:40px auto;padding:0 16px">${body}</body>`);
});
router.get('/receipts/public/:code/pdf', { public: true }, (ctx) => { const r = get('SELECT id,number FROM receipts WHERE code=?', String(ctx.params.code).toUpperCase()); if (!r) throw notFound('Reçu'); pdfRes(ctx.res, receiptPdf(r.id), r.number); });

// ---------- remboursements ----------
router.post('/online-payments/:id/refund', { perm: 'sales.refund', ok200: true }, async (ctx) => {
  const op = get('SELECT * FROM online_payments WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!op) throw notFound('Paiement'); if (op.status !== 'paid') throw conflict('BAD_STATE', 'Seul un paiement encaissé peut être remboursé');
  const amount = int(ctx.body.amount ?? op.amount - op.refunded, 'montant', { required: true, min: 1 }); if (amount > op.amount - op.refunded) throw bad('VALIDATION', 'Montant supérieur au reste remboursable');
  const reason = str(ctx.body.reason, 'motif', { required: true, max: 300 }); if (amount > op.amount * 0.5 && !can(ctx.user, 'sales.refund_approve')) throw forbidden('Remboursement supérieur à 50 % : approbation d\'un responsable requise');
  const m = get('SELECT * FROM payment_methods WHERE code=?', op.method_code), phr = get('SELECT currency,currency_decimals FROM pharmacies WHERE id=?', op.pharmacy_id);
  let gw; try { gw = await refundAtGateway(op, m, phr, amount, reason); } catch (e) { throw bad('GATEWAY_REFUND_FAILED', `Le prestataire a refusé le remboursement : ${e.message}. Rien n'a été enregistré.`); }
  const fresh = get('SELECT refunded FROM online_payments WHERE id=?', op.id); if (amount > op.amount - fresh.refunded) throw conflict('BAD_STATE', 'Un autre remboursement vient d\'être enregistré');
  tx(() => { insert('INSERT INTO payment_refunds(online_payment_id,pharmacy_id,amount,reason,user_id,gateway_status,gateway_ref) VALUES (?,?,?,?,?,?,?)', op.id, op.pharmacy_id, amount, reason, ctx.user.id, gw.status === 'done' ? 'done' : 'manual', gw.ref || null); run('UPDATE online_payments SET refunded=refunded+? WHERE id=?', amount, op.id);
    if (op.refunded + amount >= op.amount && op.deposit_id) run("UPDATE order_deposits SET status='refunded' WHERE id=? AND status='held'", op.deposit_id); });
  audit(ctx, 'payment.refund', 'order', op.order_id, undefined, { amount, reason, op: op.id, gateway: gw.status });
  if (op.user_id) notify({ pharmacyId: op.pharmacy_id, userId: op.user_id, kind: 'payment', link: `#/portal?tab=orders&id=${op.order_id}`, title: 'Remboursement enregistré', body: `${(amount / 10 ** phr.currency_decimals).toFixed(phr.currency_decimals)} remboursés — ${reason}` });
  emitEvent(op.pharmacy_id, 'payment.refunded', { payment_id: op.id, amount, currency: op.currency || phr.currency, reason, gateway: gw.status, gateway_ref: gw.ref || null });
  return { ok: true, gateway: gw.status, gateway_ref: gw.ref || null, gateway_manual: gw.status !== 'done' && !['manual', 'sandbox'].includes(m?.provider) }; // 'done' : l'argent a été rendu chez le prestataire par l'application
});

// ---------- tableau de bord ----------
const rateMap = () => Object.fromEntries(all('SELECT code,per_eur FROM currency_rates').map((r) => [r.code, r.per_eur]));
const inEur = (amount, dec, cur, R) => (R[cur] ? amount / 10 ** dec / R[cur] : 0);
function statRows(ctx) {
  const w = [], p = []; if (!isSuper(ctx)) { w.push('o.pharmacy_id=?'); p.push(ctx.ph); } else if (ctx.query.pharmacy_id) { w.push('o.pharmacy_id=?'); p.push(Number(ctx.query.pharmacy_id)); }
  if (ctx.query.from) { w.push('o.created_at>=?'); p.push(String(ctx.query.from)); } if (ctx.query.to) { w.push('o.created_at<?'); p.push(String(ctx.query.to) + ' 23:59:59'); }
  return all(`SELECT o.id,o.created_at,o.pharmacy_id,ph.name pharmacy,COALESCE(c.name_fr,c.name_en,'—') country,o.method_code,COALESCE(m.label,o.method_code) method,o.status,o.amount,o.refunded,o.commission,COALESCE(o.currency,ph.currency) currency,ph.currency_decimals cdec,o.ip,o.risk_score,o.provider_ref,cu.name customer,ord.number order_number
    FROM online_payments o JOIN pharmacies ph ON ph.id=o.pharmacy_id LEFT JOIN countries c ON c.id=ph.country_id LEFT JOIN payment_methods m ON m.code=o.method_code LEFT JOIN customers cu ON cu.id=o.customer_id LEFT JOIN customer_orders ord ON ord.id=o.order_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 20000`, ...p).map((r) => ({ ...r, dec: r.cdec })); // « dec » est un mot réservé MariaDB : alias SQL cdec
}
router.get('/payments/stats', { needsPharmacy: false }, (ctx) => {
  if (!isSuper(ctx) && !(ctx.ph && (can(ctx.user, 'reports.view') || can(ctx.user, 'sales.deposit')))) throw forbidden('Permission requise');
  const R = rateMap(), rows = statRows(ctx), by = (key) => { const m = new Map(); for (const r of rows.filter((x) => x.status === 'paid')) { const k = r[key]; const x = m.get(k) || { name: k, count: 0, revenue_eur: 0, refunded_eur: 0, commission_eur: 0 }; x.count++; x.revenue_eur += inEur(r.amount, r.dec, r.currency, R); x.refunded_eur += inEur(r.refunded, r.dec, r.currency, R); x.commission_eur += inEur(r.commission, r.dec, r.currency, R); m.set(k, x); } return [...m.values()].map((x) => ({ ...x, revenue_eur: +x.revenue_eur.toFixed(2), refunded_eur: +x.refunded_eur.toFixed(2), commission_eur: +x.commission_eur.toFixed(2) })).sort((a, b) => b.revenue_eur - a.revenue_eur); };
  const paid = rows.filter((r) => r.status === 'paid'), sum = (a, f) => +a.reduce((t, r) => t + f(r), 0).toFixed(2);
  const bal = new Map(); for (const r of paid) { const b = bal.get(r.pharmacy_id) || { pharmacy_id: r.pharmacy_id, pharmacy: r.pharmacy, currency: r.currency, dec: r.dec, net: 0 }; b.net += r.amount - r.refunded - r.commission; bal.set(r.pharmacy_id, b); }
  const out = all(`SELECT pharmacy_id, SUM(amount) v FROM payouts ${isSuper(ctx) ? '' : 'WHERE pharmacy_id=' + Number(ctx.ph)} GROUP BY pharmacy_id`); const outM = Object.fromEntries(out.map((x) => [x.pharmacy_id, x.v]));
  return { totals: { transactions: rows.length, paid: paid.length, failed: rows.filter((r) => ['failed', 'cancelled', 'expired'].includes(r.status)).length, pending: rows.filter((r) => ['pending', 'awaiting_manual'].includes(r.status)).length, revenue_eur: sum(paid, (r) => inEur(r.amount, r.dec, r.currency, R)), refunded_eur: sum(paid, (r) => inEur(r.refunded, r.dec, r.currency, R)), commission_eur: sum(paid, (r) => inEur(r.commission, r.dec, r.currency, R)), flagged: rows.filter((r) => r.risk_score >= 40).length },
    by_pharmacy: by('pharmacy'), by_country: by('country'), by_method: by('method'),
    balances: [...bal.values()].map((b) => ({ ...b, paid_out: outM[b.pharmacy_id] || 0, due: b.net - (outM[b.pharmacy_id] || 0) })), recent: rows.slice(0, 50) };
});
router.get('/payments/export', { needsPharmacy: false }, (ctx) => {
  if (!isSuper(ctx) && !(ctx.ph && can(ctx.user, 'reports.export'))) throw forbidden('Permission requise'); const fmt = ['csv', 'xlsx', 'pdf'].includes(ctx.query.format) ? ctx.query.format : 'csv';
  const rows = statRows(ctx).map((r) => ({ date: r.created_at, order: r.order_number, customer: r.customer, pharmacy: r.pharmacy, country: r.country, method: r.method, status: r.status, currency: r.currency, amount: +(r.amount / 10 ** r.dec).toFixed(r.dec), refunded: +(r.refunded / 10 ** r.dec).toFixed(r.dec), commission: +(r.commission / 10 ** r.dec).toFixed(r.dec), reference: r.provider_ref, ip: r.ip, risk: r.risk_score }));
  const cols = ['date', 'order', 'customer', 'pharmacy', 'country', 'method', 'status', 'currency', 'amount', 'refunded', 'commission', 'reference', 'ip', 'risk']; audit(ctx, 'payments.export', 'report', 'paiements', undefined, { rows: rows.length, format: fmt });
  const send = (type, name, buf) => { ctx.res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` }); ctx.res.end(buf); };
  const L = { date: 'Date', order: 'Commande', customer: 'Client', pharmacy: 'Pharmacie', country: 'Pays', method: 'Moyen de paiement', status: 'Statut', currency: 'Devise', amount: 'Montant', refunded: 'Remboursé', commission: 'Commission', reference: 'Référence', ip: 'Adresse IP', risk: 'Risque' }, NUM = new Set(['amount', 'refunded', 'commission', 'risk']);
  const meta = exportMeta(ctx, { page: 'Paiements', view: 'Paiements en ligne' }), file = `paiements-en-ligne-${new Date().toISOString().slice(0, 10)}`;
  const send2 = (type, ext, buf) => send(type, `${file}.${ext}`, buf);
  if (fmt === 'xlsx') return send2('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', xlsx({ sheet: 'Paiements en ligne', columns: cols.map((k) => ({ key: k, label: L[k] || k, ...(NUM.has(k) ? { dec: k === 'risk' ? 0 : 2, sum: k !== 'risk' } : {}) })), rows, meta }));
  if (fmt === 'pdf') return send2('application/pdf', 'pdf', pdfTable({ title: meta.title, subtitle: meta.subtitle, columns: ['date', 'pharmacy', 'method', 'status', 'currency', 'amount'].map((k) => ({ key: k, label: L[k] })), rows: rows.slice(0, 5000), meta: { ...meta, totals: false }, footer: rows.length > 5000 ? 'PDF limité à 5000 lignes (Excel : tout)' : '' }));
  send('text/csv; charset=utf-8', `${file}.csv`, toCsv(rows, cols));
});

// ---------- taux de change ----------
router.get('/currency-rates', { needsPharmacy: false }, () => all('SELECT * FROM currency_rates ORDER BY code'));
router.put('/currency-rates/:code', { needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const code = String(ctx.params.code).toUpperCase(); if (!/^[A-Z]{3}$/.test(code)) throw bad('VALIDATION', 'Code devise ISO (3 lettres)'); const v = Number(ctx.body.per_eur); if (!(v > 0 && v < 1e9)) throw bad('VALIDATION', 'Taux invalide (unités de cette devise pour 1 EUR)');
  run("INSERT INTO currency_rates(code,per_eur,updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(code) DO UPDATE SET per_eur=excluded.per_eur, updated_at=datetime('now')", code, v); audit(ctx, 'currency.rate', 'currency', code, undefined, { per_eur: v }); return { ok: true };
});
router.get('/currency-convert', { needsPharmacy: false }, (ctx) => { const R = rateMap(), f = String(ctx.query.from || '').toUpperCase(), t = String(ctx.query.to || '').toUpperCase(), a = Number(ctx.query.amount); if (!R[f] || !R[t] || !(a >= 0)) throw bad('VALIDATION', 'Devise ou montant inconnu'); return { amount: a, from: f, to: t, result: +((a / R[f]) * R[t]).toFixed(4), rate: R[t] / R[f] }; });

// ---------- versements aux établissements ----------
router.get('/payouts', { needsPharmacy: false }, (ctx) => { if (!isSuper(ctx) && !ctx.ph) throw forbidden('Permission requise'); return all(`SELECT po.*, ph.name pharmacy FROM payouts po JOIN pharmacies ph ON ph.id=po.pharmacy_id ${isSuper(ctx) ? '' : 'WHERE po.pharmacy_id=' + Number(ctx.ph)} ORDER BY po.id DESC LIMIT 500`); });
router.post('/payouts', { needsPharmacy: false }, (ctx) => {
  needSuper(ctx); const ph = get('SELECT * FROM pharmacies WHERE id=?', Number(ctx.body.pharmacy_id)); if (!ph) throw notFound('Établissement'); if (!kycOk(ph.id)) throw conflict('KYC_REQUIRED', 'Vérification d\'identité (KYC) du bénéficiaire requise avant tout versement'); const amount = int(ctx.body.amount, 'montant', { required: true, min: 1 });
  const id = insert('INSERT INTO payouts(pharmacy_id,amount,currency,reference,note,user_id) VALUES (?,?,?,?,?,?)', ph.id, amount, ph.currency, str(ctx.body.reference, 'référence', { max: 80 }) || null, str(ctx.body.note, 'note', { max: 300 }) || null, ctx.user.id);
  audit(ctx, 'payout.create', 'payout', id, undefined, { pharmacy: ph.id, amount }); notify({ pharmacyId: ph.id, audience: 'manager', kind: 'payment', title: 'Versement effectué', body: `${(amount / 10 ** ph.currency_decimals).toFixed(ph.currency_decimals)} ${ph.currency}` }); return { id };
});
router.get('/payout-accounts/:pharmacyId', { needsPharmacy: false }, (ctx) => { if (!isSuper(ctx) && Number(ctx.params.pharmacyId) !== ctx.ph) throw forbidden('Permission requise'); const id = Number(ctx.params.pharmacyId); return { holder: getSetting(id, 'payout_holder', ''), account: getSetting(id, 'payout_account', ''), mobile: getSetting(id, 'payout_mobile', ''), instant: getSetting(id, 'payout_instant', '0') === '1' }; });
router.put('/payout-accounts/:pharmacyId', { needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const id = Number(ctx.params.pharmacyId); if (!get('SELECT 1 FROM pharmacies WHERE id=?', id)) throw notFound('Établissement');
  const put = (k, v) => run('INSERT INTO settings(pharmacy_id,skey,svalue) VALUES (?,?,?) ON CONFLICT(pharmacy_id,skey) DO UPDATE SET svalue=excluded.svalue', id, k, String(v));
  put('payout_holder', str(ctx.body.holder, 'titulaire', { max: 120 }) || ''); put('payout_account', str(ctx.body.account, 'compte bancaire', { max: 60 }) || ''); put('payout_mobile', str(ctx.body.mobile, 'mobile money', { max: 30 }) || ''); put('payout_instant', ctx.body.instant ? '1' : '0');
  audit(ctx, 'payout.account', 'pharmacy', id); return { ok: true };
});

// ---------- antivirus : journal ----------
router.get('/file-scans', { needsPharmacy: false }, (ctx) => {
  needSuper(ctx); const c = get("SELECT COUNT(*) total, COALESCE(SUM(verdict='infected'),0) infected FROM file_scans");
  return { total: c.total, infected: c.infected, clamav: !!process.env.CLAMD_HOST, recent: all("SELECT id,name,mime,size,verdict,reason,engine,created_at FROM file_scans ORDER BY id DESC LIMIT 100") };
});

// ---------- webhook de la passerelle configurable ----------
router.post('/payments/webhook/generic/:code', { public: true, ok200: true }, async (ctx) => {
  const m = get("SELECT * FROM payment_methods WHERE code=? AND provider='generic'", ctx.params.code); const op = m && get("SELECT * FROM online_payments WHERE id=? AND method_code=? AND provider='generic'", Number(ctx.query.op), m.code); if (!op) return { received: true };
  const cfg = cfgOf(m); let st = null;
  if (cfg.status_url) st = await verifyGeneric(op.provider_ref, m).catch(() => null); // l'état est relu chez le prestataire : le corps reçu n'est jamais cru
  else if (cfg.webhook_secret) { const sig = String(ctx.req.headers['x-signature'] || ''), exp = createHmac('sha256', cfg.webhook_secret).update(ctx.req.rawBody || '').digest('hex'); const a = Buffer.from(exp), b = Buffer.from(sig); if (a.length !== b.length || !timingSafeEqual(a, b)) throw forbidden('Signature invalide'); st = String(getPath(ctx.body, cfg.status_path || 'status') ?? '').toLowerCase(); if (String(cfg.success_values || 'paid,completed,success,succeeded').toLowerCase().split(/[\s,;]+/).includes(st)) st = 'paid'; }
  if (st === 'paid') markPaid(op.id, `Passerelle ${m.code}`); else if (['failed', 'cancelled', 'expired'].includes(st)) markFailed(op.id, st === 'expired' ? 'expired' : 'failed');
  return { received: true };
});
