import { router, audit } from '../http.js';
import { get, all, tx, nextNumber, insert } from '../db.js';
import { bad } from '../util.js';
import { analyse } from '../forecast.js';
import { sendCsv } from './reports.js';

const days = (q) => Math.min(90, Math.max(7, Number(q.days) || 30));
router.get('/forecast/overview', { perm: 'forecast.view' }, (ctx) => {
  const a = analyse(ctx.ph, { days: days(ctx.query) }); const it = a.items;
  const soon = it.filter((x) => x.stockout && x.days_left != null && x.days_left <= a.lead + 2 && x.on_hand + x.on_order < x.forecast_qty);
  return { lead_days: a.lead, cover_days: a.cover, horizon: a.days, products: it.length,
    to_order: { count: it.filter((x) => x.suggested > 0).length, value: it.reduce((s, x) => s + x.suggested_value, 0) }, stockout_risk: { count: soon.length, items: soon.sort((x, y) => x.days_left - y.days_left).slice(0, 8).map((x) => ({ name: x.name, days_left: x.days_left, stockout: x.stockout })) },
    expiry_risk: { count: it.filter((x) => x.expiry_risk_qty > 0).length, value: it.reduce((s, x) => s + x.expiry_risk_value, 0) }, overstock: { count: it.filter((x) => x.overstock).length },
    abc: { A: it.filter((x) => x.abc === 'A').length, B: it.filter((x) => x.abc === 'B').length, C: it.filter((x) => x.abc === 'C').length } };
});
router.get('/forecast/products', { perm: 'forecast.view' }, (ctx) => {
  const a = analyse(ctx.ph, { days: days(ctx.query) }); let it = a.items; const q = String(ctx.query.q || '').toLowerCase(), f = ctx.query.filter;
  if (q) it = it.filter((x) => x.name.toLowerCase().includes(q) || x.sku.toLowerCase().includes(q));
  if (f === 'reorder') it = it.filter((x) => x.suggested > 0); else if (f === 'stockout') it = it.filter((x) => x.stockout && x.days_left <= a.lead + 7); else if (f === 'expiry') it = it.filter((x) => x.expiry_risk_qty > 0); else if (f === 'overstock') it = it.filter((x) => x.overstock); else if (['A', 'B', 'C'].includes(f)) it = it.filter((x) => x.abc === f);
  const key = ['suggested_value', 'days_left', 'forecast_qty', 'revenue', 'expiry_risk_value', 'name'].includes(ctx.query.sort) ? ctx.query.sort : 'suggested_value';
  it = [...it].sort((x, y) => (key === 'name' ? x.name.localeCompare(y.name) : key === 'days_left' ? (x.days_left ?? 1e9) - (y.days_left ?? 1e9) : y[key] - x[key]));
  if (['csv', 'xlsx', 'pdf'].includes(ctx.query.format)) return sendCsv(ctx, 'previsions', it.map((x) => ({ sku: x.sku, name: x.name, on_hand: x.on_hand, avg_daily: x.avg_daily, forecast_qty: x.forecast_qty, days_left: x.days_left ?? '', stockout: x.stockout ?? '', suggested: x.suggested, abc: x.abc })), ['sku', 'name', 'on_hand', 'avg_daily', 'forecast_qty', 'days_left', 'stockout', 'suggested', 'abc']);
  return { lead_days: a.lead, horizon: a.days, total: it.length, data: it.slice(0, 500) };
});
// Transforme les quantités suggérées en demande de prix (brouillon) pour les fournisseurs choisis
router.post('/forecast/create-rfq', { perm: 'rfq.manage' }, (ctx) => tx(() => {
  const sids = [...new Set((ctx.body.supplier_ids || []).map(Number))]; if (!sids.length) throw bad('VALIDATION', 'Choisissez au moins un fournisseur');
  const only = Array.isArray(ctx.body.product_ids) ? new Set(ctx.body.product_ids.map(Number)) : null; const a = analyse(ctx.ph, {}); const lines = a.items.filter((x) => x.suggested > 0 && (!only || only.has(x.product_id))).slice(0, 200);
  if (!lines.length) throw bad('NOTHING', 'Aucune quantité à commander');
  const number = nextNumber(ctx.ph, 'rfq', 'DP'); const id = insert('INSERT INTO rfqs(pharmacy_id,number,title,notes,created_by) VALUES (?,?,?,?,?)', ctx.ph, number, 'Réassort suggéré par les prévisions', `Généré le ${a.generated}`, ctx.user.id);
  for (const l of lines) insert('INSERT INTO rfq_lines(rfq_id,product_id,qty) VALUES (?,?,?)', id, l.product_id, l.suggested);
  for (const s of sids) { if (!get("SELECT 1 FROM suppliers WHERE id=? AND status='active'", s)) throw bad('VALIDATION', 'Fournisseur inconnu'); insert('INSERT INTO rfq_suppliers(rfq_id,supplier_id) VALUES (?,?)', id, s); }
  audit(ctx, 'rfq.create_from_forecast', 'rfq', id, undefined, { lines: lines.length }); return { id, number, lines: lines.length };
}));
