// Remboursement côté prestataire, événements sortants (webhooks signés) et clés d'API externes.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { get, all, run } from './db.js';
import { config } from './http.js';
import { cfgOf, getPath } from './payments.js';

const fill = (tpl, vars) => String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '').replace(/["\\\n\r]/g, ''));
// Retourne { status: 'done'|'manual'|'unsupported', ref } ; lève une erreur si le prestataire refuse (aucun remboursement enregistré dans ce cas).
export async function refundAtGateway(op, method, ph, amount, reason) {
  const cfg = method ? cfgOf(method) : {}; const dec = ph.currency_decimals ?? 2;
  if (!method || method.provider === 'manual') return { status: 'manual' };
  if (method.provider === 'sandbox') return { status: 'done', ref: 'sbx_rf_' + randomBytes(6).toString('hex') };
  if (method.provider === 'stripe') {
    if (!cfg.secret_key) throw new Error('Clé Stripe manquante');
    const base = cfg.base_url || 'https://api.stripe.com', H = { authorization: 'Bearer ' + cfg.secret_key, 'content-type': 'application/x-www-form-urlencoded' };
    let pi = op.provider_ref; if (String(pi).startsWith('cs_')) { const s = await fetch(`${base}/v1/checkout/sessions/${encodeURIComponent(pi)}`, { headers: H, signal: AbortSignal.timeout(20000) }); const j = await s.json().catch(() => ({})); if (!s.ok || !j.payment_intent) throw new Error('Stripe : ' + (j.error?.message || 'paiement introuvable')); pi = j.payment_intent; }
    let unit = amount; if (dec === 3) unit = Math.round(amount / 10) * 10;
    const r = await fetch(`${base}/v1/refunds`, { method: 'POST', headers: { ...H, 'idempotency-key': `rf-${op.id}-${op.refunded}-${amount}` }, body: new URLSearchParams({ payment_intent: pi, amount: String(unit), 'metadata[reason]': String(reason).slice(0, 200) }), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('Stripe : ' + (j.error?.message || 'HTTP ' + r.status)); return { status: 'done', ref: j.id };
  }
  if (method.provider === 'generic') {
    if (!cfg.refund_url) return { status: 'manual' }; // passerelle sans API de remboursement configurée
    if (config.prod && !/^https:\/\//.test(cfg.refund_url)) throw new Error('La passerelle doit utiliser HTTPS en production');
    const vars = { amount, amount_decimal: (amount / 10 ** dec).toFixed(dec), currency: op.currency || ph.currency, provider_ref: op.provider_ref, reference: `OP-${op.id}`, reason };
    const headers = { 'content-type': 'application/json' }; if (cfg.api_key) { const [hk, hv] = String(cfg.auth_header || 'Authorization: Bearer {{key}}').split(/:\s*/); headers[hk] = (hv || 'Bearer {{key}}').replace('{{key}}', cfg.api_key); }
    const r = await fetch(fill(cfg.refund_url, vars), { method: 'POST', headers, body: fill(cfg.refund_body_template || '{"payment":"{{provider_ref}}","amount":"{{amount_decimal}}","reason":"{{reason}}"}', vars), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('Passerelle : ' + (j.message || j.error || 'HTTP ' + r.status)); return { status: 'done', ref: String(getPath(j, cfg.refund_ref_path || 'id') || '') || null };
  }
  return { status: 'unsupported' }; // Konnect et autres : pas d'API de remboursement publique → à faire depuis le tableau de bord du prestataire
}

// ---- événements sortants : POST signé HMAC-SHA256 (en-tête X-Signature: sha256=…) ----
export function emitEvent(pharmacyId, event, data) {
  try {
    const eps = all("SELECT * FROM webhook_endpoints WHERE active=1 AND (pharmacy_id IS NULL OR pharmacy_id=?)", pharmacyId).filter((e) => String(e.events).split(',').map((x) => x.trim()).includes(event));
    for (const e of eps) {
      const body = JSON.stringify({ id: randomBytes(8).toString('hex'), event, created_at: new Date().toISOString(), pharmacy_id: pharmacyId, data }); const sig = createHmac('sha256', e.secret).update(body).digest('hex');
      (async () => { let st = 'failed'; for (let i = 0; i < 3; i++) { try { const r = await fetch(e.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': 'sha256=' + sig, 'x-event': event }, body, signal: AbortSignal.timeout(10000) }); st = r.ok ? 'ok' : 'HTTP ' + r.status; if (r.ok) break; } catch (er) { st = 'erreur : ' + er.message.slice(0, 80); } await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
        try { run("UPDATE webhook_endpoints SET last_status=?, last_at=datetime('now') WHERE id=?", st, e.id); } catch { /* arrêt */ } })();
    }
  } catch { /* les événements ne bloquent jamais un paiement */ }
}
export const validWebhookUrl = (u) => { try { const x = new URL(u); if (!['https:', 'http:'].includes(x.protocol)) return false; if (config.prod && x.protocol !== 'https:') return false; if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(x.hostname) || x.hostname.endsWith('.local')) return !config.prod; return true; } catch { return false; } };

// ---- clés d'API ----
const hashKey = (k) => createHash('sha256').update(k).digest('hex');
export function newApiKey() { const key = 'gp_' + randomBytes(24).toString('base64url'); return { key, prefix: key.slice(0, 9), hash: hashKey(key) }; }
export function apiKeyAuth(ctx, scope) {
  const k = String(ctx.req.headers['x-api-key'] || (/^Bearer gp_/.test(ctx.req.headers.authorization || '') ? ctx.req.headers.authorization.slice(7) : '')); if (!k) return null;
  const row = get('SELECT * FROM api_keys WHERE key_hash=? AND revoked_at IS NULL', hashKey(k)); if (!row) return null;
  const a = Buffer.from(hashKey(k)), b = Buffer.from(row.key_hash); if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!String(row.scopes).split(',').includes(scope)) return false; run("UPDATE api_keys SET last_used_at=datetime('now') WHERE id=?", row.id); return row;
}
