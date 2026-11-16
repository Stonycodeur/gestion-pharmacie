import { router, audit, paged, can, need, publish } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { HttpError, bad, conflict, notFound, str, int, oneOf } from '../util.js';
import { createSale, getSale, refundSale, openSession, sessionSummary, cashExpected } from '../sales.js';
import { searchProducts } from './catalog.js';

// Recherche POS : produits + disponibilité vendable pour l'établissement courant
router.get('/pos/search', { perm: 'sales.create' }, (ctx) => {
  const q = String(ctx.query.q || '').trim(); if (!q) return [];
  const rows = searchProducts(q, 15);
  return rows.map((p) => {
    const s = get(`SELECT COALESCE(SUM(CASE WHEN b.status='ok' AND b.exp_date >= date('now') THEN s.qty_available - s.qty_reserved ELSE 0 END),0) sellable, MIN(CASE WHEN s.qty_available > 0 AND b.status='ok' AND b.exp_date >= date('now') THEN b.exp_date END) next_expiry
      FROM batches b JOIN stock_levels s ON s.batch_id=b.id AND s.pharmacy_id=? WHERE b.product_id=?`, ctx.ph, p.id);
    return { id: p.id, sku: p.sku, name: p.name, dci: p.dci, dosage: p.dosage, form: p.form, barcode: p.barcode, rx_status: p.rx_status, sale_price: p.sale_price, tax_rate: p.tax_rate, sellable: s.sellable, next_expiry: s.next_expiry };
  });
});

// Instantané du catalogue pour la caisse hors connexion : tous les produits actifs avec prix, TVA et disponibilité vendable à l'instant T
router.get('/pos/snapshot', { perm: 'sales.create' }, (ctx) => {
  const rows = all(`SELECT p.id,p.sku,p.name,p.dci,p.dosage,p.form,p.barcode,p.rx_status,p.sale_price,p.tax_rate,
      COALESCE((SELECT SUM(CASE WHEN b.status='ok' AND b.exp_date >= date('now') THEN s.qty_available - s.qty_reserved ELSE 0 END) FROM batches b JOIN stock_levels s ON s.batch_id=b.id AND s.pharmacy_id=? WHERE b.product_id=p.id),0) sellable
    FROM products p WHERE p.status='active' AND EXISTS (SELECT 1 FROM pharmacy_catalog pc WHERE pc.product_id=p.id AND pc.pharmacy_id=?) ORDER BY p.name`, ctx.ph, ctx.ph);
  return { generated_at: new Date().toISOString(), pharmacy_id: ctx.ph, products: rows };
});
router.post('/sales', { perm: 'sales.create' }, (ctx) => {
  const key = ctx.req.headers['idempotency-key'] || ctx.body.idempotency_key;
  const sale = createSale(ctx, { ...ctx.body, idempotency_key: key });
  if (sale.duplicate) ctx.res.statusCode = 200;
  publish(ctx.ph, 'sale', { number: sale.number, total: sale.total });
  return sale;
});
router.get('/sales', { perm: 'sales.view' }, (ctx) => {
  const w = ['s.pharmacy_id=?'], p = [ctx.ph];
  if (ctx.query.from) { w.push('s.created_at >= ?'); p.push(ctx.query.from); }
  if (ctx.query.to) { w.push('s.created_at <= ?'); p.push(ctx.query.to + ' 23:59:59'); }
  if (ctx.query.q) { const l = `%${ctx.query.q}%`; w.push("(s.number LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR u.name LIKE ? OR EXISTS (SELECT 1 FROM payments pm WHERE pm.sale_id=s.id AND pm.method LIKE ?) OR CAST(s.total AS CHAR) LIKE ?)"); p.push(l, l, l, l, l, l); }
  if (!can(ctx.user, 'cash.view_all') && ctx.user.role === 'cashier') { w.push('s.cashier_id=?'); p.push(ctx.user.id); }
  const from = `FROM sales s JOIN users u ON u.id=s.cashier_id LEFT JOIN customers c ON c.id=s.customer_id WHERE ${w.join(' AND ')}`;
  return paged(ctx, `SELECT COUNT(*) n ${from}`, `SELECT s.id,s.number,s.total,s.discount,s.status,s.created_at,u.name cashier_name,c.name customer_name ${from} ORDER BY s.id DESC`, p);
});
router.get('/sales/:id', { perm: 'sales.view' }, (ctx) => { const s = getSale(Number(ctx.params.id), ctx.ph); if (!s) throw notFound('Vente'); return s; });
router.post('/sales/:id/refund', { perm: 'sales.refund' }, (ctx) => refundSale(ctx, Number(ctx.params.id), ctx.body));

// ---------- caisse ----------
router.get('/cash/registers', { perm: 'cash.use' }, (ctx) => all("SELECT * FROM cash_registers WHERE pharmacy_id=? AND status='active'", ctx.ph));
router.post('/cash/registers', { perm: 'settings.manage' }, (ctx) => { const name = str(ctx.body.name, 'nom', { required: true, max: 60 }); const id = insert('INSERT INTO cash_registers(pharmacy_id,name) VALUES (?,?)', ctx.ph, name); audit(ctx, 'register.create', 'register', id); return { id, name }; });
router.put('/cash/registers/:id', { perm: 'settings.manage' }, (ctx) => {
  const r = get('SELECT * FROM cash_registers WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!r) throw notFound('Caisse');
  const name = str(ctx.body.name, 'nom', { required: true, max: 60 }), status = oneOf(ctx.body.status || 'active', 'statut', ['active', 'inactive']);
  if (status === 'inactive' && get("SELECT 1 FROM cash_sessions WHERE register_id=? AND status='open'", r.id)) throw conflict('REGISTER_BUSY', 'Caisse ouverte : fermez la session d\'abord');
  run('UPDATE cash_registers SET name=?, status=? WHERE id=?', name, status, r.id); audit(ctx, 'register.update', 'register', r.id, r, { name, status }); return { ok: true };
});
router.get('/cash/current', { perm: 'cash.use' }, (ctx) => { const s = openSession(ctx); return s ? { ...s, ...sessionSummary(s.id) } : null; });
router.post('/cash/open', { perm: 'cash.use' }, (ctx) => {
  const reg = int(ctx.body.register_id, 'caisse', { required: true, min: 1 }), fl = int(ctx.body.opening_float ?? 0, 'fond de caisse', { min: 0 });
  return tx(() => {
    if (!get('SELECT 1 FROM cash_registers WHERE id=? AND pharmacy_id=?', reg, ctx.ph)) throw bad('VALIDATION', 'Caisse inconnue');
    if (openSession(ctx)) throw conflict('ALREADY_OPEN', 'Vous avez déjà une session de caisse ouverte');
    if (get("SELECT 1 FROM cash_sessions WHERE register_id=? AND status='open'", reg)) throw conflict('REGISTER_BUSY', 'Cette caisse est déjà ouverte par un autre utilisateur');
    const id = insert('INSERT INTO cash_sessions(pharmacy_id,register_id,user_id,opening_float) VALUES (?,?,?,?)', ctx.ph, reg, ctx.user.id, fl);
    audit(ctx, 'cash.open', 'cash_session', id, undefined, { fl }); return { id };
  });
});
router.post('/cash/movement', { perm: 'cash.use' }, (ctx) => {
  const s = openSession(ctx); if (!s) throw conflict('NO_OPEN_CASH_SESSION', 'Aucune session ouverte');
  const kind = oneOf(ctx.body.kind, 'type', ['cash_in', 'cash_out'], { required: true }), amount = int(ctx.body.amount, 'montant', { required: true, min: 1 }), reason = str(ctx.body.reason, 'motif', { required: true, min: 3, max: 200 });
  if (kind === 'cash_out' && cashExpected(s.id) < amount) throw conflict('INSUFFICIENT_CASH', 'Espèces insuffisantes en caisse');
  const id = insert('INSERT INTO cash_movements(session_id,kind,method,amount,reason,user_id) VALUES (?,?,?,?,?,?)', s.id, kind, 'cash', kind === 'cash_in' ? amount : -amount, reason, ctx.user.id);
  audit(ctx, 'cash.' + kind, 'cash_session', s.id, undefined, { amount, reason }); return { id };
});
router.post('/cash/close', { perm: 'cash.use', ok200: true }, (ctx) => {
  const s = openSession(ctx); if (!s) throw conflict('NO_OPEN_CASH_SESSION', 'Aucune session ouverte');
  const counted = int(ctx.body.counted_cash, 'espèces comptées', { required: true, min: 0 }); const expected = cashExpected(s.id), diff = counted - expected;
  const reason = str(ctx.body.reason, 'justification', { max: 300 });
  if (diff !== 0 && (!reason || reason.length < 3)) throw conflict('REASON_REQUIRED', `Écart de caisse de ${diff} : une justification est obligatoire`, { expected, counted, difference: diff });
  run("UPDATE cash_sessions SET status='closed', counted_cash=?, expected_cash=?, difference=?, difference_reason=?, closed_at=datetime('now') WHERE id=?", counted, expected, diff, reason, s.id);
  audit(ctx, 'cash.close', 'cash_session', s.id, undefined, { expected, counted, diff, reason });
  return { expected, counted, difference: diff, ...sessionSummary(s.id) };
});
router.get('/cash/sessions', { anyPerm: ['cash.view_all', 'cash.use'] }, (ctx) => {
  const own = !can(ctx.user, 'cash.view_all');
  const w = ['cs.pharmacy_id=?'], p = [ctx.ph]; if (own) { w.push('cs.user_id=?'); p.push(ctx.user.id); }
  return paged(ctx, `SELECT COUNT(*) n FROM cash_sessions cs WHERE ${w.join(' AND ')}`, `SELECT cs.*, u.name user_name, r.name register_name FROM cash_sessions cs JOIN users u ON u.id=cs.user_id JOIN cash_registers r ON r.id=cs.register_id WHERE ${w.join(' AND ')} ORDER BY cs.id DESC`, p);
});
router.get('/cash/sessions/:id', { anyPerm: ['cash.view_all', 'cash.use'] }, (ctx) => {
  const s = get('SELECT cs.*, u.name user_name FROM cash_sessions cs JOIN users u ON u.id=cs.user_id WHERE cs.id=? AND cs.pharmacy_id=?', ctx.params.id, ctx.ph); if (!s) throw notFound('Session');
  if (s.user_id !== ctx.user.id && !can(ctx.user, 'cash.view_all')) throw new HttpError(403, 'FORBIDDEN', 'Accès refusé');
  return { ...s, ...sessionSummary(s.id), movements: all('SELECT * FROM cash_movements WHERE session_id=? ORDER BY id', s.id) };
});
