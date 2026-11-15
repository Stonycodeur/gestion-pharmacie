// Passerelles de paiement en ligne : Stripe Checkout, Konnect (Tunisie) et bac à sable intégré (développement).
// Aucun montant n'est crédité sans confirmation signée/vérifiée du prestataire (webhook), jamais sur simple retour navigateur.
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { get, all, run, insert, tx } from './db.js';
import { decryptJson, encryptJson } from './security.js';
import { config, audit, notify, publish } from './http.js';
import { createReceipt, emailReceipt } from './receipts.js';
import { emitEvent } from './finance.js';

export const PROVIDERS = {
  manual: { label: 'Manuel (espèces, TPE, virement, chèque…)', fields: [] },
  stripe: { label: 'Stripe (carte bancaire)', fields: ['secret_key', 'webhook_secret', 'base_url'] },
  konnect: { label: 'Konnect (Tunisie : carte, e-DINAR, portefeuille)', fields: ['api_key', 'wallet_id', 'base_url'] },
  generic: { label: 'Passerelle HTTP configurable (agrégateur Mobile Money, PayPal, Wave, crypto… sans modifier l\'application)', fields: ['init_url', 'api_key', 'auth_header', 'body_template', 'ref_path', 'url_path', 'status_url', 'status_path', 'success_values', 'webhook_secret', 'refund_url', 'refund_body_template', 'refund_ref_path'] },
  sandbox: { label: 'Bac à sable (test, sans argent réel)', fields: [] },
};
// Champs que l'application ne collecte JAMAIS : codes PIN, mots de passe, numéro/CVV de carte (saisis uniquement chez le prestataire).
export const FORBIDDEN_FIELD = /pin|pass|pwd|cvv|cvc|card|pan\b|secret|iban|otp/i;
export const getPath = (o, path) => String(path || '').split('.').filter(Boolean).reduce((a, k) => (a == null ? a : a[k]), o);
const fill = (tpl, vars) => String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '').replace(/["\\\n\r]/g, ''));
export const commissionOf = (m, amount) => Math.round((amount * (m?.commission_bp || 0)) / 10000) + (m?.commission_fixed || 0);
export const cfgOf = (m) => { try { return m.config ? decryptJson(m.config, config.secret) : {}; } catch { return {}; } };
export const saveCfg = (obj) => encryptJson(obj, config.secret);
export const sandboxAllowed = () => !config.prod || process.env.PAYMENT_SANDBOX === 'true';
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiUrl = () => (process.env.API_PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';

export const orderTotal = (orderId) => get('SELECT COALESCE(SUM(l.qty * p.sale_price),0) v FROM order_lines l JOIN products p ON p.id=l.product_id WHERE l.order_id=?', orderId).v;
// Frais de livraison de la course en cours (hors courses annulées) : suit les contre-propositions acceptées et les changements de mode.
export const deliveryOf = (orderId) => get("SELECT id,fee,status,mode FROM deliveries WHERE order_id=? AND status<>'cancelled' ORDER BY id DESC LIMIT 1", orderId);
export const deliveryFee = (orderId) => deliveryOf(orderId)?.fee || 0;
export const orderGrandTotal = (orderId) => orderTotal(orderId) + deliveryFee(orderId); // commande + livraison
export const orderPaid = (orderId) => get("SELECT COALESCE(SUM(amount),0) v FROM order_deposits WHERE order_id=? AND status IN ('held','applied')", orderId).v;

// ---- ouverture d'un paiement chez le prestataire ----
export async function startCheckout(op, method, ph, order) {
  const cfg = cfgOf(method), ret = `${appUrl()}/#/portal?paid=${op.id}`, cancel = `${appUrl()}/#/portal?cancelled=${op.id}`;
  if (method.provider === 'sandbox') {
    if (!sandboxAllowed()) throw new Error('Bac à sable désactivé en production');
    const ref = 'sbx_' + randomBytes(12).toString('hex'); return { provider_ref: ref, checkout_url: `${apiUrl()}/pay/sandbox/${ref}` };
  }
  if (method.provider === 'stripe') {
    if (!cfg.secret_key) throw new Error('Clé Stripe manquante');
    const dec = ph.currency_decimals ?? 2; let unit = op.amount; if (dec === 3) unit = Math.round(op.amount / 10) * 10; // Stripe : devises à 3 décimales divisibles par 10
    const f = new URLSearchParams({ mode: 'payment', success_url: ret, cancel_url: cancel, client_reference_id: String(op.id), 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': String(ph.currency || 'TND').toLowerCase(), 'line_items[0][price_data][unit_amount]': String(unit), 'line_items[0][price_data][product_data][name]': `Commande ${order.number}`, 'metadata[online_payment_id]': String(op.id) });
    const r = await fetch((cfg.base_url || 'https://api.stripe.com') + '/v1/checkout/sessions', { method: 'POST', headers: { authorization: 'Bearer ' + cfg.secret_key, 'content-type': 'application/x-www-form-urlencoded' }, body: f, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) throw new Error('Stripe : ' + (j.error?.message || 'HTTP ' + r.status));
    return { provider_ref: j.id, checkout_url: j.url };
  }
  if (method.provider === 'konnect') {
    if (!cfg.api_key || !cfg.wallet_id) throw new Error('Clé API ou portefeuille Konnect manquant');
    const base = (cfg.base_url || 'https://api.konnect.network/api/v2').replace(/\/$/, '');
    const r = await fetch(base + '/payments/init-payment', { method: 'POST', headers: { 'x-api-key': cfg.api_key, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ receiverWalletId: cfg.wallet_id, token: ph.currency || 'TND', amount: op.amount, type: 'immediate', description: `Commande ${order.number}`, acceptedPaymentMethods: ['wallet', 'bank_card', 'e-DINAR'], lifespan: 30, checkoutForm: false, addPaymentFeesToAmount: false, orderId: String(op.id), webhook: `${apiUrl()}/payments/webhook/konnect`, silentWebhook: true, successUrl: ret, failUrl: cancel, theme: 'light' }) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.payUrl) throw new Error('Konnect : ' + (j.message || j.errors?.[0]?.message || 'HTTP ' + r.status));
    return { provider_ref: j.paymentRef, checkout_url: j.payUrl };
  }
  if (method.provider === 'generic') {
    if (!cfg.init_url) throw new Error('URL de la passerelle manquante');
    if (config.prod && !/^https:\/\//.test(cfg.init_url)) throw new Error('La passerelle doit utiliser HTTPS en production');
    const dec = ph.currency_decimals ?? 2, vars = { amount: op.amount, amount_decimal: (op.amount / 10 ** dec).toFixed(dec), currency: op.currency || ph.currency, reference: `OP-${op.id}`, order: order.number, return_url: ret, cancel_url: cancel, webhook_url: `${apiUrl()}/payments/webhook/generic/${method.code}?op=${op.id}`, payer_phone: op.payer_ref || '', payer_email: '' };
    const headers = { 'content-type': 'application/json' }; if (cfg.api_key) { const [hk, hv] = String(cfg.auth_header || 'Authorization: Bearer {{key}}').split(/:\s*/); headers[hk] = (hv || 'Bearer {{key}}').replace('{{key}}', cfg.api_key); }
    const r = await fetch(cfg.init_url, { method: 'POST', headers, body: fill(cfg.body_template || '{"amount":"{{amount_decimal}}","currency":"{{currency}}","reference":"{{reference}}","return_url":"{{return_url}}","callback_url":"{{webhook_url}}"}', vars), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({})); const ref = getPath(j, cfg.ref_path || 'id'), url = getPath(j, cfg.url_path || 'checkout_url');
    if (!r.ok || !url) throw new Error('Passerelle : ' + (j.message || j.error || 'HTTP ' + r.status));
    return { provider_ref: String(ref || vars.reference), checkout_url: String(url) };
  }
  throw new Error('Mode de paiement sans passerelle');
}

// ---- confirmations ----
export function markPaid(opId, detail) {
  let receiptId = null;
  const res = tx(() => {
    const op = get('SELECT * FROM online_payments WHERE id=?', opId); if (!op) return null;
    if (op.status === 'paid') return op;
    if (!['pending', 'awaiting_manual', 'failed', 'expired'].includes(op.status)) return op;
    const m = get('SELECT kind,label FROM payment_methods WHERE code=?', op.method_code);
    const dep = insert('INSERT INTO order_deposits(order_id,method,method_code,amount,session_id,status,user_id) VALUES (?,?,?,?,NULL,?,?)', op.order_id, m?.kind || 'card', op.method_code, op.amount, 'held', op.user_id);
    run("UPDATE online_payments SET status='paid', paid_at=datetime('now'), deposit_id=?, detail=COALESCE(?,detail) WHERE id=?", dep, detail ?? null, op.id);
    const o = get('SELECT number FROM customer_orders WHERE id=?', op.order_id);
    const rc = createReceipt({ ...op, status: 'paid' }, m?.label || op.method_code); receiptId = rc.id;
    audit({ ph: op.pharmacy_id, user: null, ip: null }, 'payment.online_paid', 'order', op.order_id, undefined, { amount: op.amount, method: op.method_code, ref: op.provider_ref });
    notify({ pharmacyId: op.pharmacy_id, audience: 'staff', kind: 'payment', title: `Paiement en ligne reçu — ${o.number}`, link: `#/orders?id=${o.id}` });
    if (op.user_id) notify({ pharmacyId: op.pharmacy_id, userId: op.user_id, kind: 'payment', link: `#/portal?tab=orders&id=${op.order_id}`, title: `Paiement réussi : ${(op.amount / 10 ** rc.decimals).toFixed(rc.decimals)} ${rc.currency}`, body: `Reçu ${rc.number} · réf. ${rc.reference} · ${rc.method_label} · ${rc.created_at} UTC · statut : payé` });
    publish(op.pharmacy_id, 'order', { id: op.order_id, payment: 'paid' }, op.user_id);
    emitEvent(op.pharmacy_id, 'payment.paid', { payment_id: op.id, order: o.number, amount: op.amount, currency: rc.currency, method: op.method_code, receipt: rc.number, reference: op.provider_ref });
    return { ...op, status: 'paid' };
  });
  if (receiptId) setImmediate(async () => { try { const u = get('SELECT u.email FROM online_payments p JOIN users u ON u.id=p.user_id WHERE p.id=?', opId); if (u?.email) await emailReceipt(receiptId, u.email); } catch (e) { console.error('[reçu e-mail]', e.message); } });
  return res;
}
export function markFailed(opId, status = 'failed', detail) {
  const op = get('SELECT * FROM online_payments WHERE id=?', opId); if (!op || op.status === 'paid') return op;
  run('UPDATE online_payments SET status=?, detail=COALESCE(?,detail) WHERE id=?', status, detail ?? null, opId); publish(op.pharmacy_id, 'order', { id: op.order_id, payment: status }, op.user_id); return { ...op, status };
}
// Signature Stripe : t=timestamp,v1=HMAC-SHA256(secret, `${t}.${corps}`), tolérance 5 min
export function verifyStripe(raw, header, secret) {
  const p = Object.fromEntries(String(header || '').split(',').map((x) => x.split('='))); if (!p.t || !p.v1 || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(p.t)) > 300) return false;
  const exp = createHmac('sha256', secret).update(`${p.t}.${raw}`).digest('hex'); const a = Buffer.from(exp), b = Buffer.from(String(p.v1));
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function verifyKonnect(ref, method) {
  const cfg = cfgOf(method), base = (cfg.base_url || 'https://api.konnect.network/api/v2').replace(/\/$/, '');
  const r = await fetch(`${base}/payments/${encodeURIComponent(ref)}`, { headers: { 'x-api-key': cfg.api_key }, signal: AbortSignal.timeout(20000) }); const j = await r.json().catch(() => ({}));
  return r.ok ? j.payment?.status : null;
}
export async function verifyGeneric(ref, method) {
  const cfg = cfgOf(method); if (!cfg.status_url) return null;
  const headers = {}; if (cfg.api_key) { const [hk, hv] = String(cfg.auth_header || 'Authorization: Bearer {{key}}').split(/:\s*/); headers[hk] = (hv || 'Bearer {{key}}').replace('{{key}}', cfg.api_key); }
  const r = await fetch(cfg.status_url.replace('{{ref}}', encodeURIComponent(ref)), { headers, signal: AbortSignal.timeout(20000) }); const j = await r.json().catch(() => ({}));
  if (!r.ok) return null; const st = String(getPath(j, cfg.status_path || 'status') ?? '').toLowerCase();
  return String(cfg.success_values || 'paid,completed,success,succeeded').toLowerCase().split(/[\s,;]+/).includes(st) ? 'paid' : st || null;
}
export const allMethods = () => all('SELECT * FROM payment_methods ORDER BY sort_order, id');
