import { router, audit, paged, can, need, notify } from '../http.js';
import { get, all, run, insert, tx, nextNumber, getSetting } from '../db.js';
import { HttpError, bad, conflict, notFound, str, int, date, oneOf, arr, paging, todaySql, toCsv } from '../util.js';
import { applyMovement, stockSummarySql, productStatus, ensureLevel } from '../stock.js';
import { computeAlerts, refreshNotifications } from '../alerts.js';

// ---------- niveaux de stock ----------
router.get('/stock', { perm: 'stock.view' }, (ctx) => {
  const { q, state, category_id } = ctx.query; const { page, limit, offset } = paging(ctx.query);
  const w = ["p.status='active'"], p = [ctx.ph];
  if (q) { w.push('(p.name LIKE ? OR p.dci LIKE ? OR p.sku LIKE ? OR p.barcode = ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`, q); }
  if (category_id) { w.push('p.category_id=?'); p.push(category_id); }
  let rows = all(`${stockSummarySql} WHERE ${w.join(' AND ')} GROUP BY p.id ORDER BY p.name`, ...p).map((r) => ({ ...r, state: productStatus(r) }));
  if (state) rows = rows.filter((r) => r.state === state);
  return { data: rows.slice(offset, offset + limit), total: rows.length, page, limit };
});
router.get('/stock/batches', { perm: 'stock.view' }, (ctx) => {
  const w = ['s.pharmacy_id=?'], p = [ctx.ph];
  if (ctx.query.product_id) { w.push('b.product_id=?'); p.push(ctx.query.product_id); }
  if (ctx.query.all !== '1') w.push('(s.qty_available + s.qty_quarantine + s.qty_damaged) > 0');
  return all(`SELECT b.id batch_id, b.batch_no, b.exp_date, b.mfg_date, b.status, b.status_reason, b.unit_cost, p.id product_id, p.name product_name, p.sku, s.location, s.qty_available, s.qty_reserved, s.qty_quarantine, s.qty_damaged,
      CAST(julianday(b.exp_date) - julianday(date('now')) AS INTEGER) days_left, sp.name supplier
    FROM stock_levels s JOIN batches b ON b.id=s.batch_id JOIN products p ON p.id=b.product_id LEFT JOIN suppliers sp ON sp.id=b.supplier_id WHERE ${w.join(' AND ')} ORDER BY b.exp_date, p.name`, ...p);
});
router.get('/stock/movements', { perm: 'stock.view' }, (ctx) => {
  const w = ['m.pharmacy_id=?'], p = [ctx.ph];
  for (const [k, c] of [['product_id', 'm.product_id'], ['batch_id', 'm.batch_id'], ['type', 'm.movement_type']]) if (ctx.query[k]) { w.push(`${c}=?`); p.push(ctx.query[k]); }
  if (ctx.query.from) { w.push('m.created_at >= ?'); p.push(ctx.query.from); }
  if (ctx.query.to) { w.push('m.created_at <= ?'); p.push(ctx.query.to + ' 23:59:59'); }
  const from = `FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN batches b ON b.id=m.batch_id LEFT JOIN users u ON u.id=m.user_id WHERE ${w.join(' AND ')}`;
  return paged(ctx, `SELECT COUNT(*) n ${from}`, `SELECT m.*, p.name product_name, b.batch_no, u.name user_name ${from} ORDER BY m.id DESC`, p);
});

// Corrections de stock : toujours motivées, horodatées, attribuées.
const ADJ_TYPES = { loss: -1, breakage: -1, expiry_writeoff: -1, donation: -1, supplier_return: -1, correction_in: 1, correction_out: -1 };
router.post('/stock/adjust', { perm: 'stock.adjust' }, (ctx) => {
  const type = oneOf(ctx.body.type, 'type', Object.keys(ADJ_TYPES), { required: true });
  const batchId = int(ctx.body.batch_id, 'lot', { required: true, min: 1 }); const qty = int(ctx.body.qty, 'quantité', { required: true, min: 1 });
  const reason = str(ctx.body.reason, 'motif', { required: true, min: 3, max: 300 });
  return tx(() => {
    const b = get('SELECT * FROM batches WHERE id=?', batchId); if (!b) throw notFound('Lot');
    ensureLevel(ctx.ph, batchId);
    const lvl = get('SELECT * FROM stock_levels WHERE pharmacy_id=? AND batch_id=?', ctx.ph, batchId);
    const sign = ADJ_TYPES[type];
    const bucket = (type === 'breakage') ? 'available' : 'available';
    if (sign < 0 && lvl.qty_available - lvl.qty_reserved < qty) throw conflict('INSUFFICIENT_STOCK', 'Stock disponible (hors réservations) insuffisant');
    const id = applyMovement({ ph: ctx.ph, batchId, productId: b.product_id, type, qty: sign * qty, bucket, reason, refType: 'adjustment', userId: ctx.user.id });
    if (type === 'breakage') applyMovement({ ph: ctx.ph, batchId, productId: b.product_id, type: 'breakage_record', qty, bucket: 'damaged', reason, refType: 'adjustment', refId: id, userId: ctx.user.id });
    audit(ctx, 'stock.adjust', 'batch', batchId, undefined, { type, qty, reason });
    return { movement_id: id };
  });
});
// Déplacement entre compartiments (ex. quarantaine → disponible après contrôle pharmacien)
router.post('/stock/move-bucket', { perm: 'stock.adjust' }, (ctx) => {
  const B = ['available', 'quarantine', 'damaged'];
  const from = oneOf(ctx.body.from, 'origine', B, { required: true }), to = oneOf(ctx.body.to, 'destination', B, { required: true });
  if (from === to) throw bad('VALIDATION', 'Origine et destination identiques');
  const batchId = int(ctx.body.batch_id, 'lot', { required: true, min: 1 }), qty = int(ctx.body.qty, 'quantité', { required: true, min: 1 });
  const reason = str(ctx.body.reason, 'motif', { required: true, min: 3, max: 300 });
  if (to === 'available' && !can(ctx.user, 'stock.block_batch')) throw new HttpError(403, 'PERMISSION_DENIED', 'Remise en stock vendable : pharmacien requis (stock.block_batch)');
  return tx(() => {
    const b = get('SELECT * FROM batches WHERE id=?', batchId); if (!b) throw notFound('Lot');
    if (to === 'available' && (b.status !== 'ok' || b.exp_date < todaySql())) throw conflict('BATCH_NOT_SELLABLE', 'Lot rappelé/bloqué/périmé : remise en stock vendable impossible');
    applyMovement({ ph: ctx.ph, batchId, productId: b.product_id, type: 'bucket_move', qty: -qty, bucket: from, reason, userId: ctx.user.id });
    applyMovement({ ph: ctx.ph, batchId, productId: b.product_id, type: 'bucket_move', qty, bucket: to, reason, userId: ctx.user.id });
    audit(ctx, 'stock.move_bucket', 'batch', batchId, undefined, { from, to, qty, reason });
    return { ok: true };
  });
});
// Blocage / rappel / quarantaine d'un lot : effet immédiat sur toutes les ventes (lot global au produit).
router.post('/batches/:id/status', { perm: 'stock.block_batch' }, (ctx) => {
  const status = oneOf(ctx.body.status, 'statut', ['ok', 'quarantine', 'recalled', 'blocked'], { required: true });
  const reason = str(ctx.body.reason, 'motif', { required: status !== 'ok', max: 300 });
  const b = get('SELECT * FROM batches WHERE id=?', ctx.params.id); if (!b) throw notFound('Lot');
  if (b.status === 'recalled' && status !== 'recalled' && !can(ctx.user, 'sales.dispense_controlled')) throw new HttpError(403, 'PERMISSION_DENIED', 'Seul un pharmacien peut lever un rappel');
  run('UPDATE batches SET status=?, status_reason=? WHERE id=?', status, reason, b.id);
  audit(ctx, 'batch.status', 'batch', b.id, { status: b.status }, { status, reason });
  if (status !== 'ok') notify({ pharmacyId: ctx.ph, audience: 'stock', kind: 'batch_' + status, title: `Lot ${b.batch_no} : ${status}`, body: reason });
  return get('SELECT * FROM batches WHERE id=?', b.id);
});
// Traçabilité ascendante (fournisseurs, réceptions) et descendante (ventes, clients) d'un lot.
router.get('/batches/:id/trace', { perm: 'stock.view' }, (ctx) => {
  const b = get('SELECT b.*, p.name product_name FROM batches b JOIN products p ON p.id=b.product_id WHERE b.id=?', ctx.params.id); if (!b) throw notFound('Lot');
  const receipts = all(`SELECT r.number, r.created_at, s.name supplier, l.qty, r.supplier_invoice_ref FROM goods_receipt_lines l JOIN goods_receipts r ON r.id=l.receipt_id JOIN suppliers s ON s.id=r.supplier_id WHERE l.batch_id=? AND r.pharmacy_id=?`, b.id, ctx.ph);
  const withCustomers = can(ctx.user, 'customers.history');
  const sales = all(`SELECT s.number, s.created_at, sl.qty, sl.qty_refunded, ${withCustomers ? 'c.name customer_name, c.phone customer_phone' : 'NULL customer_name, NULL customer_phone'} FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id LEFT JOIN customers c ON c.id=s.customer_id WHERE sl.batch_id=? AND s.pharmacy_id=? ORDER BY s.id`, b.id, ctx.ph);
  if (withCustomers) audit(ctx, 'view.batch_trace', 'batch', b.id, undefined, { sales: sales.length });
  const stock = get('SELECT qty_available, qty_reserved, qty_quarantine FROM stock_levels WHERE pharmacy_id=? AND batch_id=?', ctx.ph, b.id);
  return { batch: b, receipts, sales, stock, customers_visible: withCustomers };
});

// ---------- alertes ----------
router.get('/alerts', { perm: 'stock.view' }, (ctx) => { const a = computeAlerts(ctx.ph); return a; });
router.post('/alerts/refresh', { perm: 'stock.view', ok200: true }, (ctx) => { refreshNotifications(ctx.ph); return { ok: true }; });

// ---------- températures (chaîne du froid) ----------
router.get('/temperature', { perm: 'stock.view' }, (ctx) => all('SELECT t.*, u.name user_name FROM temperature_logs t LEFT JOIN users u ON u.id=t.user_id WHERE t.pharmacy_id=? ORDER BY t.id DESC LIMIT 100', ctx.ph));
router.post('/temperature', { perm: 'temperature.manage' }, (ctx) => {
  const location = str(ctx.body.location, 'emplacement', { required: true, max: 80 });
  const c = Number(ctx.body.celsius); if (!Number.isFinite(c) || c < -80 || c > 80) throw bad('VALIDATION', 'Température invalide');
  const lo = getSetting(ctx.ph, 'temp_min', 2), hi = getSetting(ctx.ph, 'temp_max', 8), ok = c >= lo && c <= hi ? 1 : 0;
  const id = insert('INSERT INTO temperature_logs(pharmacy_id,location,celsius,in_range,user_id) VALUES (?,?,?,?,?)', ctx.ph, location, c, ok, ctx.user.id);
  if (!ok) { notify({ pharmacyId: ctx.ph, audience: 'pharmacist', kind: 'cold_chain', title: `Chaîne du froid : ${c} °C à « ${location} » (plage ${lo}–${hi} °C)` }); audit(ctx, 'temperature.out_of_range', 'temperature', id, undefined, { location, c }); }
  return { id, in_range: !!ok };
});

// ---------- achats ----------
router.get('/purchase-orders', { perm: 'purchases.view' }, (ctx) => {
  const w = ['po.pharmacy_id=?'], p = [ctx.ph]; if (ctx.query.status) { w.push('po.status=?'); p.push(ctx.query.status); }
  const from = `FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE ${w.join(' AND ')}`;
  return paged(ctx, `SELECT COUNT(*) n ${from}`, `SELECT po.*, s.name supplier_name, (SELECT COALESCE(SUM(qty_ordered*unit_cost),0) FROM purchase_order_lines WHERE po_id=po.id) total FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE ${w.join(' AND ')} ORDER BY po.id DESC`, p);
});
router.get('/purchase-orders/:id', { perm: 'purchases.view' }, (ctx) => {
  const po = get('SELECT po.*, s.name supplier_name FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.id=? AND po.pharmacy_id=?', ctx.params.id, ctx.ph); if (!po) throw notFound('Commande');
  po.lines = all('SELECT l.*, p.name product_name, p.sku FROM purchase_order_lines l JOIN products p ON p.id=l.product_id WHERE l.po_id=?', po.id);
  po.receipts = all('SELECT id, number, supplier_invoice_ref, created_at FROM goods_receipts WHERE po_id=?', po.id);
  return po;
});
const poLines = (b) => arr(b.lines, 'lignes', { required: true, max: 300 }).map((l) => ({ product_id: int(l.product_id, 'produit', { required: true, min: 1 }), qty_ordered: int(l.qty_ordered ?? l.qty, 'quantité', { required: true, min: 1 }), unit_cost: int(l.unit_cost ?? 0, 'coût', { min: 0 }) }));
router.post('/purchase-orders', { perm: 'purchases.manage' }, (ctx) => {
  const sup = int(ctx.body.supplier_id, 'fournisseur', { required: true, min: 1 }); if (!get("SELECT 1 FROM suppliers WHERE id=? AND status='active'", sup)) throw bad('VALIDATION', 'Fournisseur inconnu ou inactif');
  const lines = poLines(ctx.body);
  return tx(() => {
    const number = nextNumber(ctx.ph, 'po', 'BC');
    const id = insert('INSERT INTO purchase_orders(pharmacy_id,supplier_id,number,expected_date,notes,created_by) VALUES (?,?,?,?,?,?)', ctx.ph, sup, number, date(ctx.body.expected_date, 'date prévue'), str(ctx.body.notes, 'notes', { max: 500 }), ctx.user.id);
    for (const l of lines) { if (!get('SELECT 1 FROM products WHERE id=?', l.product_id)) throw bad('VALIDATION', 'Produit inconnu'); insert('INSERT INTO purchase_order_lines(po_id,product_id,qty_ordered,unit_cost) VALUES (?,?,?,?)', id, l.product_id, l.qty_ordered, l.unit_cost || get('SELECT purchase_price p FROM products WHERE id=?', l.product_id).p); }
    audit(ctx, 'po.create', 'purchase_order', id, undefined, { number, lines: lines.length }); return { id, number };
  });
});
router.post('/purchase-orders/:id/status', { perm: 'purchases.manage', ok200: true }, (ctx) => {
  const to = oneOf(ctx.body.status, 'statut', ['sent', 'cancelled'], { required: true });
  const po = get('SELECT * FROM purchase_orders WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!po) throw notFound('Commande');
  if (to === 'sent') { if (po.status !== 'draft') throw conflict('BAD_STATE', 'Seul un brouillon peut être envoyé'); need(ctx, 'purchases.approve'); if (po.created_by === ctx.user.id && ctx.user.role !== 'super_admin' && getSetting(ctx.ph, 'po_four_eyes', false)) throw new HttpError(403, 'FOUR_EYES', 'La validation doit être faite par une autre personne'); }
  if (to === 'cancelled' && !['draft', 'sent'].includes(po.status)) throw conflict('BAD_STATE', 'Commande déjà réceptionnée : annulation impossible');
  run("UPDATE purchase_orders SET status=?, approved_by=?, updated_at=datetime('now') WHERE id=?", to, to === 'sent' ? ctx.user.id : po.approved_by, po.id);
  audit(ctx, 'po.' + to, 'purchase_order', po.id, { status: po.status }, { status: to }); return { ok: true };
});

// Réception (partielle ou totale) : crée/retrouve les lots, alimente le stock, met à jour la commande — en une seule transaction.
router.post('/goods-receipts', { perm: 'receipts.create' }, (ctx) => {
  const b = ctx.body; const lines = arr(b.lines, 'lignes', { required: true, max: 300 });
  return tx(() => {
    const poId = b.po_id ? int(b.po_id, 'commande') : null;
    const po = poId ? get('SELECT * FROM purchase_orders WHERE id=? AND pharmacy_id=?', poId, ctx.ph) : null;
    if (poId && !po) throw notFound('Commande');
    if (po && !['sent', 'partial'].includes(po.status)) throw conflict('BAD_STATE', 'La commande doit être envoyée (et non soldée) pour être réceptionnée');
    const supplierId = po ? po.supplier_id : int(b.supplier_id, 'fournisseur', { required: true, min: 1 });
    if (!get('SELECT 1 FROM suppliers WHERE id=?', supplierId)) throw bad('VALIDATION', 'Fournisseur inconnu');
    const number = nextNumber(ctx.ph, 'gr', 'BR');
    const rid = insert('INSERT INTO goods_receipts(pharmacy_id,po_id,supplier_id,number,supplier_invoice_ref,notes,user_id) VALUES (?,?,?,?,?,?,?)', ctx.ph, poId, supplierId, number, str(b.supplier_invoice_ref, 'facture fournisseur', { max: 80 }), str(b.notes, 'notes', { max: 500 }), ctx.user.id);
    const warnings = [];
    for (const l of lines) {
      const productId = int(l.product_id, 'produit', { required: true, min: 1 }), qty = int(l.qty, 'quantité', { required: true, min: 1, max: 1e6 });
      const batchNo = str(l.batch_no, 'n° de lot', { required: true, max: 60 }), exp = date(l.exp_date, 'date de péremption', { required: true }), mfg = date(l.mfg_date, 'date de fabrication');
      const cost = int(l.unit_cost ?? 0, 'coût', { min: 0 }); const prod = get('SELECT * FROM products WHERE id=?', productId); if (!prod) throw bad('VALIDATION', `Produit ${productId} inconnu`);
      if (exp < todaySql()) throw conflict('EXPIRED_ON_RECEIPT', `Lot ${batchNo} de « ${prod.name} » déjà périmé : réception refusée (traiter comme retour fournisseur)`);
      if (mfg && mfg > exp) throw bad('VALIDATION', 'Fabrication postérieure à la péremption');
      const minShelf = getSetting(ctx.ph, 'min_shelf_life_days_receipt', 0);
      if (minShelf && exp < new Date(Date.now() + minShelf * 864e5).toISOString().slice(0, 10)) warnings.push(`Lot ${batchNo} (« ${prod.name} ») : durée de vie résiduelle < ${minShelf} j`);
      let batch = get('SELECT * FROM batches WHERE product_id=? AND batch_no=?', productId, batchNo);
      if (batch && batch.exp_date !== exp) throw conflict('BATCH_EXP_MISMATCH', `Lot ${batchNo} existant avec une autre date de péremption (${batch.exp_date}) : vérifier le bordereau`);
      if (batch && batch.status === 'recalled') throw conflict('BATCH_RECALLED', `Lot ${batchNo} rappelé : réception refusée`);
      const batchId = batch ? batch.id : insert('INSERT INTO batches(product_id,batch_no,mfg_date,exp_date,supplier_id,unit_cost) VALUES (?,?,?,?,?,?)', productId, batchNo, mfg, exp, supplierId, cost || prod.purchase_price);
      let polId = null;
      if (po) {
        const pl = get('SELECT * FROM purchase_order_lines WHERE po_id=? AND product_id=?', poId, productId);
        if (!pl) throw conflict('NOT_ON_ORDER', `« ${prod.name} » ne figure pas sur la commande ${po.number}`);
        if (pl.qty_received + qty > pl.qty_ordered && b.allow_over !== true) throw conflict('OVER_RECEIPT', `Quantité reçue supérieure à la commande pour « ${prod.name} » (reste ${pl.qty_ordered - pl.qty_received})`);
        run('UPDATE purchase_order_lines SET qty_received = qty_received + ? WHERE id=?', qty, pl.id); polId = pl.id;
        if (cost && pl.unit_cost && Math.abs(cost - pl.unit_cost) > 0) warnings.push(`Écart de prix « ${prod.name} » : commandé ${pl.unit_cost}, facturé ${cost}`);
      }
      if (l.location) ensureLevelWithLocation(ctx.ph, batchId, str(l.location, 'emplacement', { max: 60 }));
      insert('INSERT INTO goods_receipt_lines(receipt_id,po_line_id,product_id,batch_id,qty,unit_cost) VALUES (?,?,?,?,?,?)', rid, polId, productId, batchId, qty, cost || prod.purchase_price);
      // un produit « chaîne du froid » ou un lot contrôlé peut être reçu directement en quarantaine
      const toQ = l.quarantine === true;
      applyMovement({ ph: ctx.ph, batchId, productId, type: 'receipt', qty, bucket: toQ ? 'quarantine' : 'available', refType: 'receipt', refId: rid, userId: ctx.user.id });
    }
    if (po) {
      const open = get('SELECT COUNT(*) n FROM purchase_order_lines WHERE po_id=? AND qty_received < qty_ordered', poId).n;
      run("UPDATE purchase_orders SET status=?, updated_at=datetime('now') WHERE id=?", open ? 'partial' : 'received', poId);
    }
    audit(ctx, 'receipt.create', 'goods_receipt', rid, undefined, { number, po: po?.number, lines: lines.length });
    return { id: rid, number, warnings, po_status: poId ? get('SELECT status FROM purchase_orders WHERE id=?', poId).status : null };
  });
});
function ensureLevelWithLocation(ph, batchId, loc) { ensureLevel(ph, batchId); run('UPDATE stock_levels SET location=? WHERE pharmacy_id=? AND batch_id=?', loc, ph, batchId); }
router.get('/goods-receipts', { perm: 'purchases.view' }, (ctx) => paged(ctx, 'SELECT COUNT(*) n FROM goods_receipts WHERE pharmacy_id=?', 'SELECT r.*, s.name supplier_name, u.name user_name FROM goods_receipts r JOIN suppliers s ON s.id=r.supplier_id LEFT JOIN users u ON u.id=r.user_id WHERE r.pharmacy_id=? ORDER BY r.id DESC', [ctx.ph]));

// Proposition de réapprovisionnement (statistique simple, avec niveau de confiance et limites explicites)
router.get('/purchase-suggestions', { perm: 'purchases.view' }, (ctx) => {
  const days = 30; const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const rows = all(`${stockSummarySql} WHERE p.status='active' GROUP BY p.id`, ctx.ph);
  const out = [];
  for (const r of rows) {
    const sold = get(`SELECT COALESCE(SUM(l.qty - l.qty_refunded),0) q, COUNT(DISTINCT date(s.created_at)) d FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.pharmacy_id=? AND l.product_id=? AND s.created_at >= ?`, ctx.ph, r.id, since);
    const avg = sold.q / days;
    const sup = get('SELECT s.id, s.name, s.lead_days FROM batches b JOIN suppliers s ON s.id=b.supplier_id WHERE b.product_id=? ORDER BY b.id DESC LIMIT 1', r.id);
    const lead = sup?.lead_days ?? 3, cover = lead + 7;
    const target = Math.ceil(avg * cover) + r.min_stock, inbound = get("SELECT COALESCE(SUM(l.qty_ordered-l.qty_received),0) q FROM purchase_order_lines l JOIN purchase_orders o ON o.id=l.po_id WHERE o.pharmacy_id=? AND o.status IN ('sent','partial') AND l.product_id=?", ctx.ph, r.id).q;
    const suggested = Math.max(0, target - r.sellable - inbound);
    if (suggested > 0 && (r.min_stock > 0 || avg > 0)) out.push({ product_id: r.id, sku: r.sku, name: r.name, sellable: r.sellable, inbound, avg_daily_sales: Math.round(avg * 100) / 100, lead_days: lead, suggested_qty: suggested, supplier_id: sup?.id ?? null, supplier_name: sup?.name ?? null, confidence: sold.d >= 15 ? 'élevée' : sold.d >= 6 ? 'moyenne' : 'faible' });
  }
  return { note: 'Estimation basée sur les 30 derniers jours de ventes ; ne tient pas compte de la saisonnalité ni des événements. À valider par le gestionnaire.', data: out.sort((a, b) => b.suggested_qty - a.suggested_qty) };
});

// ---------- inventaires ----------
router.get('/inventories', { perm: 'inventory.manage' }, (ctx) => paged(ctx, 'SELECT COUNT(*) n FROM inventory_sessions WHERE pharmacy_id=?', 'SELECT i.*, u.name created_by_name, (SELECT COUNT(*) FROM inventory_lines WHERE session_id=i.id) lines, (SELECT COUNT(*) FROM inventory_lines WHERE session_id=i.id AND counted_qty IS NOT NULL AND counted_qty != expected_qty) variances FROM inventory_sessions i LEFT JOIN users u ON u.id=i.created_by WHERE i.pharmacy_id=? ORDER BY i.id DESC', [ctx.ph]));
router.post('/inventories', { perm: 'inventory.manage' }, (ctx) => {
  const label = str(ctx.body.label, 'libellé', { required: true, max: 120 }), kind = oneOf(ctx.body.kind || 'full', 'type', ['full', 'cycle']);
  return tx(() => {
    const id = insert('INSERT INTO inventory_sessions(pharmacy_id,label,kind,created_by) VALUES (?,?,?,?)', ctx.ph, label, kind, ctx.user.id);
    const w = ['s.pharmacy_id=?', '(s.qty_available + s.qty_quarantine) > 0'], p = [ctx.ph];
    if (kind === 'cycle') { if (ctx.body.category_id) { w.push('pr.category_id=?'); p.push(ctx.body.category_id); } else if (Array.isArray(ctx.body.product_ids) && ctx.body.product_ids.length) { w.push(`pr.id IN (${ctx.body.product_ids.map(() => '?').join(',')})`); p.push(...ctx.body.product_ids.map(Number)); } else throw bad('VALIDATION', 'Inventaire tournant : précisez une catégorie ou des produits'); }
    const lots = all(`SELECT s.batch_id, s.qty_available, pr.id product_id FROM stock_levels s JOIN batches b ON b.id=s.batch_id JOIN products pr ON pr.id=b.product_id WHERE ${w.join(' AND ')}`, ...p);
    for (const l of lots) insert('INSERT INTO inventory_lines(session_id,batch_id,product_id,expected_qty) VALUES (?,?,?,?)', id, l.batch_id, l.product_id, l.qty_available);
    audit(ctx, 'inventory.create', 'inventory', id, undefined, { label, kind, lines: lots.length }); return { id, lines: lots.length };
  });
});
router.get('/inventories/:id', { perm: 'inventory.manage' }, (ctx) => {
  const s = get('SELECT * FROM inventory_sessions WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!s) throw notFound('Inventaire');
  // inventaire « en aveugle » : le stock théorique n'est visible qu'aux validateurs tant que l'inventaire est ouvert
  const blind = s.status === 'open' && !can(ctx.user, 'inventory.validate');
  s.lines = all(`SELECT l.id, l.batch_id, l.product_id, ${blind ? 'NULL' : 'l.expected_qty'} expected_qty, l.counted_qty, l.reason, p.name product_name, p.sku, p.barcode, b.batch_no, b.exp_date FROM inventory_lines l JOIN products p ON p.id=l.product_id JOIN batches b ON b.id=l.batch_id WHERE l.session_id=? ORDER BY p.name, b.exp_date`, s.id);
  s.blind = blind; return s;
});
router.put('/inventories/:id/lines', { perm: 'inventory.manage', ok200: true }, (ctx) => {
  const s = get('SELECT * FROM inventory_sessions WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!s) throw notFound('Inventaire');
  if (s.status !== 'open') throw conflict('BAD_STATE', 'Inventaire clôturé');
  return tx(() => {
    for (const l of arr(ctx.body.lines, 'lignes', { required: true, max: 2000 })) {
      const batchId = int(l.batch_id, 'lot', { required: true, min: 1 }), counted = int(l.counted_qty, 'quantité comptée', { required: true, min: 0 });
      const ex = get('SELECT * FROM inventory_lines WHERE session_id=? AND batch_id=?', s.id, batchId);
      if (ex) run('UPDATE inventory_lines SET counted_qty=?, reason=? WHERE id=?', counted, str(l.reason, 'justification', { max: 300 }), ex.id);
      else { const b = get('SELECT * FROM batches WHERE id=?', batchId); if (!b) throw notFound('Lot'); insert('INSERT INTO inventory_lines(session_id,batch_id,product_id,expected_qty,counted_qty,reason) VALUES (?,?,?,?,?,?)', s.id, batchId, b.product_id, 0, counted, str(l.reason, 'justification', { max: 300 })); }
    }
    return { ok: true };
  });
});
router.post('/inventories/:id/submit', { perm: 'inventory.manage', ok200: true }, (ctx) => {
  const s = get('SELECT * FROM inventory_sessions WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!s) throw notFound('Inventaire');
  if (s.status !== 'open') throw conflict('BAD_STATE', 'Inventaire déjà soumis');
  if (get('SELECT COUNT(*) n FROM inventory_lines WHERE session_id=? AND counted_qty IS NULL', s.id).n) throw conflict('INCOMPLETE', 'Toutes les lignes doivent être comptées');
  run("UPDATE inventory_sessions SET status='submitted' WHERE id=?", s.id); audit(ctx, 'inventory.submit', 'inventory', s.id); return { ok: true };
});
// Validation hiérarchique : par une autre personne que celle qui a créé l'inventaire ; écarts justifiés ; ajustements en une transaction.
router.post('/inventories/:id/validate', { perm: 'inventory.validate', ok200: true }, (ctx) => {
  return tx(() => {
    const s = get('SELECT * FROM inventory_sessions WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!s) throw notFound('Inventaire');
    if (s.status !== 'submitted') throw conflict('BAD_STATE', 'Inventaire non soumis');
    if (s.created_by === ctx.user.id && ctx.user.role !== 'super_admin') throw new HttpError(403, 'FOUR_EYES', 'La validation doit être faite par une autre personne que le créateur');
    let adj = 0;
    for (const l of all('SELECT * FROM inventory_lines WHERE session_id=? AND counted_qty != expected_qty', s.id)) {
      if (!l.reason) throw conflict('REASON_REQUIRED', 'Chaque écart doit être justifié', { line_id: l.id });
      const cur = get('SELECT qty_available, qty_reserved FROM stock_levels WHERE pharmacy_id=? AND batch_id=?', ctx.ph, l.batch_id) || { qty_available: 0, qty_reserved: 0 };
      const delta = l.counted_qty - l.expected_qty; // appliqué au stock courant pour ne pas écraser les ventes survenues pendant le comptage
      if (cur.qty_available + delta < cur.qty_reserved) throw conflict('RESERVED_CONFLICT', 'Le comptage est inférieur aux quantités réservées : traiter les réservations d\'abord', { line_id: l.id });
      applyMovement({ ph: ctx.ph, batchId: l.batch_id, productId: l.product_id, type: 'inventory_adjust', qty: delta, reason: l.reason, refType: 'inventory', refId: s.id, userId: ctx.user.id }); adj++;
    }
    run("UPDATE inventory_sessions SET status='validated', validated_by=?, closed_at=datetime('now') WHERE id=?", ctx.user.id, s.id);
    audit(ctx, 'inventory.validate', 'inventory', s.id, undefined, { adjustments: adj }); return { adjustments: adj };
  });
});
