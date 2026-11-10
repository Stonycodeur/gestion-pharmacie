// Prévisions avancées par produit : lissage exponentiel de Holt amorti (tendance) sur les ventes hebdomadaires + saisonnalité par jour de semaine,
// stock de sécurité (service 95 %), point de commande, quantité suggérée, date de rupture, classification ABC, risque de péremption (FEFO).
import { all, get, getSetting } from './db.js';
import { todaySql, addDays } from './util.js';

const Z = 1.65, HIST = 120, WEEKS = 12;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
// Holt amorti : retourne la prévision hebdomadaire des `h` prochaines semaines (jamais négative)
export function holt(series, h = 5, a = 0.4, b = 0.2, phi = 0.9) {
  if (!series.length) return Array(h).fill(0); let l = series[0], t = series.length > 1 ? series[1] - series[0] : 0;
  for (let i = 1; i < series.length; i++) { const pl = l; l = a * series[i] + (1 - a) * (pl + phi * t); t = b * (l - pl) + (1 - b) * phi * t; }
  const out = []; let damp = 0; for (let k = 1; k <= h; k++) { damp += phi ** k; out.push(Math.max(0, l + damp * t)); } return out;
}
export function analyse(ph, { days = 30 } = {}) {
  const today = todaySql(), from = addDays(today, -HIST + 1).slice(0, 10);
  const rows = all(`SELECT l.product_id pid, date(s.created_at) d, SUM(l.qty - l.qty_refunded) q, SUM(l.line_total * (l.qty - l.qty_refunded) / l.qty) rev FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.pharmacy_id=? AND date(s.created_at) >= ? GROUP BY l.product_id, date(s.created_at)`, ph, from);
  const byP = new Map(); for (const r of rows) { if (!byP.has(r.pid)) byP.set(r.pid, new Map()); byP.get(r.pid).set(r.d, { q: r.q, rev: r.rev }); }
  const prods = all("SELECT id,sku,name,min_stock,max_stock,purchase_price,sale_price FROM products WHERE status='active'");
  const stock = new Map(all(`SELECT b.product_id pid, SUM(s.qty_available) q FROM stock_levels s JOIN batches b ON b.id=s.batch_id WHERE s.pharmacy_id=? AND b.status='ok' AND b.exp_date >= ? GROUP BY b.product_id`, ph, today).map((r) => [r.pid, r.q]));
  const onOrder = new Map(all("SELECT l.product_id pid, SUM(l.qty_ordered - l.qty_received) q FROM purchase_order_lines l JOIN purchase_orders o ON o.id=l.po_id WHERE o.pharmacy_id=? AND o.status IN ('sent','partial') GROUP BY l.product_id", ph).map((r) => [r.pid, r.q]));
  const lead = Math.max(1, Number(getSetting(ph, 'default_lead_days', 0)) || mean(all("SELECT lead_days v FROM suppliers WHERE status='active'").map((x) => x.v)) || 2); const cover = Number(getSetting(ph, 'cover_days', 14)) || 14;
  const dayKeys = Array.from({ length: HIST }, (_, i) => addDays(from, i).slice(0, 10)); const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
  const batches = all(`SELECT b.product_id pid, b.exp_date, s.qty_available q, COALESCE(NULLIF(b.unit_cost,0),p.purchase_price) cost, b.batch_no, b.id bid FROM stock_levels s JOIN batches b ON b.id=s.batch_id JOIN products p ON p.id=b.product_id WHERE s.pharmacy_id=? AND s.qty_available > 0 AND b.status='ok' AND b.exp_date >= ? ORDER BY b.exp_date`, ph, today);
  const bBy = new Map(); for (const b of batches) { if (!bBy.has(b.pid)) bBy.set(b.pid, []); bBy.get(b.pid).push(b); }
  const items = []; const horizon = Array.from({ length: days }, (_, i) => addDays(today, i + 1).slice(0, 10));
  for (const p of prods) {
    const m = byP.get(p.id) || new Map(); const daily = dayKeys.map((d) => m.get(d)?.q || 0); const total = daily.reduce((a, b) => a + b, 0);
    const onHand = stock.get(p.id) || 0; if (!total && !onHand) continue;
    const weekly = Array.from({ length: WEEKS }, (_, w) => daily.slice(HIST - (WEEKS - w) * 7, HIST - (WEEKS - w - 1) * 7).reduce((a, b) => a + b, 0));
    const wf = holt(weekly, Math.ceil(days / 7) + 2); const last56 = daily.slice(-56), mu = mean(last56) || 0.0001;
    const f = Array(7).fill(0), c = Array(7).fill(0); dayKeys.slice(-56).forEach((d, i) => { f[dow(d)] += last56[i]; c[dow(d)]++; }); const fac = f.map((x, i) => (x / (c[i] || 1)) / mu); // moyenne = 1
    const factor = (d) => (total >= 28 ? Math.min(2.5, Math.max(0.2, fac[dow(d)] || 1)) : 1);
    const dayRate = (i) => (wf[Math.floor(i / 7)] / 7) * factor(horizon[i]); // prévision du jour i (0 = demain)
    const fc = horizon.reduce((a, _, i) => a + dayRate(i), 0); const avg28 = mean(daily.slice(-28)), avg90 = mean(daily.slice(-90)); const rate = Math.max(wf[0] / 7, 0);
    const sigma = std(daily.slice(-90)); const safety = Math.ceil(Z * sigma * Math.sqrt(lead)); const rop = Math.ceil(rate * lead + safety); const need = rate * (lead + cover) + safety; const incoming = onOrder.get(p.id) || 0;
    const suggested = rate > 0 || onHand < p.min_stock ? Math.max(0, Math.ceil(Math.max(need, p.min_stock) - onHand - incoming)) : 0;
    let left = onHand, out = null; for (let i = 0; i < 365 && left > 0 && rate > 0; i++) { left -= i < days ? dayRate(i) : rate; if (left <= 0) out = addDays(today, i + 1).slice(0, 10); }
    // risque de péremption (FEFO) : quantité qui ne sera pas écoulée avant la date limite de chaque lot, au rythme prévu
    let cum = 0, riskQty = 0, riskVal = 0; for (const b of bBy.get(p.id) || []) { cum += b.q; const dl = Math.max(0, Math.floor((new Date(b.exp_date + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 864e5)); const demand = rate * dl; const at = Math.max(0, Math.min(b.q, cum - demand)); if (at > 0.5) { riskQty += Math.round(at); riskVal += Math.round(at) * b.cost; } }
    const prev4 = weekly.slice(-8, -4), last4 = weekly.slice(-4); const trend = mean(prev4) > 0 ? Math.round((mean(last4) / mean(prev4) - 1) * 100) : null;
    const revenue = [...m.values()].reduce((a, x) => a + x.rev, 0);
    items.push({ product_id: p.id, sku: p.sku, name: p.name, on_hand: onHand, on_order: incoming, avg_daily: Math.round(avg28 * 100) / 100, avg_daily_90: Math.round(avg90 * 100) / 100, forecast_qty: Math.round(fc), trend_pct: trend, days_left: rate > 0 ? Math.round((onHand / rate) * 10) / 10 : null, stockout: out, safety, reorder_point: rop, suggested, suggested_value: suggested * p.purchase_price, min_stock: p.min_stock, expiry_risk_qty: riskQty, expiry_risk_value: riskVal, revenue: Math.round(revenue), lead_days: Math.round(lead * 10) / 10, below_rop: onHand + incoming <= rop && (rate > 0), overstock: rate > 0 ? onHand > rate * 90 && onHand > p.min_stock * 2 : onHand > p.min_stock * 3 && p.min_stock > 0 });
  }
  const tot = items.reduce((a, x) => a + x.revenue, 0) || 1; let cumRev = 0; for (const x of [...items].sort((a, b) => b.revenue - a.revenue)) { cumRev += x.revenue; x.abc = x.revenue === 0 ? 'C' : cumRev / tot <= 0.8 ? 'A' : cumRev / tot <= 0.95 ? 'B' : 'C'; x.share = Math.round((x.revenue / tot) * 1000) / 10; }
  return { items, lead, cover, days, generated: today };
}
