// Passerelles de paiement en ligne : Stripe Checkout, Konnect (Tunisie) et bac à sable intégré (développement).
// Aucun montant n'est crédité sans confirmation signée/vérifiée du prestataire (webhook), jamais sur simple retour navigateur.
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { get, all, run, insert, tx } from './db.js';
import { decryptJson, encryptJson } from './security.js';
import { config, audit, notify, publish } from './http.js';

export const PROVIDERS = {
  manual: { label: 'Manuel (espèces, TPE, virement, chèque…)', fields: [] },
  stripe: { label: 'Stripe (carte bancaire)', fields: ['secret_key', 'webhook_secret', 'base_url'] },
  konnect: { label: 'Konnect (Tunisie : carte, e-DINAR, portefeuille)', fields: ['api_key', 'wallet_id', 'base_url'] },
  sandbox: { label: 'Bac à sable (test, sans argent réel)', fields: [] },
};
export const cfgOf = (m) => { try { return m.config ? decryptJson(m.config, config.secret) : {}; } catch { return {}; } };
export const saveCfg = (obj) => encryptJson(obj, config.secret);
export const sandboxAllowed = () => !config.prod || process.env.PAYMENT_SANDBOX === 'true';
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiUrl = () => (process.env.API_PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';

export const orderTotal = (orderId) => get('SELECT COALESCE(SUM(l.qty * p.sale_price),0) v FROM order_lines l JOIN products p ON p.id=l.product_id WHERE l.order_id=?', orderId).v;
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
  throw new Error('Mode de paiement sans passerelle');
}

// ---- confirmations ----
export function markPaid(opId, detail) {
  return tx(() => {
    const op = get('SELECT * FROM online_payments WHERE id=?', opId); if (!op) return null;
    if (op.status === 'paid') return op;
    if (!['pending', 'awaiting_manual', 'failed', 'expired'].includes(op.status)) return op;
    const m = get('SELECT kind FROM payment_methods WHERE code=?', op.method_code);
    const dep = insert('INSERT INTO order_deposits(order_id,method,method_code,amount,session_id,status,user_id) VALUES (?,?,?,?,NULL,?,?)', op.order_id, m?.kind || 'card', op.method_code, op.amount, 'held', op.user_id);
    run("UPDATE online_payments SET status='paid', paid_at=datetime('now'), deposit_id=?, detail=COALESCE(?,detail) WHERE id=?", dep, detail ?? null, op.id);
    const o = get('SELECT number FROM customer_orders WHERE id=?', op.order_id);
    audit({ ph: op.pharmacy_id, user: null, ip: null }, 'payment.online_paid', 'order', op.order_id, undefined, { amount: op.amount, method: op.method_code, ref: op.provider_ref });
    notify({ pharmacyId: op.pharmacy_id, audience: 'staff', kind: 'payment', title: `Paiement en ligne reçu - ${o.number}` });
    if (op.user_id) notify({ pharmacyId: op.pharmacy_id, userId: op.user_id, kind: 'payment', title: `Paiement reçu pour ${o.number}`, body: 'Merci, votre paiement est confirmé.' });
    publish(op.pharmacy_id, 'order', { id: op.order_id, payment: 'paid' }, op.user_id);
    return { ...op, status: 'paid' };
  });
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
export const allMethods = () => all('SELECT * FROM payment_methods ORDER BY sort_order, id');
