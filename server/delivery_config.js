// Tarification des livraisons : 4 modes, calculés à partir de la distance pharmacie → client, du tarif de base du mode,
// du coût au kilomètre et des majorations réglés par l'administration (par pharmacie). Montants stockés en unités mineures.
import { get, all, run, getSetting } from './db.js';

export const MODES = {
  economy: { label: 'Livraison Économique', short: 'Économique', hint: 'Prix le plus bas : le chauffeur peut grouper plusieurs livraisons de la même zone.', eta: [45, 90], base: [1000, 1] },
  standard: { label: 'Livraison Standard', short: 'Standard', hint: 'Recommandé : chauffeur disponible le plus proche, livraison directe.', eta: [20, 45], base: [1500, 1.5] },
  express: { label: 'Livraison Express', short: 'Express', hint: 'Priorité maximale, aucune autre mission pendant la course.', eta: [10, 20], base: [2500, 2.5] },
  scheduled: { label: 'Livraison Programmée', short: 'Programmée', hint: 'Vous choisissez la date et l\'heure ; le chauffeur est réservé et un rappel est envoyé.', eta: [0, 0], base: [2000, 2] },
};
export const MODE_CODES = Object.keys(MODES);
const num = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };

export function dlvConfig(pharmacyId) {
  const ph = get('SELECT currency_decimals d FROM pharmacies WHERE id=?', pharmacyId) || { d: 0 }, f = 10 ** (ph.d ?? 0), major = ph.d >= 2 ? 1 : 0;
  let st = {}; try { st = JSON.parse(getSetting(pharmacyId, 'delivery_config', '{}') || '{}'); } catch { /* défauts */ }
  const base = {}, eta = {};
  for (const m of MODE_CODES) { base[m] = Math.round(num(st.base?.[m], 0, 1e12, MODES[m].base[major] * f)); eta[m] = [Math.round(num(st.eta?.[m]?.[0], 0, 10000, MODES[m].eta[0])), Math.round(num(st.eta?.[m]?.[1], 0, 10000, MODES[m].eta[1]))]; }
  return { base, eta, per_km: Math.round(num(st.per_km, 0, 1e12, (major ? 0.1 : 100) * f)), max_km: num(st.max_km, 0, 100000, 30), express_pct: num(st.express_pct, 0, 1000, 0),
    negotiation: st.negotiation === undefined ? true : !!st.negotiation, margin_pct: num(st.margin_pct, 0, 1000, 50) };
}
export const priceFor = (cfg, mode, km) => Math.round((cfg.base[mode] + cfg.per_km * (km || 0)) * (mode === 'express' ? 1 + cfg.express_pct / 100 : 1));
export const negotiationRange = (cfg, standard) => ({ min: Math.max(0, Math.floor(standard * (1 - cfg.margin_pct / 100))), max: Math.ceil(standard * (1 + cfg.margin_pct / 100)) });
export const modesView = (cfg, km) => MODE_CODES.map((m) => ({ mode: m, label: MODES[m].label, hint: MODES[m].hint, price: priceFor(cfg, m, km), eta_min: cfg.eta[m][0], eta_max: cfg.eta[m][1], scheduled: m === 'scheduled', default: m === 'standard' }));
export function saveConfig(pharmacyId, body) {
  const cur = dlvConfig(pharmacyId), out = { base: {}, eta: {} };
  for (const m of MODE_CODES) { out.base[m] = Math.round(num(body.base?.[m], 0, 1e12, cur.base[m])); const e = body.eta?.[m] || cur.eta[m]; out.eta[m] = [Math.round(num(e[0], 0, 10000, cur.eta[m][0])), Math.round(num(e[1], 0, 10000, cur.eta[m][1]))]; if (out.eta[m][1] < out.eta[m][0]) out.eta[m][1] = out.eta[m][0]; }
  out.per_km = Math.round(num(body.per_km, 0, 1e12, cur.per_km)); out.max_km = num(body.max_km, 0, 100000, cur.max_km); out.express_pct = num(body.express_pct, 0, 1000, cur.express_pct);
  out.negotiation = body.negotiation === undefined ? cur.negotiation : !!body.negotiation; out.margin_pct = num(body.margin_pct, 0, 1000, cur.margin_pct);
  run('INSERT INTO settings(pharmacy_id,skey,svalue) VALUES (?,?,?) ON CONFLICT(pharmacy_id,skey) DO UPDATE SET svalue=excluded.svalue', pharmacyId, 'delivery_config', JSON.stringify(out)); return dlvConfig(pharmacyId);
}
export const utc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
// Rappels des livraisons programmées (client, pharmacie, chauffeur) : une heure avant.
export function remindScheduled(notify) {
  const cutoff = utc(new Date(Date.now() + 60 * 60000));
  for (const d of all("SELECT * FROM deliveries WHERE mode='scheduled' AND reminder_sent=0 AND scheduled_at IS NOT NULL AND scheduled_at<=? AND status IN ('issued','received')", cutoff)) {
    run('UPDATE deliveries SET reminder_sent=1 WHERE id=?', d.id); const at = d.scheduled_at.slice(0, 16).replace('T', ' ') + ' (UTC)';
    const cu = get('SELECT user_id FROM customers WHERE id=?', d.customer_id)?.user_id, du = d.driver_id ? get('SELECT user_id FROM drivers WHERE id=?', d.driver_id)?.user_id : null;
    if (cu) notify({ pharmacyId: d.pharmacy_id, userId: cu, kind: 'delivery', title: `Rappel : livraison ${d.number} programmée à ${at}`, link: `#/portal?tab=deliveries&id=${d.id}` });
    if (du) notify({ pharmacyId: d.pharmacy_id, userId: du, kind: 'delivery', title: `Rappel : course ${d.number} programmée à ${at}`, link: `#/driver?id=${d.id}` });
    notify({ pharmacyId: d.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Rappel : livraison ${d.number} programmée à ${at}`, link: `#/deliveries?id=${d.id}` });
  }
}
