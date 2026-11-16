import { router, audit, can, need } from '../http.js';
import { get, all } from '../db.js';
import { bad, toCsv, todaySql, addDays } from '../util.js';
import { computeAlerts } from '../alerts.js';
import { pdfTable, xlsx, toColumns } from '../export.js';

const range = (q) => { const from = q.from || addDays(todaySql(), -29).slice(0, 10), to = q.to || todaySql(); if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw bad('VALIDATION', 'Dates invalides'); return { from, to: to + ' 23:59:59' }; };
// Chiffre d'affaires net = ventes − remboursements ; marge = HT net − coût des lots vendus (net des retours)
function salesRows(ph, from, to, group) {
  const fmt = group === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const sales = all(`SELECT strftime('${fmt}', s.created_at) period, COUNT(*) tickets, SUM(s.total) gross, SUM(s.discount) discount, SUM(s.tax_total) tax FROM sales s WHERE s.pharmacy_id=? AND s.created_at BETWEEN ? AND ? GROUP BY period`, ph, from, to);
  const ref = all(`SELECT strftime('${fmt}', r.created_at) period, SUM(r.amount) refunded FROM refunds r JOIN sales s ON s.id=r.sale_id WHERE s.pharmacy_id=? AND r.created_at BETWEEN ? AND ? GROUP BY period`, ph, from, to);
  const cost = all(`SELECT strftime('${fmt}', s.created_at) period, SUM((l.qty - l.qty_refunded) * l.unit_cost) cost, SUM(l.line_total * (l.qty - l.qty_refunded) / l.qty / (1 + l.tax_rate / 100.0)) net_ht FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.pharmacy_id=? AND s.created_at BETWEEN ? AND ? GROUP BY period`, ph, from, to);
  const m = new Map();
  for (const s of sales) m.set(s.period, { period: s.period, tickets: s.tickets, gross: s.gross, discount: s.discount, tax: s.tax, refunded: 0, cost: 0, net: s.gross });
  for (const r of ref) { const x = m.get(r.period) || { period: r.period, tickets: 0, gross: 0, discount: 0, tax: 0, refunded: 0, cost: 0, net: 0 }; x.refunded = r.refunded; x.net = x.gross - r.refunded; m.set(r.period, x); }
  for (const c of cost) { const x = m.get(c.period); if (x) { x.cost = c.cost || 0; x.margin = Math.round(c.net_ht - x.cost); } }
  return [...m.values()].sort((a, b) => a.period.localeCompare(b.period));
}
const TITLES = { ventes: 'Ventes', paiements: 'Paiements', top_produits: 'Meilleures ventes', valorisation_stock: 'Valorisation du stock', peremptions: 'Péremptions', pertes: 'Pertes et casse', caisses: 'Sessions de caisse', taxes: 'TVA collectée', z_report: 'Rapport Z' };
// Export CSV / Excel / PDF — journalisé (donnée sensible), réservé à reports.export
function sendCsv(ctx, name, rows, cols) {
  need(ctx, 'reports.export'); const fmt = ctx.query.format; audit(ctx, 'report.export', 'report', name, undefined, { rows: rows.length, format: fmt, query: ctx.query });
  const dec = get('SELECT currency_decimals d FROM pharmacies WHERE id=?', ctx.ph).d, c = toColumns(cols);
  if (fmt === 'xlsx') { ctx.res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"` }); return ctx.res.end(xlsx({ sheet: TITLES[name] || name, columns: c, rows, dec })); }
  if (fmt === 'pdf') {
    const ph = get('SELECT name,currency FROM pharmacies WHERE id=?', ctx.ph);
    ctx.res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"` });
    return ctx.res.end(pdfTable({ title: `${TITLES[name] || name} — ${ph.name}`, subtitle: `Édité le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · montants en ${ph.currency}${ctx.query.from ? ` · du ${ctx.query.from} au ${ctx.query.to || ''}` : ''}`, columns: c, rows, dec, footer: `${rows.length} ligne(s)` }));
  }
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` }); ctx.res.end(toCsv(rows, cols));
}
export { sendCsv };
const out = (ctx, name, rows, cols) => (['csv', 'xlsx', 'pdf'].includes(ctx.query.format) ? sendCsv(ctx, name, rows, cols) : { data: rows });
router.get('/reports/sales', { perm: 'reports.view' }, (ctx) => { const { from, to } = range(ctx.query); const r = salesRows(ctx.ph, from, to, ctx.query.group); return out(ctx, 'ventes', r, ['period', 'tickets', 'gross', 'discount', 'tax', 'refunded', 'net', 'cost', 'margin']); });
router.get('/reports/payments', { perm: 'reports.view' }, (ctx) => { const { from, to } = range(ctx.query);
  const r = all(`SELECT method, SUM(amount) total, COUNT(*) n FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.pharmacy_id=? AND p.created_at BETWEEN ? AND ? GROUP BY method`, ctx.ph, from, to); return out(ctx, 'paiements', r, ['method', 'total', 'n']); });
router.get('/reports/top-products', { perm: 'reports.view' }, (ctx) => { const { from, to } = range(ctx.query);
  const r = all(`SELECT p.sku, p.name, SUM(l.qty - l.qty_refunded) qty, SUM(l.line_total * (l.qty - l.qty_refunded) / l.qty) revenue FROM sale_lines l JOIN sales s ON s.id=l.sale_id JOIN products p ON p.id=l.product_id WHERE s.pharmacy_id=? AND s.created_at BETWEEN ? AND ? GROUP BY p.id ORDER BY revenue DESC LIMIT 50`, ctx.ph, from, to); return out(ctx, 'top_produits', r.map((x) => ({ ...x, revenue: Math.round(x.revenue) })), ['sku', 'name', 'qty', 'revenue']); });
router.get('/reports/stock-valuation', { perm: 'reports.view' }, (ctx) => { // méthode paramétrable : coût du lot (défaut), prix d'achat courant, prix de vente
  const m = ['cost', 'purchase', 'sale'].includes(ctx.query.method) ? ctx.query.method : 'cost'; const expr = m === 'sale' ? 'p.sale_price' : m === 'purchase' ? 'p.purchase_price' : 'COALESCE(NULLIF(b.unit_cost,0), p.purchase_price)';
  const r = all(`SELECT p.sku, p.name, SUM(s.qty_available + s.qty_quarantine + s.qty_damaged) qty, SUM((s.qty_available + s.qty_quarantine) * ${expr}) value FROM stock_levels s JOIN batches b ON b.id=s.batch_id JOIN products p ON p.id=b.product_id WHERE s.pharmacy_id=? GROUP BY p.id HAVING qty > 0 ORDER BY value DESC`, ctx.ph);
  return ['csv', 'xlsx', 'pdf'].includes(ctx.query.format) ? sendCsv(ctx, 'valorisation_stock', r, ['sku', 'name', 'qty', 'value']) : { method: m, total: r.reduce((a, x) => a + x.value, 0), data: r }; });
router.get('/reports/expiry', { perm: 'reports.view' }, (ctx) => { const a = computeAlerts(ctx.ph); return out(ctx, 'peremptions', [...a.expired.map((x) => ({ ...x, state: 'périmé' })), ...a.expiring.map((x) => ({ ...x, state: 'proche' }))], ['name', 'batch_no', 'exp_date', 'qty', 'state']); });
router.get('/reports/losses', { perm: 'reports.view' }, (ctx) => { const { from, to } = range(ctx.query);
  const r = all(`SELECT m.movement_type type, p.name, b.batch_no, -m.qty qty, -m.qty * COALESCE(NULLIF(b.unit_cost,0),p.purchase_price) value, m.reason, m.created_at FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN batches b ON b.id=m.batch_id WHERE m.pharmacy_id=? AND m.movement_type IN ('loss','breakage','expiry_writeoff','donation','inventory_adjust') AND m.qty < 0 AND m.created_at BETWEEN ? AND ? ORDER BY m.id DESC`, ctx.ph, from, to); return out(ctx, 'pertes', r, ['created_at', 'type', 'name', 'batch_no', 'qty', 'value', 'reason']); });
router.get('/reports/cash', { perm: 'reports.view' }, (ctx) => { const { from, to } = range(ctx.query);
  const r = all(`SELECT cs.id, cs.opened_at, cs.closed_at, u.name cashier, rg.name register, cs.opening_float, cs.expected_cash, cs.counted_cash, cs.difference, cs.difference_reason FROM cash_sessions cs JOIN users u ON u.id=cs.user_id JOIN cash_registers rg ON rg.id=cs.register_id WHERE cs.pharmacy_id=? AND cs.opened_at BETWEEN ? AND ? ORDER BY cs.id DESC`, ctx.ph, from, to); return out(ctx, 'caisses', r, ['id', 'opened_at', 'closed_at', 'cashier', 'register', 'opening_float', 'expected_cash', 'counted_cash', 'difference', 'difference_reason']); });
router.get('/reports/tax', { perm: 'accounting.view' }, (ctx) => { const { from, to } = range(ctx.query);
  const r = all(`SELECT l.tax_rate, SUM(l.line_total * (l.qty - l.qty_refunded) / l.qty) ttc FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.pharmacy_id=? AND s.created_at BETWEEN ? AND ? GROUP BY l.tax_rate`, ctx.ph, from, to)
    .map((x) => { const ttc = Math.round(x.ttc), ht = Math.round(ttc / (1 + x.tax_rate / 100)); return { tax_rate: x.tax_rate, ttc, ht, tax: ttc - ht }; }); return out(ctx, 'taxes', r, ['tax_rate', 'ht', 'tax', 'ttc']); });

// Analyse : indicateurs avec comparaison à la période précédente, courbe, heures de pointe, jours, paiements, meilleures ventes
router.get('/reports/analytics', { perm: 'reports.view' }, (ctx) => {
  const { from, to } = range(ctx.query), ph = ctx.ph, group = ctx.query.group === 'month' ? 'month' : 'day';
  const d0 = new Date(from + 'T00:00:00Z'), d1 = new Date(to.slice(0, 10) + 'T00:00:00Z'), days = Math.max(1, Math.round((d1 - d0) / 864e5) + 1);
  const pTo = addDays(from, -1).slice(0, 10), pFrom = addDays(from, -days).slice(0, 10);
  const kp = (a, b) => { const r = salesRows(ph, a, b, 'day'); const sum = (k) => r.reduce((x, y) => x + (y[k] || 0), 0); const net = sum('net'), tickets = sum('tickets'), margin = sum('margin');
    return { net, tickets, margin, refunded: sum('refunded'), discount: sum('discount'), basket: tickets ? Math.round((net) / tickets) : 0, days_active: r.length }; };
  const cur = kp(from, to), prev = kp(pFrom, pTo + ' 23:59:59');
  const series = salesRows(ph, from, to, group), seriesPrev = salesRows(ph, pFrom, pTo + ' 23:59:59', group);
  const hours = all(`SELECT strftime('%H', s.created_at) h, COUNT(*) tickets, SUM(s.total) total FROM sales s WHERE s.pharmacy_id=? AND s.created_at BETWEEN ? AND ? GROUP BY h ORDER BY h`, ph, from, to).map((x) => ({ hour: Number(x.h), tickets: x.tickets, total: x.total || 0 }));
  const weekdays = all(`SELECT strftime('%w', s.created_at) w, COUNT(*) tickets, SUM(s.total) total FROM sales s WHERE s.pharmacy_id=? AND s.created_at BETWEEN ? AND ? GROUP BY w ORDER BY w`, ph, from, to).map((x) => ({ day: Number(x.w), tickets: x.tickets, total: x.total || 0 }));
  const payments = all(`SELECT p.method, SUM(p.amount) total, COUNT(*) n FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.pharmacy_id=? AND p.created_at BETWEEN ? AND ? GROUP BY p.method ORDER BY total DESC`, ph, from, to);
  const top = all(`SELECT p.name, SUM(l.qty - l.qty_refunded) qty, SUM(l.line_total * (l.qty - l.qty_refunded) / l.qty) revenue FROM sale_lines l JOIN sales s ON s.id=l.sale_id JOIN products p ON p.id=l.product_id WHERE s.pharmacy_id=? AND s.created_at BETWEEN ? AND ? GROUP BY p.id ORDER BY revenue DESC LIMIT 8`, ph, from, to).map((x) => ({ ...x, revenue: Math.round(x.revenue) }));
  return { from, to: to.slice(0, 10), days, previous: { from: pFrom, to: pTo }, current: cur, prev, series, series_prev: seriesPrev, hours, weekdays, payments, top };
});

router.get('/dashboard', { perm: 'dashboard.view' }, (ctx) => {
  const ph = ctx.ph, today = todaySql(), month = today.slice(0, 7) + '-01';
  const sum = (from) => get(`SELECT COALESCE(SUM(total),0) total, COUNT(*) n FROM sales WHERE pharmacy_id=? AND created_at >= ?`, ph, from);
  const ref = (from) => get('SELECT COALESCE(SUM(r.amount),0) t FROM refunds r JOIN sales s ON s.id=r.sale_id WHERE s.pharmacy_id=? AND r.created_at >= ?', ph, from).t;
  const a = computeAlerts(ph); const canSales = can(ctx.user, 'sales.view');
  const d = { alerts: { out: a.out.length, critical: a.critical.length, low: a.low.length, expiring: a.expiring.length, expired: a.expired.length, blocked: a.blocked.length } };
  if (canSales) {
    const t = sum(today), m = sum(month);
    Object.assign(d, { today: { total: t.total - ref(today), tickets: t.n }, month: { total: m.total - ref(month), tickets: m.n },
      series: salesRows(ph, addDays(today, -13).slice(0, 10), today + ' 23:59:59', 'day').map((x) => ({ period: x.period, net: x.net })),
      top: all(`SELECT p.name, SUM(l.qty - l.qty_refunded) qty FROM sale_lines l JOIN sales s ON s.id=l.sale_id JOIN products p ON p.id=l.product_id WHERE s.pharmacy_id=? AND s.created_at >= ? GROUP BY p.id ORDER BY qty DESC LIMIT 5`, ph, addDays(today, -29).slice(0, 10)) });
  }
  if (can(ctx.user, 'prescriptions.view')) d.prescriptions_to_verify = get("SELECT COUNT(*) n FROM prescriptions WHERE pharmacy_id=? AND status IN ('received','to_verify')", ph).n;
  if (can(ctx.user, 'orders.view')) d.orders_open = get("SELECT COUNT(*) n FROM customer_orders WHERE pharmacy_id=? AND status IN ('pending','confirmed','preparing','ready')", ph).n;
  return d;
});
