// Moteur de stock : niveaux par lot, mouvements horodatés, FEFO, règles de vendabilité.
import { get, all, run, insert, getSetting } from './db.js';
import { conflict, bad, todaySql, addDays } from './util.js';

const BUCKETS = { available: 'qty_available', quarantine: 'qty_quarantine', damaged: 'qty_damaged' };

export function ensureLevel(ph, batchId) {
  run('INSERT INTO stock_levels(pharmacy_id,batch_id) VALUES (?,?) ON CONFLICT(pharmacy_id,batch_id) DO NOTHING', ph, batchId);
}
// Applique un delta signé à un bucket et journalise. Les CHECK SQL empêchent tout stock négatif.
export function applyMovement({ ph, batchId, productId, type, qty, bucket = 'available', reason = null, refType = null, refId = null, userId = null }) {
  const col = BUCKETS[bucket];
  if (!col) throw bad('VALIDATION', 'Compartiment de stock invalide');
  if (!Number.isInteger(qty) || qty === 0) throw bad('VALIDATION', 'Quantité invalide');
  ensureLevel(ph, batchId);
  run(`UPDATE stock_levels SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE pharmacy_id=? AND batch_id=?`, qty, ph, batchId);
  return insert('INSERT INTO stock_movements(pharmacy_id,batch_id,product_id,movement_type,qty,bucket,reason,ref_type,ref_id,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ph, batchId, productId, type, qty, bucket, reason, refType, refId, userId);
}
export function reserve(ph, batchId, delta) {
  ensureLevel(ph, batchId);
  run("UPDATE stock_levels SET qty_reserved = qty_reserved + ?, updated_at = datetime('now') WHERE pharmacy_id=? AND batch_id=?", delta, ph, batchId);
}

// Un lot est vendable s'il est « ok », non périmé (avec marge paramétrable) et en stock disponible non réservé.
export function sellableReason(batch, ph) {
  const minDays = getSetting(ph, 'min_days_before_expiry_sale', 0);
  if (batch.status !== 'ok') return { code: 'BATCH_' + batch.status.toUpperCase(), msg: `Lot ${batch.batch_no} : ${batch.status === 'recalled' ? 'rappelé' : batch.status === 'quarantine' ? 'en quarantaine' : 'bloqué'}` };
  if (batch.exp_date < addDays(todaySql(), minDays).slice(0, 10)) return { code: 'BATCH_EXPIRED', msg: `Lot ${batch.batch_no} périmé (${batch.exp_date})` };
  return null;
}

// FEFO (défaut) ou FIFO : renvoie [{batch, qty}] couvrant la quantité demandée, sinon 409 détaillé.
export function allocate(ph, productId, qty, { reservedAlso = false, onlyBatches = null } = {}) {
  const method = getSetting(ph, 'stock_method', 'FEFO');
  const order = method === 'FIFO' ? 'b.created_at ASC, b.id ASC' : 'b.exp_date ASC, b.id ASC';
  const rows = all(`SELECT b.*, s.qty_available, s.qty_reserved FROM batches b JOIN stock_levels s ON s.batch_id=b.id AND s.pharmacy_id=?
    WHERE b.product_id=? AND s.qty_available > 0 ORDER BY ${order}`, ph, productId);
  let need = qty; const out = []; let blocked = 0;
  for (const b of rows) {
    if (onlyBatches && !onlyBatches.includes(b.id)) continue;
    if (sellableReason(b, ph)) { blocked += b.qty_available; continue; }
    const free = reservedAlso ? b.qty_available : b.qty_available - b.qty_reserved;
    if (free <= 0) continue;
    const take = Math.min(free, need);
    out.push({ batch: b, qty: take }); need -= take;
    if (need === 0) break;
  }
  if (need > 0) {
    const p = get('SELECT name FROM products WHERE id=?', productId);
    throw conflict('INSUFFICIENT_STOCK', `Stock vendable insuffisant pour « ${p?.name} » (manque ${need}${blocked ? `, ${blocked} unité(s) bloquée(s)/périmée(s)` : ''})`, { product_id: productId, missing: need, blocked });
  }
  return out;
}

export const stockSummarySql = `
SELECT p.id, p.sku, p.name, p.dci, p.dosage, p.form, p.barcode, p.rx_status, p.min_stock, p.critical_stock, p.max_stock, p.sale_price, p.status,
  COALESCE(SUM(CASE WHEN b.status='ok' AND b.exp_date >= date('now') THEN s.qty_available ELSE 0 END),0) AS sellable,
  COALESCE(SUM(s.qty_available),0) AS available, COALESCE(SUM(s.qty_reserved),0) AS reserved,
  COALESCE(SUM(s.qty_quarantine),0) AS quarantine, COALESCE(SUM(s.qty_damaged),0) AS damaged,
  MIN(CASE WHEN s.qty_available > 0 THEN b.exp_date END) AS next_expiry,
  COUNT(CASE WHEN s.qty_available > 0 THEN 1 END) AS batches
FROM products p
LEFT JOIN batches b ON b.product_id = p.id
LEFT JOIN stock_levels s ON s.batch_id = b.id AND s.pharmacy_id = ?`;

export function productStatus(row) {
  if (row.sellable <= 0) return 'out';
  if (row.critical_stock > 0 && row.sellable <= row.critical_stock) return 'critical';
  if (row.min_stock > 0 && row.sellable <= row.min_stock) return 'low';
  if (row.max_stock > 0 && row.available > row.max_stock) return 'over';
  return 'ok';
}
