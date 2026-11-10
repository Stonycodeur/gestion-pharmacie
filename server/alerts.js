// Alertes : seuils, ruptures, surstock, péremption. Calcul à la demande + notifications dédupliquées.
import { all, get, getSetting } from './db.js';
import { stockSummarySql, productStatus } from './stock.js';
import { notify } from './http.js';
import { todaySql, addDays } from './util.js';

export function computeAlerts(ph) {
  const warnDays = getSetting(ph, 'expiry_warning_days', 90);
  const today = todaySql();
  const limit = addDays(today, warnDays).slice(0, 10);
  const stock = all(`${stockSummarySql} WHERE p.status='active' GROUP BY p.id`, ph).map((r) => ({ ...r, state: productStatus(r) }));
  const expiring = all(`SELECT b.id batch_id, b.batch_no, b.exp_date, p.id product_id, p.name, s.qty_available qty, CAST(julianday(b.exp_date) - julianday(date('now')) AS INTEGER) days_left
    FROM stock_levels s JOIN batches b ON b.id=s.batch_id JOIN products p ON p.id=b.product_id
    WHERE s.pharmacy_id=? AND s.qty_available > 0 AND b.exp_date >= ? AND b.exp_date <= ? ORDER BY b.exp_date`, ph, today, limit);
  const expired = all(`SELECT b.id batch_id, b.batch_no, b.exp_date, p.id product_id, p.name, s.qty_available qty
    FROM stock_levels s JOIN batches b ON b.id=s.batch_id JOIN products p ON p.id=b.product_id
    WHERE s.pharmacy_id=? AND s.qty_available > 0 AND b.exp_date < ? ORDER BY b.exp_date`, ph, today);
  const blocked = all(`SELECT b.id batch_id, b.batch_no, b.status, p.name, s.qty_available qty FROM stock_levels s JOIN batches b ON b.id=s.batch_id JOIN products p ON p.id=b.product_id
    WHERE s.pharmacy_id=? AND s.qty_available > 0 AND b.status != 'ok'`, ph);
  return {
    out: stock.filter((s) => s.state === 'out' && s.min_stock > 0), critical: stock.filter((s) => s.state === 'critical'),
    low: stock.filter((s) => s.state === 'low'), over: stock.filter((s) => s.state === 'over'), expiring, expired, blocked, warnDays,
  };
}

export function refreshNotifications(ph) {
  const a = computeAlerts(ph); const d = todaySql();
  for (const s of a.out) notify({ pharmacyId: ph, audience: 'stock', kind: 'stock_out', title: `Rupture : ${s.name}`, dedupe: `out:${ph}:${s.id}:${d}` });
  for (const s of a.critical) notify({ pharmacyId: ph, audience: 'stock', kind: 'stock_critical', title: `Stock critique : ${s.name} (${s.sellable})`, dedupe: `crit:${ph}:${s.id}:${d}` });
  for (const s of a.low) notify({ pharmacyId: ph, audience: 'stock', kind: 'stock_low', title: `Stock bas : ${s.name} (${s.sellable}/${s.min_stock})`, dedupe: `low:${ph}:${s.id}:${d}` });
  for (const e of a.expiring) notify({ pharmacyId: ph, audience: 'stock', kind: 'expiring', title: `Péremption proche : ${e.name} lot ${e.batch_no} (${e.days_left} j)`, dedupe: `exp:${ph}:${e.batch_id}:${d.slice(0, 7)}` });
  for (const e of a.expired) notify({ pharmacyId: ph, audience: 'stock', kind: 'expired', title: `Produit périmé en stock : ${e.name} lot ${e.batch_no}`, dedupe: `expd:${ph}:${e.batch_id}:${d}` });
  return a;
}
export const refreshAll = () => { for (const p of all("SELECT id FROM pharmacies WHERE status='active'")) refreshNotifications(p.id); };
