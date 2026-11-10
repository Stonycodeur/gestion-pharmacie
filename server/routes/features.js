// Fonctions complémentaires : transferts, retours/avoirs/paiements fournisseurs, acomptes, soldes clients, clôture de période, ticket PDF.
import { router, audit, paged, can, notify } from '../http.js';
import { get, all, run, insert, tx, nextNumber, getSetting } from '../db.js';
import { HttpError, bad, conflict, notFound, forbidden, str, int, date, oneOf, arr, todaySql } from '../util.js';
import { allocate, applyMovement } from '../stock.js';
import { openSession, getSale, saleBalance, customerBalance, periodLockedUntil } from '../sales.js';
import { pdfReceipt } from '../export.js';
import { sendCsv } from './reports.js';

const METHODS = ['cash', 'card', 'mobile', 'transfer', 'wallet'];

// ================= TRANSFERTS INTER-ÉTABLISSEMENTS =================
// Expédition = sortie de stock immédiate (FEFO) de l'expéditeur ; réception = entrée dans le stock du destinataire. Les écarts exigent une justification.
const tAccess = { anyPerm: ['transfers.manage', 'transfers.receive'] };
const tLoad = (ctx) => {
  const t = get('SELECT t.*, f.name from_name, d.name to_name FROM transfers t JOIN pharmacies f ON f.id=t.from_pharmacy_id JOIN pharmacies d ON d.id=t.to_pharmacy_id WHERE t.id=? AND (t.from_pharmacy_id=? OR t.to_pharmacy_id=?)', ctx.params.id, ctx.ph, ctx.ph);
  if (!t) throw notFound('Transfert'); return t;
};
router.get('/transfers/destinations', tAccess, (ctx) => all("SELECT id,name FROM pharmacies WHERE status='active' AND id<>? ORDER BY name", ctx.ph));
router.get('/transfers', tAccess, (ctx) => {
  const dir = ctx.query.direction === 'in' ? 't.to_pharmacy_id=?' : ctx.query.direction === 'out' ? 't.from_pharmacy_id=?' : '(t.from_pharmacy_id=? OR t.to_pharmacy_id=?)';
  const p = dir.includes('OR') ? [ctx.ph, ctx.ph] : [ctx.ph];
  return paged(ctx, `SELECT COUNT(*) n FROM transfers t WHERE ${dir}`, `SELECT t.*, f.name from_name, d.name to_name, (SELECT COALESCE(SUM(qty),0) FROM transfer_lines WHERE transfer_id=t.id) units FROM transfers t JOIN pharmacies f ON f.id=t.from_pharmacy_id JOIN pharmacies d ON d.id=t.to_pharmacy_id WHERE ${dir} ORDER BY t.id DESC`, p);
});
router.get('/transfers/:id', tAccess, (ctx) => {
  const t = tLoad(ctx);
  t.lines = all('SELECT l.*, p.name product_name, p.sku, b.batch_no, b.exp_date FROM transfer_lines l JOIN products p ON p.id=l.product_id JOIN batches b ON b.id=l.batch_id WHERE l.transfer_id=?', t.id); return t;
});
router.post('/transfers', { perm: 'transfers.manage' }, (ctx) => {
  const to = int(ctx.body.to_pharmacy_id, 'destination', { required: true, min: 1 });
  if (to === ctx.ph) throw bad('VALIDATION', 'La destination doit être un autre établissement');
  if (!get("SELECT 1 FROM pharmacies WHERE id=? AND status='active'", to)) throw bad('VALIDATION', 'Établissement de destination inconnu');
  const lines = arr(ctx.body.lines, 'lignes', { required: true, max: 100 });
  return tx(() => {
    const number = nextNumber(ctx.ph, 'transfer', 'TR');
    const id = insert("INSERT INTO transfers(number,from_pharmacy_id,to_pharmacy_id,status,notes,created_by,shipped_by,shipped_at) VALUES (?,?,?,'shipped',?,?,?,datetime('now'))", number, ctx.ph, to, str(ctx.body.notes, 'notes', { max: 300 }), ctx.user.id, ctx.user.id);
    let units = 0;
    for (const l of lines) {
      const pid = int(l.product_id, 'produit', { required: true, min: 1 }), q = int(l.qty, 'quantité', { required: true, min: 1, max: 100000 });
      const p = get("SELECT * FROM products WHERE id=? AND status='active'", pid); if (!p) throw bad('VALIDATION', `Produit ${pid} introuvable`);
      if (p.rx_status !== 'free' && !can(ctx.user, 'sales.dispense_rx')) throw forbidden(`« ${p.name} » : le transfert d'un produit réglementé est réservé au pharmacien`, 'RX_PERMISSION');
      for (const a of allocate(ctx.ph, pid, q, { onlyBatches: l.batch_id ? [int(l.batch_id, 'lot')] : null })) {
        insert('INSERT INTO transfer_lines(transfer_id,product_id,batch_id,qty) VALUES (?,?,?,?)', id, pid, a.batch.id, a.qty);
        applyMovement({ ph: ctx.ph, batchId: a.batch.id, productId: pid, type: 'transfer_out', qty: -a.qty, refType: 'transfer', refId: id, userId: ctx.user.id }); units += a.qty;
      }
    }
    audit(ctx, 'transfer.ship', 'transfer', id, undefined, { number, to, units });
    notify({ pharmacyId: to, audience: 'stock', kind: 'transfer_incoming', title: `Transfert entrant ${number} (${units} unités) à réceptionner`, dedupe: `tr:${id}` });
    return get('SELECT * FROM transfers WHERE id=?', id);
  });
});
router.post('/transfers/:id/receive', { perm: 'transfers.receive', ok200: true }, (ctx) => tx(() => {
  const t = tLoad(ctx);
  if (t.to_pharmacy_id !== ctx.ph) throw forbidden('Seul l\'établissement destinataire peut réceptionner');
  if (t.status !== 'shipped') throw conflict('BAD_STATE', 'Transfert non réceptionnable');
  const given = new Map((Array.isArray(ctx.body.lines) ? ctx.body.lines : []).map((l) => [Number(l.line_id), l.qty_received]));
  let short = 0;
  for (const l of all('SELECT * FROM transfer_lines WHERE transfer_id=?', t.id)) {
    const q = given.has(l.id) ? int(given.get(l.id), 'quantité reçue', { required: true, min: 0, max: l.qty }) : l.qty;
    run('UPDATE transfer_lines SET qty_received=? WHERE id=?', q, l.id); short += l.qty - q;
    if (q > 0) applyMovement({ ph: ctx.ph, batchId: l.batch_id, productId: l.product_id, type: 'transfer_in', qty: q, refType: 'transfer', refId: t.id, userId: ctx.user.id });
  }
  const note = str(ctx.body.note, 'justification', { max: 300 });
  if (short > 0 && (!note || note.length < 3)) throw conflict('REASON_REQUIRED', `Écart de ${short} unité(s) : une justification est obligatoire`, { short });
  run("UPDATE transfers SET status='received', received_by=?, received_at=datetime('now'), notes=COALESCE(notes,'') || ? WHERE id=?", ctx.user.id, short > 0 ? ` [Écart réception : ${note}]` : '', t.id);
  audit(ctx, 'transfer.receive', 'transfer', t.id, undefined, { short, note });
  if (short > 0) notify({ pharmacyId: t.from_pharmacy_id, audience: 'stock', kind: 'transfer_gap', title: `Écart de réception sur ${t.number} : ${short} unité(s)` });
  return { ok: true, short };
}));
// Annulation / refus : le stock revient à l'expéditeur (réservé aux transferts non réceptionnés)
router.post('/transfers/:id/cancel', { ...tAccess, ok200: true }, (ctx) => tx(() => {
  const t = tLoad(ctx); const reason = str(ctx.body.reason, 'motif', { required: true, min: 3, max: 200 });
  if (t.status !== 'shipped') throw conflict('BAD_STATE', 'Seul un transfert expédié non réceptionné peut être annulé');
  const mine = ctx.ph === t.from_pharmacy_id ? 'transfers.manage' : 'transfers.receive';
  if (!can(ctx.user, mine)) throw forbidden('Permission requise : ' + mine, 'PERMISSION_DENIED');
  for (const l of all('SELECT * FROM transfer_lines WHERE transfer_id=?', t.id)) applyMovement({ ph: t.from_pharmacy_id, batchId: l.batch_id, productId: l.product_id, type: 'transfer_cancel', qty: l.qty, reason, refType: 'transfer', refId: t.id, userId: ctx.user.id });
  const st = ctx.ph === t.from_pharmacy_id ? 'cancelled' : 'rejected';
  run('UPDATE transfers SET status=? WHERE id=?', st, t.id); audit(ctx, 'transfer.' + st, 'transfer', t.id, undefined, { reason });
  return { ok: true, status: st };
}));

// ================= RETOURS / AVOIRS / PAIEMENTS FOURNISSEURS =================
router.get('/supplier-returns', { perm: 'suppliers.view' }, (ctx) => paged(ctx, 'SELECT COUNT(*) n FROM supplier_returns WHERE pharmacy_id=?', 'SELECT r.*, s.name supplier_name, (SELECT COALESCE(SUM(qty),0) FROM supplier_return_lines WHERE return_id=r.id) units FROM supplier_returns r JOIN suppliers s ON s.id=r.supplier_id WHERE r.pharmacy_id=? ORDER BY r.id DESC', [ctx.ph]));
router.get('/supplier-returns/:id', { perm: 'suppliers.view' }, (ctx) => {
  const r = get('SELECT r.*, s.name supplier_name FROM supplier_returns r JOIN suppliers s ON s.id=r.supplier_id WHERE r.id=? AND r.pharmacy_id=?', ctx.params.id, ctx.ph); if (!r) throw notFound('Retour fournisseur');
  r.lines = all('SELECT l.*, p.name product_name, b.batch_no, b.exp_date FROM supplier_return_lines l JOIN products p ON p.id=l.product_id JOIN batches b ON b.id=l.batch_id WHERE l.return_id=?', r.id); return r;
});
router.post('/supplier-returns', { perm: 'supplier_returns.manage' }, (ctx) => {
  const sid = int(ctx.body.supplier_id, 'fournisseur', { required: true, min: 1 }); if (!get('SELECT 1 FROM suppliers WHERE id=?', sid)) throw bad('VALIDATION', 'Fournisseur inconnu');
  const reason = str(ctx.body.reason, 'motif', { required: true, min: 3, max: 300 });
  const receiptId = ctx.body.receipt_id ? int(ctx.body.receipt_id, 'réception', { min: 1 }) : null;
  if (receiptId && !get('SELECT 1 FROM goods_receipts WHERE id=? AND pharmacy_id=? AND supplier_id=?', receiptId, ctx.ph, sid)) throw bad('VALIDATION', 'Réception inconnue pour ce fournisseur');
  const lines = arr(ctx.body.lines, 'lignes', { required: true, max: 100 });
  return tx(() => {
    const number = nextNumber(ctx.ph, 'supplier_return', 'RF');
    const id = insert('INSERT INTO supplier_returns(pharmacy_id,supplier_id,number,receipt_id,reason,created_by) VALUES (?,?,?,?,?,?)', ctx.ph, sid, number, receiptId, reason, ctx.user.id);
    for (const l of lines) {
      const b = get('SELECT * FROM batches WHERE id=?', int(l.batch_id, 'lot', { required: true, min: 1 })); if (!b) throw notFound('Lot');
      const q = int(l.qty, 'quantité', { required: true, min: 1 }), bucket = oneOf(l.bucket || 'available', 'compartiment', ['available', 'quarantine', 'damaged']);
      insert('INSERT INTO supplier_return_lines(return_id,product_id,batch_id,qty,bucket,unit_cost) VALUES (?,?,?,?,?,?)', id, b.product_id, b.id, q, bucket, b.unit_cost || 0);
      applyMovement({ ph: ctx.ph, batchId: b.id, productId: b.product_id, type: 'supplier_return', qty: -q, bucket, reason, refType: 'supplier_return', refId: id, userId: ctx.user.id });
    }
    audit(ctx, 'supplier_return.create', 'supplier_return', id, undefined, { number, supplier: sid, lines: lines.length }); return get('SELECT * FROM supplier_returns WHERE id=?', id);
  });
});
router.post('/supplier-returns/:id/credit', { perm: 'supplier_returns.manage', ok200: true }, (ctx) => tx(() => {
  const r = get('SELECT * FROM supplier_returns WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!r) throw notFound('Retour fournisseur');
  if (r.status !== 'sent') throw conflict('BAD_STATE', 'Retour déjà traité');
  const amount = int(ctx.body.credit_amount, 'montant de l\'avoir', { required: true, min: 0 }), ref = str(ctx.body.credit_note_ref, 'référence de l\'avoir', { required: true, max: 80 });
  run("UPDATE supplier_returns SET status='credited', credit_amount=?, credit_note_ref=?, credited_at=datetime('now') WHERE id=?", amount, ref, r.id);
  audit(ctx, 'supplier_return.credit', 'supplier_return', r.id, undefined, { amount, ref }); return { ok: true };
}));
router.post('/supplier-returns/:id/cancel', { perm: 'supplier_returns.manage', ok200: true }, (ctx) => tx(() => {
  const r = get('SELECT * FROM supplier_returns WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!r) throw notFound('Retour fournisseur');
  if (r.status !== 'sent') throw conflict('BAD_STATE', 'Seul un retour non avoiré peut être annulé');
  const reason = str(ctx.body.reason, 'motif', { required: true, min: 3, max: 200 });
  for (const l of all('SELECT * FROM supplier_return_lines WHERE return_id=?', r.id)) applyMovement({ ph: ctx.ph, batchId: l.batch_id, productId: l.product_id, type: 'supplier_return_cancel', qty: l.qty, bucket: l.bucket, reason, refType: 'supplier_return', refId: r.id, userId: ctx.user.id });
  run("UPDATE supplier_returns SET status='cancelled' WHERE id=?", r.id); audit(ctx, 'supplier_return.cancel', 'supplier_return', r.id, undefined, { reason }); return { ok: true };
}));

// Solde fournisseur = valeur des réceptions − avoirs obtenus − paiements
function supplierBalance(ph, sid) {
  const bought = get('SELECT COALESCE(SUM(l.qty * l.unit_cost),0) v FROM goods_receipt_lines l JOIN goods_receipts r ON r.id=l.receipt_id WHERE r.pharmacy_id=? AND r.supplier_id=?', ph, sid).v;
  const credits = get("SELECT COALESCE(SUM(credit_amount),0) v FROM supplier_returns WHERE pharmacy_id=? AND supplier_id=? AND status='credited'", ph, sid).v;
  const paid = get('SELECT COALESCE(SUM(amount),0) v FROM supplier_payments WHERE pharmacy_id=? AND supplier_id=?', ph, sid).v;
  return { bought, credits, paid, balance: bought - credits - paid };
}
router.get('/supplier-balances', { perm: 'suppliers.view' }, (ctx) => {
  const rows = all('SELECT id, name FROM suppliers ORDER BY name').map((s) => ({ supplier_id: s.id, supplier: s.name, ...supplierBalance(ctx.ph, s.id) })).filter((r) => r.bought || r.credits || r.paid);
  return ['csv', 'xlsx', 'pdf'].includes(ctx.query.format) ? sendCsv(ctx, 'soldes_fournisseurs', rows, ['supplier', 'bought', 'credits', 'paid', 'balance']) : { data: rows };
});
router.get('/suppliers/:id/statement', { perm: 'suppliers.view', needsPharmacy: true }, (ctx) => {
  const s = get('SELECT id,name FROM suppliers WHERE id=?', ctx.params.id); if (!s) throw notFound('Fournisseur');
  return { supplier: s, ...supplierBalance(ctx.ph, s.id), payments: all('SELECT id,amount,method,reference,created_at FROM supplier_payments WHERE pharmacy_id=? AND supplier_id=? ORDER BY id DESC LIMIT 100', ctx.ph, s.id), returns: all('SELECT id,number,status,credit_amount,credit_note_ref,created_at FROM supplier_returns WHERE pharmacy_id=? AND supplier_id=? ORDER BY id DESC LIMIT 100', ctx.ph, s.id) };
});
// Les paiements en espèces du tiroir-caisse ne passent pas par ici (utiliser « sortie de caisse » avec motif) : on évite un flux d'argent non rapproché.
router.post('/supplier-payments', { perm: 'supplier_payments.manage' }, (ctx) => tx(() => {
  const sid = int(ctx.body.supplier_id, 'fournisseur', { required: true, min: 1 }); if (!get('SELECT 1 FROM suppliers WHERE id=?', sid)) throw bad('VALIDATION', 'Fournisseur inconnu');
  const amount = int(ctx.body.amount, 'montant', { required: true, min: 1 }), method = oneOf(ctx.body.method || 'transfer', 'mode', ['transfer', 'cheque', 'card', 'other']);
  const bal = supplierBalance(ctx.ph, sid).balance;
  if (amount > bal) throw conflict('OVERPAYMENT', `Le paiement dépasse le solde dû (${bal})`, { balance: bal });
  const id = insert('INSERT INTO supplier_payments(pharmacy_id,supplier_id,amount,method,reference,user_id) VALUES (?,?,?,?,?,?)', ctx.ph, sid, amount, method, str(ctx.body.reference, 'référence', { max: 80 }), ctx.user.id);
  audit(ctx, 'supplier_payment.create', 'supplier', sid, undefined, { amount, method }); return { id, balance: bal - amount };
}));

// ================= ACOMPTES SUR COMMANDES =================
const orderValue = (orderId) => get('SELECT COALESCE(SUM(l.qty * p.sale_price),0) v FROM order_lines l JOIN products p ON p.id=l.product_id WHERE l.order_id=?', orderId).v;
router.get('/orders/:id/deposits', { perm: 'orders.view' }, (ctx) => {
  const o = get('SELECT id FROM customer_orders WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!o) throw notFound('Commande');
  const d = all('SELECT d.id,d.method,d.method_code,COALESCE(m.label,d.method) method_label,d.amount,d.status,d.created_at,CASE WHEN d.session_id IS NULL THEN 1 ELSE 0 END online FROM order_deposits d LEFT JOIN payment_methods m ON m.code=d.method_code WHERE d.order_id=? ORDER BY d.id', o.id);
  return { data: d, held: d.filter((x) => x.status === 'held').reduce((a, x) => a + x.amount, 0), order_value: orderValue(o.id) };
});
router.post('/orders/:id/deposit', { perm: 'sales.deposit' }, (ctx) => tx(() => {
  const o = get('SELECT * FROM customer_orders WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!o) throw notFound('Commande');
  if (!['pending', 'confirmed', 'preparing', 'ready'].includes(o.status)) throw conflict('BAD_STATE', 'Cette commande n\'accepte plus d\'acompte');
  const s = openSession(ctx); if (!s) throw conflict('NO_OPEN_CASH_SESSION', 'Ouvrez votre caisse pour encaisser un acompte');
  const amount = int(ctx.body.amount, 'montant', { required: true, min: 1 }), code = String(ctx.body.method || 'cash'), pm = get('SELECT code,kind FROM payment_methods WHERE code=? AND enabled=1 AND channel_pos=1', code); if (!pm) throw bad('VALIDATION', 'Mode de paiement invalide ou désactivé'); const method = pm.kind;
  const held = get("SELECT COALESCE(SUM(amount),0) v FROM order_deposits WHERE order_id=? AND status='held'", o.id).v;
  if (held + amount > orderValue(o.id)) throw conflict('DEPOSIT_EXCEEDS_TOTAL', 'Les acomptes ne peuvent pas dépasser la valeur de la commande');
  const id = insert('INSERT INTO order_deposits(order_id,method,method_code,amount,session_id,user_id) VALUES (?,?,?,?,?,?)', o.id, method, pm.code, amount, s.id, ctx.user.id);
  insert('INSERT INTO cash_movements(session_id,kind,method,amount,ref_type,ref_id,reason,user_id) VALUES (?,?,?,?,?,?,?,?)', s.id, 'deposit', method, amount, 'order_deposit', id, `Acompte ${o.number}`, ctx.user.id);
  audit(ctx, 'order.deposit', 'order', o.id, undefined, { amount, method }); return { id };
}));
router.post('/orders/:id/deposit/refund', { perm: 'sales.deposit', ok200: true }, (ctx) => tx(() => {
  const o = get('SELECT * FROM customer_orders WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!o) throw notFound('Commande');
  if (o.status === 'picked_up') throw conflict('BAD_STATE', 'Commande déjà retirée : l\'acompte est imputé à la vente');
  const reason = str(ctx.body.reason, 'motif', { required: true, min: 3, max: 200 });
  const s = openSession(ctx); if (!s && all("SELECT 1 FROM order_deposits WHERE order_id=? AND status='held' AND session_id IS NOT NULL", o.id).length) throw conflict('NO_OPEN_CASH_SESSION', 'Ouvrez votre caisse pour rembourser un acompte');
  let total = 0;
  for (const d of all("SELECT * FROM order_deposits WHERE order_id=? AND status='held'", o.id)) {
    run("UPDATE order_deposits SET status='refunded' WHERE id=?", d.id);
    if (!d.session_id) { total += d.amount; continue; } // acompte payé en ligne : remboursement à effectuer auprès du prestataire, aucun mouvement de caisse
    insert('INSERT INTO cash_movements(session_id,kind,method,amount,ref_type,ref_id,reason,user_id) VALUES (?,?,?,?,?,?,?,?)', s.id, 'deposit_refund', d.method, -d.amount, 'order_deposit', d.id, reason, ctx.user.id); total += d.amount;
  }
  if (!total) throw conflict('NO_DEPOSIT', 'Aucun acompte à rembourser');
  audit(ctx, 'order.deposit_refund', 'order', o.id, undefined, { total, reason }); return { refunded: total };
}));

// ================= SOLDES CLIENTS (ventes à crédit) =================
const dueSales = (cid, ph) => all('SELECT * FROM sales WHERE customer_id=? AND pharmacy_id=? AND paid < total ORDER BY id', cid, ph).map((s) => ({ id: s.id, number: s.number, total: s.total, paid: s.paid, due: saleBalance(s), created_at: s.created_at })).filter((s) => s.due > 0);
router.get('/customers/:id/balance', { perm: 'customers.view' }, (ctx) => {
  const c = get('SELECT id,name FROM customers WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!c) throw notFound('Client');
  const sales = dueSales(c.id, ctx.ph); return { customer: c, balance: sales.reduce((a, s) => a + s.due, 0), credit_limit: getSetting(ctx.ph, 'credit_limit', 0), sales };
});
router.post('/customers/:id/payments', { perm: 'sales.create' }, (ctx) => tx(() => {
  const c = get('SELECT id,name FROM customers WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!c) throw notFound('Client');
  const s = openSession(ctx); if (!s) throw conflict('NO_OPEN_CASH_SESSION', 'Ouvrez votre caisse pour encaisser');
  let left = int(ctx.body.amount, 'montant', { required: true, min: 1 }); const method = oneOf(ctx.body.method || 'cash', 'mode', METHODS);
  const sales = dueSales(c.id, ctx.ph), due = sales.reduce((a, x) => a + x.due, 0);
  if (left > due) throw conflict('OVERPAYMENT', `Le montant dépasse le solde dû (${due})`, { balance: due });
  const applied = [];
  for (const sl of sales) {
    if (left <= 0) break; const a = Math.min(left, sl.due); left -= a;
    run('UPDATE sales SET paid = paid + ? WHERE id=?', a, sl.id); insert('INSERT INTO payments(sale_id,method,amount) VALUES (?,?,?)', sl.id, method, a);
    insert('INSERT INTO cash_movements(session_id,kind,method,amount,ref_type,ref_id,reason,user_id) VALUES (?,?,?,?,?,?,?,?)', s.id, 'balance_payment', method, a, 'sale', sl.id, `Règlement ${sl.number}`, ctx.user.id); applied.push({ sale: sl.number, amount: a });
  }
  audit(ctx, 'customer.balance_payment', 'customer', c.id, undefined, { amount: due - (due - applied.reduce((x, y) => x + y.amount, 0)), method }); return { applied, balance: due - applied.reduce((x, y) => x + y.amount, 0) };
}));
router.get('/receivables', { perm: 'accounting.view' }, (ctx) => {
  const ids = all('SELECT DISTINCT customer_id id FROM sales WHERE pharmacy_id=? AND customer_id IS NOT NULL AND paid < total', ctx.ph);
  const rows = ids.map((x) => { const c = get('SELECT id,name,phone FROM customers WHERE id=?', x.id); const s = dueSales(x.id, ctx.ph); return { customer_id: c.id, name: c.name, phone: c.phone, balance: s.reduce((a, y) => a + y.due, 0), oldest: s[0]?.created_at }; }).filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance);
  return ['csv', 'xlsx', 'pdf'].includes(ctx.query.format) ? sendCsv(ctx, 'creances_clients', rows, ['name', 'phone', 'balance', 'oldest']) : { total: rows.reduce((a, r) => a + r.balance, 0), data: rows };
});

// ================= CLÔTURE DE PÉRIODE & RAPPORT Z =================
router.get('/accounting/locks', { perm: 'accounting.view' }, (ctx) => ({ locked_until: periodLockedUntil(ctx.ph), data: all('SELECT l.*, u.name user_name FROM period_locks l LEFT JOIN users u ON u.id=l.created_by WHERE l.pharmacy_id=? ORDER BY l.id DESC', ctx.ph) }));
// Verrouillage irréversible par l'application : plus aucun remboursement/avoir sur les ventes de la période. Pas de déverrouillage (une correction passe par une écriture dans la période ouverte).
router.post('/accounting/locks', { perm: 'accounting.lock' }, (ctx) => tx(() => {
  const until = date(ctx.body.locked_until, 'date de clôture', { required: true }), cur = periodLockedUntil(ctx.ph);
  if (until >= todaySql()) throw conflict('PERIOD_OPEN', 'On ne peut clôturer que des jours révolus (avant aujourd\'hui)');
  if (cur && until <= cur) throw conflict('ALREADY_LOCKED', `Période déjà clôturée jusqu'au ${cur}`);
  const open = get("SELECT COUNT(*) n FROM cash_sessions WHERE pharmacy_id=? AND status='open' AND date(opened_at) <= ?", ctx.ph, until).n;
  if (open) throw conflict('OPEN_CASH_SESSIONS', `${open} session(s) de caisse encore ouvertes sur la période : fermez-les d'abord`);
  const id = insert('INSERT INTO period_locks(pharmacy_id,locked_until,note,created_by) VALUES (?,?,?,?)', ctx.ph, until, str(ctx.body.note, 'note', { max: 300 }), ctx.user.id);
  audit(ctx, 'accounting.lock', 'period_lock', id, { locked_until: cur }, { locked_until: until }); return { id, locked_until: until };
}));
function zReport(ph, day) {
  const from = day + ' 00:00:00', to = day + ' 23:59:59';
  const sales = get('SELECT COUNT(*) tickets, COALESCE(SUM(total),0) gross, COALESCE(SUM(discount),0) discount, COALESCE(SUM(tax_total),0) tax, COALESCE(SUM(total-paid),0) on_credit FROM sales WHERE pharmacy_id=? AND created_at BETWEEN ? AND ?', ph, from, to);
  const refunds = get('SELECT COUNT(*) n, COALESCE(SUM(r.amount),0) amount FROM refunds r JOIN sales s ON s.id=r.sale_id WHERE s.pharmacy_id=? AND r.created_at BETWEEN ? AND ?', ph, from, to);
  const cash = all('SELECT m.kind, m.method, SUM(m.amount) amount, COUNT(*) n FROM cash_movements m JOIN cash_sessions cs ON cs.id=m.session_id WHERE cs.pharmacy_id=? AND m.created_at BETWEEN ? AND ? GROUP BY m.kind, m.method ORDER BY m.kind, m.method', ph, from, to);
  const sessions = all('SELECT cs.id, u.name cashier, cs.status, cs.expected_cash, cs.counted_cash, cs.difference FROM cash_sessions cs JOIN users u ON u.id=cs.user_id WHERE cs.pharmacy_id=? AND cs.opened_at BETWEEN ? AND ?', ph, from, to);
  const vat = all('SELECT l.tax_rate, SUM(l.line_total * (l.qty - l.qty_refunded) / l.qty) ttc FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.pharmacy_id=? AND s.created_at BETWEEN ? AND ? GROUP BY l.tax_rate', ph, from, to).map((x) => { const ttc = Math.round(x.ttc), ht = Math.round(ttc / (1 + x.tax_rate / 100)); return { tax_rate: x.tax_rate, ht, tax: ttc - ht, ttc }; });
  return { date: day, sales, refunds, cash_movements: cash, sessions, vat, net: sales.gross - refunds.amount, locked: (periodLockedUntil(ph) || '') >= day };
}
router.get('/accounting/z-report', { perm: 'accounting.view' }, (ctx) => {
  const day = date(ctx.query.date || todaySql(), 'date', { required: true }); const z = zReport(ctx.ph, day);
  if (!['csv', 'xlsx', 'pdf'].includes(ctx.query.format)) return z;
  const rows = [{ section: 'Ventes', label: 'Tickets', amount: z.sales.tickets }, { section: 'Ventes', label: 'Brut TTC', amount: z.sales.gross }, { section: 'Ventes', label: 'Remises', amount: z.sales.discount }, { section: 'Ventes', label: 'TVA', amount: z.sales.tax },
    { section: 'Ventes', label: 'Remboursements', amount: -z.refunds.amount }, { section: 'Ventes', label: 'Net', amount: z.net }, { section: 'Ventes', label: 'Laissé à crédit', amount: z.sales.on_credit },
    ...z.vat.map((v) => ({ section: 'TVA', label: `Taux ${v.tax_rate}% (HT ${v.ht} / TVA ${v.tax})`, amount: v.ttc })),
    ...z.cash_movements.map((m) => ({ section: 'Caisse', label: `${m.kind} · ${m.method}`, amount: m.amount })),
    ...z.sessions.map((s) => ({ section: 'Sessions', label: `#${s.id} ${s.cashier} (${s.status}) écart`, amount: s.difference ?? 0 }))];
  const dec = get('SELECT currency_decimals d FROM pharmacies WHERE id=?', ctx.ph).d;
  ctx.query.from = day; ctx.query.to = day; // sous-titre du PDF
  return sendCsv(ctx, 'z_report', rows.map((r) => ({ ...r, amount: r.label === 'Tickets' ? r.amount * Math.pow(10, dec) : r.amount })), ['section', 'label', 'amount']);
});

// ================= TICKET PDF =================
router.get('/sales/:id/pdf', { perm: 'sales.view' }, (ctx) => {
  const s = getSale(Number(ctx.params.id), ctx.ph); if (!s) throw notFound('Vente');
  audit(ctx, 'sale.print', 'sale', s.id);
  ctx.res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${s.number}.pdf"` }); ctx.res.end(pdfReceipt(s));
});
