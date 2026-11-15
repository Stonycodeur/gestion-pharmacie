// SMS : passerelle HTTP configurable (agrégateur local, Twilio-compatible, Orange/MTN…) sans modifier l'application.
// Configuration chiffrée (platform_settings.sms) ou variables d'environnement SMS_URL / SMS_API_KEY / SMS_AUTH_HEADER / SMS_BODY / SMS_SENDER.
import { get, run } from './db.js';
import { config } from './http.js';
import { decryptJson, encryptJson } from './security.js';
const fill = (tpl, v) => String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => JSON.stringify(String(v[k] ?? '')).slice(1, -1));
export function smsConfig() {
  const r = get("SELECT svalue FROM platform_settings WHERE skey='sms'"); let c = {}; try { c = r ? decryptJson(r.svalue, config.secret) : {}; } catch { c = {}; }
  return { url: c.url || process.env.SMS_URL || '', api_key: c.api_key || process.env.SMS_API_KEY || '', auth_header: c.auth_header || process.env.SMS_AUTH_HEADER || 'Authorization: Bearer {{key}}', body: c.body || process.env.SMS_BODY || '{"to":"{{to}}","from":"{{sender}}","text":"{{text}}"}', sender: c.sender || process.env.SMS_SENDER || 'Pharmacie', kinds: c.kinds || ['payment', 'delivery', 'appointment'], enabled: c.enabled !== false };
}
export const saveSmsConfig = (c) => run("INSERT INTO platform_settings(skey,svalue,updated_at) VALUES ('sms',?,datetime('now')) ON CONFLICT(skey) DO UPDATE SET svalue=excluded.svalue, updated_at=datetime('now')", encryptJson(c, config.secret));
export const smsEnabled = () => { const c = smsConfig(); return !!(c.url && c.enabled); };
export async function sendSms(phone, text, meta = {}) {
  const c = smsConfig(); const to = String(phone || '').replace(/[^\d+]/g, ''); const log = (status, error) => run('INSERT INTO sms_log(pharmacy_id,user_id,phone,body,status,error) VALUES (?,?,?,?,?,?)', meta.pharmacyId ?? null, meta.userId ?? null, to, String(text).slice(0, 320), status, error ? String(error).slice(0, 200) : null);
  if (!c.url || !c.enabled) return { ok: false, skipped: true }; if (!/^\+?\d{6,15}$/.test(to)) { log('failed', 'numéro invalide'); return { ok: false }; }
  if (config.prod && !/^https:\/\//.test(c.url)) { log('failed', 'HTTPS requis'); return { ok: false }; }
  try {
    const headers = { 'content-type': 'application/json' }; if (c.api_key) { const [k, ...v] = String(c.auth_header).split(/:\s*/); headers[k] = v.join(': ').replace('{{key}}', c.api_key); }
    const r = await fetch(c.url, { method: 'POST', headers, body: fill(c.body, { to, text: String(text).slice(0, 320), sender: c.sender }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) { log('failed', 'HTTP ' + r.status); return { ok: false }; } log('sent'); return { ok: true };
  } catch (e) { log('failed', e.message); return { ok: false }; }
}
