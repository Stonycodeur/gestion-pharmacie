// Modes de paiement (super-administrateur), paiements en ligne (portail), webhooks, bac à sable.
import { router, audit, can, config } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { bad, conflict, notFound, forbidden, str, oneOf, int, HttpError } from '../util.js';
import { PROVIDERS, cfgOf, saveCfg, startCheckout, markPaid, markFailed, verifyStripe, verifyKonnect, orderTotal, orderPaid, sandboxAllowed } from '../payments.js';

const needSuper = (ctx) => { if (ctx.user.role !== 'super_admin') throw forbidden('Réservé au super-administrateur'); };
const mask = (m, reveal) => { const cfg = cfgOf(m); const out = { ...m, config: undefined, has_config: Object.fromEntries(Object.keys(PROVIDERS[m.provider]?.fields.length ? Object.fromEntries(PROVIDERS[m.provider].fields.map((f) => [f, 1])) : {}).map((f) => [f, !!cfg[f]])) }; if (reveal) out.config = cfg; return out; };

// Liste : tout utilisateur connecté voit les modes actifs de son canal ; le super-admin voit tout (secrets masqués)
router.get('/payment-methods', { needsPharmacy: false }, (ctx) => {
  const ch = ctx.query.channel; const sup = ctx.user.role === 'super_admin' && ctx.query.all === '1';
  const rows = all('SELECT * FROM payment_methods ORDER BY sort_order, id').filter((m) => sup || (m.enabled && (!ch || (ch === 'pos' ? m.channel_pos : m.channel_online))));
  return sup ? { methods: rows.map((m) => mask(m)), providers: Object.entries(PROVIDERS).map(([code, p]) => ({ code, label: p.label, fields: p.fields, available: code !== 'sandbox' || sandboxAllowed() })) }
    : rows.map((m) => ({ code: m.code, label: m.label, kind: m.kind, provider: m.provider === 'manual' ? 'manual' : 'online', instructions: m.instructions }));
});
function input(b, old = {}) {
  const o = {}; const has = (k) => b[k] !== undefined;
  if (!old.code) { const code = String(b.code || '').trim().toLowerCase(); if (!/^[a-z][a-z0-9_]{1,30}$/.test(code)) throw bad('VALIDATION', 'Code : 2 à 31 caractères (a-z, 0-9, _)'); o.code = code; }
  if (has('label') || !old.code) o.label = str(b.label, 'libellé', { required: true, max: 80 });
  if (has('kind') || !old.code) o.kind = oneOf(b.kind, 'famille', ['cash', 'card', 'mobile', 'transfer', 'wallet'], { required: true });
  if (has('provider') || !old.code) o.provider = oneOf(b.provider || 'manual', 'prestataire', Object.keys(PROVIDERS));
  if (o.provider === 'sandbox' && !sandboxAllowed()) throw bad('VALIDATION', 'Le bac à sable est désactivé en production (PAYMENT_SANDBOX=true pour l\'autoriser)');
  for (const k of ['enabled', 'channel_pos', 'channel_online']) if (has(k)) o[k] = b[k] ? 1 : 0;
  if (has('instructions')) o.instructions = str(b.instructions, 'instructions', { max: 500 });
  if (has('sort_order')) o.sort_order = int(b.sort_order, 'ordre', { min: 0, max: 9999 });
  const prov = o.provider || old.provider || 'manual';
  if (prov !== 'manual' && (has('channel_pos') ? b.channel_pos : old.channel_pos)) throw bad('VALIDATION', 'Un mode avec passerelle en ligne n\'est pas utilisable en caisse : créez un mode manuel (TPE) pour le comptoir');
  return o;
}
function mergeCfg(old, provider, b) {
  if (!b.config || typeof b.config !== 'object') return undefined; const cur = old ? cfgOf(old) : {}; const next = { ...cur };
  for (const f of PROVIDERS[provider].fields) { const v = b.config[f]; if (v === undefined || v === null || /^•+$/.test(String(v))) continue; if (v === '') delete next[f]; else next[f] = String(v).slice(0, 300); }
  return saveCfg(next);
}
router.post('/payment-methods', { perm: 'settings.manage', needsPharmacy: false }, (ctx) => {
  needSuper(ctx); const o = input(ctx.body); if (get('SELECT 1 FROM payment_methods WHERE code=?', o.code)) throw conflict('DUPLICATE', 'Ce code existe déjà');
  const cfg = mergeCfg(null, o.provider, ctx.body); const id = insert('INSERT INTO payment_methods(code,label,kind,provider,enabled,channel_pos,channel_online,instructions,config,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)', o.code, o.label, o.kind, o.provider, o.enabled ?? 1, o.channel_pos ?? (o.provider === 'manual' ? 1 : 0), o.channel_online ?? (o.provider === 'manual' ? 0 : 1), o.instructions ?? null, cfg ?? null, o.sort_order ?? 100);
  audit(ctx, 'payment_method.create', 'payment_method', id, undefined, { code: o.code, provider: o.provider }); return { id };
});
router.put('/payment-methods/:id', { perm: 'settings.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const old = get('SELECT * FROM payment_methods WHERE id=?', ctx.params.id); if (!old) throw notFound('Mode de paiement');
  const o = input(ctx.body, old); const cfg = mergeCfg(old, o.provider || old.provider, ctx.body); if (cfg !== undefined) o.config = cfg;
  if (!Object.keys(o).length) throw bad('VALIDATION', 'Aucune modification');
  run(`UPDATE payment_methods SET ${Object.keys(o).map((k) => k + '=?').join(',')} WHERE id=?`, ...Object.values(o), old.id);
  audit(ctx, 'payment_method.update', 'payment_method', old.id, { enabled: old.enabled, provider: old.provider }, { ...o, config: o.config ? '[chiffré]' : undefined }); return { ok: true };
});
router.get('/payment-methods/:id/reveal', { perm: 'settings.manage', needsPharmacy: false }, (ctx) => { needSuper(ctx); const m = get('SELECT * FROM payment_methods WHERE id=?', ctx.params.id); if (!m) throw notFound('Mode de paiement'); audit(ctx, 'payment_method.reveal', 'payment_method', m.id); return { config: cfgOf(m) }; });
router.delete('/payment-methods/:id', { perm: 'settings.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const m = get('SELECT * FROM payment_methods WHERE id=?', ctx.params.id); if (!m) throw notFound('Mode de paiement');
  if (['cash'].includes(m.code)) throw forbidden('Le mode Espèces est indispensable');
  if (get('SELECT 1 FROM payments WHERE method_code=? LIMIT 1', m.code) || get('SELECT 1 FROM online_payments WHERE method_code=? LIMIT 1', m.code)) throw conflict('IN_USE', 'Déjà utilisé dans des paiements : désactivez-le plutôt');
  run('DELETE FROM payment_methods WHERE id=?', m.id); audit(ctx, 'payment_method.delete', 'payment_method', m.id, { code: m.code }); return { ok: true };
});

// ---------- portail : payer une commande ----------
const myCustomer = (ctx) => { const c = get('SELECT * FROM customers WHERE user_id=? LIMIT 1', ctx.user.id); if (!c) throw notFound('Fiche client'); return c; };
router.post('/portal/orders/:id/pay', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false, ok200: true }, async (ctx) => {
  const c = myCustomer(ctx); const o = get('SELECT * FROM customer_orders WHERE id=? AND customer_id IN (SELECT id FROM customers WHERE user_id=?)', ctx.params.id, ctx.user.id); if (!o) throw notFound('Commande');
  if (['cancelled', 'expired', 'picked_up'].includes(o.status)) throw conflict('BAD_STATE', 'Cette commande n\'est plus payable');
  const m = get('SELECT * FROM payment_methods WHERE code=? AND enabled=1 AND channel_online=1', String(ctx.body.method_code || '')); if (!m) throw bad('VALIDATION', 'Mode de paiement indisponible');
  const due = orderTotal(o.id) - orderPaid(o.id) - get("SELECT COALESCE(SUM(amount),0) v FROM online_payments WHERE order_id=? AND status IN ('pending','awaiting_manual')", o.id).v;
  if (due < 1) throw conflict('ALREADY_PAID', 'Rien à payer (déjà réglé ou paiement en cours)');
  const ph = get('SELECT currency,currency_decimals FROM pharmacies WHERE id=?', o.pharmacy_id);
  const id = insert('INSERT INTO online_payments(pharmacy_id,order_id,customer_id,user_id,method_code,provider,amount,status) VALUES (?,?,?,?,?,?,?,?)', o.pharmacy_id, o.id, o.customer_id, ctx.user.id, m.code, m.provider, due, m.provider === 'manual' ? 'awaiting_manual' : 'pending');
  audit(ctx, 'payment.online_start', 'order', o.id, undefined, { amount: due, method: m.code });
  if (m.provider === 'manual') return { id, mode: 'manual', amount: due, instructions: m.instructions || 'La pharmacie confirmera la réception de votre paiement.' };
  try { const r = await startCheckout({ id, amount: due }, m, ph, o); run('UPDATE online_payments SET provider_ref=?, checkout_url=? WHERE id=?', r.provider_ref, r.checkout_url, id); return { id, mode: 'redirect', amount: due, checkout_url: r.checkout_url }; }
  catch (e) { markFailed(id, 'failed', e.message); console.error('[paiement]', e.message); throw new HttpError(502, 'GATEWAY_ERROR', 'Le prestataire de paiement est indisponible, réessayez ou choisissez un autre mode'); }
});
router.get('/portal/orders/:id/payments', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => { const o = get('SELECT id FROM customer_orders WHERE id=? AND customer_id IN (SELECT id FROM customers WHERE user_id=?)', ctx.params.id, ctx.user.id); if (!o) throw notFound('Commande'); return { total: orderTotal(o.id), paid: orderPaid(o.id), payments: all('SELECT id,method_code,amount,status,created_at,paid_at FROM online_payments WHERE order_id=? ORDER BY id DESC', o.id) }; });

// ---------- personnel : suivi et confirmation manuelle ----------
router.get('/online-payments', { perm: 'orders.view' }, (ctx) => all(`SELECT p.*, o.number order_number, c.name customer_name, m.label method_label FROM online_payments p JOIN customer_orders o ON o.id=p.order_id JOIN customers c ON c.id=p.customer_id LEFT JOIN payment_methods m ON m.code=p.method_code WHERE p.pharmacy_id=? ${ctx.query.status ? 'AND p.status=?' : ''} ORDER BY p.id DESC LIMIT 200`, ctx.ph, ...(ctx.query.status ? [ctx.query.status] : [])));
router.post('/online-payments/:id/confirm', { perm: 'sales.deposit', ok200: true }, (ctx) => {
  const op = get('SELECT * FROM online_payments WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!op) throw notFound('Paiement');
  if (op.provider !== 'manual') throw conflict('GATEWAY', 'Ce paiement est confirmé automatiquement par le prestataire');
  if (op.status !== 'awaiting_manual') throw conflict('BAD_STATE', 'Paiement déjà traité'); markPaid(op.id, `Confirmé par ${ctx.user.email}`); audit(ctx, 'payment.manual_confirm', 'order', op.order_id, undefined, { amount: op.amount }); return { ok: true };
});
router.post('/online-payments/:id/cancel', { perm: 'sales.deposit', ok200: true }, (ctx) => {
  const op = get('SELECT * FROM online_payments WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!op) throw notFound('Paiement'); if (op.status === 'paid') throw conflict('BAD_STATE', 'Déjà encaissé : utilisez le remboursement d\'acompte');
  markFailed(op.id, 'cancelled'); audit(ctx, 'payment.cancel', 'order', op.order_id); return { ok: true };
});

// ---------- webhooks (publics, authentifiés par signature / vérification auprès du prestataire) ----------
router.post('/payments/webhook/stripe', { public: true, ok200: true }, (ctx) => {
  const raw = ctx.req.rawBody || ''; const sig = ctx.req.headers['stripe-signature'];
  const ok = all("SELECT * FROM payment_methods WHERE provider='stripe'").some((m) => verifyStripe(raw, sig, cfgOf(m).webhook_secret));
  if (!ok) throw forbidden('Signature invalide');
  const ev = ctx.body; const s = ev?.data?.object; const opId = Number(s?.client_reference_id || s?.metadata?.online_payment_id);
  if (!opId || !get('SELECT 1 FROM online_payments WHERE id=? AND provider=?', opId, 'stripe')) return { received: true };
  if (ev.type === 'checkout.session.completed' && s.payment_status === 'paid') markPaid(opId, 'Stripe ' + s.id);
  else if (ev.type === 'checkout.session.expired') markFailed(opId, 'expired'); else if (ev.type === 'checkout.session.async_payment_failed') markFailed(opId, 'failed');
  return { received: true };
});
const konnectHook = async (ctx) => {
  const ref = String(ctx.query.payment_ref || ctx.body?.payment_ref || ''); const op = ref && get("SELECT * FROM online_payments WHERE provider_ref=? AND provider='konnect'", ref); if (!op) return { received: true };
  const m = get('SELECT * FROM payment_methods WHERE code=?', op.method_code); const st = m ? await verifyKonnect(ref, m).catch(() => null) : null; // l'état est relu chez Konnect : le paramètre reçu n'est jamais cru
  if (st === 'completed') markPaid(op.id, 'Konnect ' + ref); else if (st === 'expired') markFailed(op.id, 'expired');
  return { received: true };
};
router.get('/payments/webhook/konnect', { public: true, ok200: true }, konnectHook); router.post('/payments/webhook/konnect', { public: true, ok200: true }, konnectHook);

// ---------- bac à sable (test) : fausse page de paiement ----------
const page = (res, status, html) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" }); res.end(html); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
router.get('/pay/sandbox/:ref', { public: true }, (ctx) => {
  if (!sandboxAllowed()) throw notFound('Page'); const op = get("SELECT p.*, o.number FROM online_payments p JOIN customer_orders o ON o.id=p.order_id WHERE p.provider_ref=? AND p.provider='sandbox'", ctx.params.ref); if (!op) throw notFound('Paiement');
  const ph = get('SELECT currency,currency_decimals FROM pharmacies WHERE id=?', op.pharmacy_id); const amt = (op.amount / 10 ** ph.currency_decimals).toFixed(ph.currency_decimals) + ' ' + ph.currency;
  page(ctx.res, 200, `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Paiement test</title><body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px"><h2>Passerelle de TEST</h2><p>Commande <b>${esc(op.number)}</b><br>Montant : <b>${esc(amt)}</b></p><p style="color:#92580a">Aucun argent réel n'est débité.</p><p><a href="${esc(`/api/v1/pay/sandbox/${op.provider_ref}/ok`)}" style="display:block;padding:14px;background:#0f766e;color:#fff;text-align:center;border-radius:10px;text-decoration:none;margin-bottom:10px">Payer (simuler un succès)</a><a href="${esc(`/api/v1/pay/sandbox/${op.provider_ref}/fail`)}" style="display:block;padding:14px;background:#eee;text-align:center;border-radius:10px;text-decoration:none">Échec / annuler</a></p>`);
});
for (const [res_, ok] of [['ok', true], ['fail', false]]) router.get(`/pay/sandbox/:ref/${res_}`, { public: true }, (ctx) => {
  if (!sandboxAllowed()) throw notFound('Page'); const op = get("SELECT * FROM online_payments WHERE provider_ref=? AND provider='sandbox'", ctx.params.ref); if (!op) throw notFound('Paiement');
  if (ok) markPaid(op.id, 'Bac à sable'); else markFailed(op.id, 'cancelled');
  ctx.res.writeHead(302, { Location: `${(process.env.APP_URL || '').replace(/\/$/, '')}/#/portal?${ok ? 'paid' : 'cancelled'}=${op.id}`, 'Cache-Control': 'no-store' }); ctx.res.end();
});
