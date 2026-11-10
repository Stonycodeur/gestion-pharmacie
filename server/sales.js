// Ventes (POS), remboursements, caisse, ordonnances : logique transactionnelle.
import { get, all, run, insert, tx, nextNumber, getSetting } from './db.js';
import { HttpError, bad, conflict, forbidden, int, todaySql } from './util.js';
import { allocate, applyMovement } from './stock.js';
import { audit, can, notify } from './http.js';
import { verifyPassword } from './security.js';
import { userHas } from './rbac.js';

const METHODS = ['cash', 'card', 'mobile', 'transfer', 'wallet'];
const taxIn = (gross, rate) => gross - Math.round(gross / (1 + rate / 100)); // prix TTC → part de taxe

// Solde dû d'une vente = (total − valeur des retours) − encaissé, jamais négatif
export function saleBalance(sale) {
  const r = get('SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE sale_id=?', sale.id).v;
  return Math.max(0, sale.total - r - sale.paid);
}
export function customerBalance(customerId, ph) {
  return all("SELECT id,total,paid FROM sales WHERE customer_id=? AND pharmacy_id=? AND paid < total", customerId, ph).reduce((a, s) => a + saleBalance(s), 0);
}
export function periodLockedUntil(ph) { return get('SELECT MAX(locked_until) d FROM period_locks WHERE pharmacy_id=?', ph).d; }

export function openSession(ctx) {
  return get("SELECT * FROM cash_sessions WHERE pharmacy_id=? AND user_id=? AND status='open'", ctx.ph, ctx.user.id);
}

// ---------- Ordonnances : statut recalculé depuis les quantités délivrées ----------
export function recomputePrescriptionStatus(presId, userId) {
  const p = get('SELECT * FROM prescriptions WHERE id=?', presId);
  if (!p || !['validated', 'partially_delivered', 'delivered'].includes(p.status)) return;
  const lines = all('SELECT qty_prescribed, qty_delivered FROM prescription_lines WHERE prescription_id=?', presId);
  const total = lines.reduce((a, l) => a + l.qty_prescribed, 0), done = lines.reduce((a, l) => a + l.qty_delivered, 0);
  const next = done <= 0 ? 'validated' : done >= total ? 'delivered' : 'partially_delivered';
  if (next !== p.status) {
    run("UPDATE prescriptions SET status=?, updated_at=datetime('now') WHERE id=?", next, presId);
    insert('INSERT INTO prescription_reviews(prescription_id,from_status,to_status,reason,user_id) VALUES (?,?,?,?,?)', presId, p.status, next, 'Mise à jour automatique selon les délivrances', userId);
  }
}

// ---------- Vente ----------
export function createSale(ctx, b, { fromOrder = null, deposits = [] } = {}) {
  const ph = ctx.ph, user = ctx.user;
  if (!Array.isArray(b.lines) || !b.lines.length) throw bad('VALIDATION', 'Le panier est vide');
  if (b.lines.length > 100) throw bad('VALIDATION', 'Trop de lignes');
  const payments = Array.isArray(b.payments) ? b.payments : [];
  // Vente saisie hors connexion : l'heure d'origine est conservée à titre d'information (jamais utilisée pour dater la comptabilité)
  let offlineAt = null;
  if (b.offline_at != null) {
    const d = new Date(b.offline_at); const age = Date.now() - d.getTime();
    if (Number.isNaN(d.getTime()) || age < -5 * 60000 || age > 7 * 864e5) throw bad('VALIDATION', 'Heure hors-ligne invalide (7 jours maximum)');
    offlineAt = d.toISOString().slice(0, 19).replace('T', ' ');
  }
  return tx(() => {
    if (b.idempotency_key) {
      const dup = get('SELECT id FROM sales WHERE idempotency_key=?', String(b.idempotency_key));
      if (dup) return { ...getSale(dup.id, ph), duplicate: true };
    }
    const session = openSession(ctx);
    if (!session) throw conflict('NO_OPEN_CASH_SESSION', 'Ouvrez votre caisse avant de vendre');
    const lockD = periodLockedUntil(ph);
    if (lockD && lockD >= new Date().toISOString().slice(0, 10)) throw conflict('PERIOD_LOCKED', `Période clôturée jusqu'au ${lockD}`);
    const pharmacy = get('SELECT * FROM pharmacies WHERE id=?', ph);
    const customerId = b.customer_id ? int(b.customer_id, 'client') : null;
    if (customerId && !get('SELECT 1 FROM customers WHERE id=? AND pharmacy_id=?', customerId, ph)) throw bad('VALIDATION', 'Client inconnu');

    // 1) agréger par produit et valider contrôle ordonnance / permissions
    const wanted = new Map();
    for (const l of b.lines) {
      const pid = int(l.product_id, 'produit', { required: true, min: 1 });
      const qty = int(l.qty, 'quantité', { required: true, min: 1, max: 100000 });
      const key = `${pid}:${l.batch_id ?? ''}`;
      const cur = wanted.get(key) || { product_id: pid, qty: 0, discount: 0, batch_id: l.batch_id ? int(l.batch_id, 'lot') : null };
      cur.qty += qty; cur.discount += int(l.discount ?? 0, 'remise', { min: 0 }); wanted.set(key, cur);
    }
    const presId = b.prescription_id ? int(b.prescription_id, 'ordonnance') : null;
    const pres = presId ? get('SELECT * FROM prescriptions WHERE id=? AND pharmacy_id=?', presId, ph) : null;
    if (presId && !pres) throw bad('VALIDATION', 'Ordonnance inconnue');
    const rxNeeded = new Map(); // product_id -> qty à imputer sur l'ordonnance
    const maxDisc = getSetting(ph, 'max_discount_percent', 10);
    const prepared = [];
    for (const w of wanted.values()) {
      const p = get('SELECT * FROM products WHERE id=?', w.product_id);
      if (!p || p.status !== 'active') throw bad('PRODUCT_INACTIVE', `Produit ${w.product_id} introuvable ou inactif`);
      if (p.rx_status !== 'free') {
        if (!can(user, 'sales.dispense_rx')) throw forbidden(`« ${p.name} » nécessite une délivrance par un professionnel habilité`, 'RX_PERMISSION');
        if (p.rx_status === 'controlled' && !can(user, 'sales.dispense_controlled')) throw forbidden(`« ${p.name} » est un produit contrôlé : pharmacien requis`, 'CONTROLLED_PERMISSION');
        if (!pres) throw conflict('PRESCRIPTION_REQUIRED', `« ${p.name} » ne peut être délivré qu'avec une ordonnance validée`, { product_id: p.id });
        if (!['validated', 'partially_delivered'].includes(pres.status)) throw conflict('PRESCRIPTION_NOT_VALIDATED', `L'ordonnance ${pres.number} n'est pas validée par un pharmacien (statut : ${pres.status})`);
        if (pres.valid_until && pres.valid_until < todaySql()) throw conflict('PRESCRIPTION_EXPIRED', `L'ordonnance ${pres.number} a expiré le ${pres.valid_until}`);
        rxNeeded.set(p.id, (rxNeeded.get(p.id) || 0) + w.qty);
      }
      if (w.discount > 0) {
        if (!can(user, 'sales.discount')) throw forbidden('Remise non autorisée', 'DISCOUNT_PERMISSION');
        if (w.discount > Math.floor((p.sale_price * w.qty * maxDisc) / 100)) throw conflict('DISCOUNT_TOO_HIGH', `Remise supérieure à ${maxDisc}% sur « ${p.name} »`);
      }
      const alloc = w.batch_id
        ? (() => { const bt = get('SELECT * FROM batches WHERE id=? AND product_id=?', w.batch_id, p.id); if (!bt) throw bad('VALIDATION', 'Lot invalide'); return allocate(ph, p.id, w.qty, { onlyBatches: [bt.id] }); })()
        : allocate(ph, p.id, w.qty, {});
      prepared.push({ p, w, alloc });
    }
    for (const [pid, q] of rxNeeded) {
      const pl = get('SELECT * FROM prescription_lines WHERE prescription_id=? AND product_id=?', presId, pid);
      if (!pl) throw conflict('NOT_ON_PRESCRIPTION', `Le produit ${get('SELECT name FROM products WHERE id=?', pid).name} ne figure pas sur l'ordonnance`);
      if (pl.qty_delivered + q > pl.qty_prescribed) throw conflict('PRESCRIPTION_QTY_EXCEEDED', `Quantité supérieure au reliquat de l'ordonnance (${pl.qty_prescribed - pl.qty_delivered} restant)`);
    }

    // 2) totaux
    let subtotal = 0, discount = 0, tax = 0; const lines = [];
    for (const { p, w, alloc } of prepared) {
      let discLeft = w.discount;
      alloc.forEach((a, i) => {
        const gross = p.sale_price * a.qty;
        const d = i === alloc.length - 1 ? discLeft : Math.min(discLeft, Math.round((w.discount * a.qty) / w.qty));
        discLeft -= d;
        const lt = gross - d;
        subtotal += gross; discount += d; tax += taxIn(lt, p.tax_rate);
        lines.push({ p, batch: a.batch, qty: a.qty, unit_price: p.sale_price, discount: d, tax_rate: p.tax_rate, unit_cost: a.batch.unit_cost || p.purchase_price, line_total: lt });
      });
    }
    const total = subtotal - discount;

    // 3) paiements : la somme doit couvrir le total ; seul l'espèces peut donner lieu à rendu de monnaie
    const pays = payments.map((x) => { const pm = get('SELECT code,kind FROM payment_methods WHERE code=? AND enabled=1 AND channel_pos=1', String(x.method)); if (!pm && !METHODS.includes(x.method)) throw bad('VALIDATION', 'Mode de paiement invalide ou désactivé'); return { method: pm ? pm.kind : x.method, method_code: pm ? pm.code : x.method, amount: int(x.amount, 'montant', { required: true, min: 1 }) }; });
    if (b.expected_total != null && Number(b.expected_total) !== total) throw conflict('TOTAL_MISMATCH', `Le total a changé depuis la saisie (${b.expected_total} → ${total}) : les prix ont été modifiés`, { expected: Number(b.expected_total), actual: total });
    const prepaid = deposits.reduce((a, d) => a + d.amount, 0);
    if (prepaid > total) throw conflict('DEPOSIT_EXCEEDS_TOTAL', 'L\'acompte dépasse le total : remboursez la différence avant le retrait');
    const paidNow = pays.reduce((a, x) => a + x.amount, 0);
    const remaining = total - prepaid - paidNow;
    if (remaining > 0) {
      // Vente à crédit / reste à payer : désactivée par défaut (credit_limit = 0), réservée aux clients identifiés et aux profils habilités
      const limit = getSetting(ph, 'credit_limit', 0);
      if (!(b.allow_credit === true && customerId && can(user, 'sales.credit') && limit > 0)) throw conflict('UNDERPAID', `Paiement insuffisant (reste ${remaining})`, { remaining });
      const owed = customerBalance(customerId, ph) + remaining;
      if (owed > limit) throw conflict('CREDIT_LIMIT', `Plafond de crédit dépassé (${owed} > ${limit})`, { limit, owed });
    }
    const change = remaining < 0 ? -remaining : 0;
    const cashIn = pays.filter((x) => x.method === 'cash').reduce((a, x) => a + x.amount, 0);
    if (change > cashIn) throw conflict('OVERPAID', 'Un trop-perçu n\'est rendu qu\'en espèces');
    let toTrim = change;
    for (const x of pays) if (x.method === 'cash' && toTrim > 0) { const t = Math.min(x.amount, toTrim); x.amount -= t; toTrim -= t; }
    const realPays = pays.filter((x) => x.amount > 0);
    const paidRecorded = prepaid + realPays.reduce((a, x) => a + x.amount, 0);

    // 4) écritures
    const number = nextNumber(ph, 'sale', pharmacy.invoice_prefix || 'F');
    const saleId = insert('INSERT INTO sales(pharmacy_id,number,customer_id,cashier_id,cash_session_id,prescription_id,order_id,subtotal,discount,tax_total,total,paid,change_given,idempotency_key,offline_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ph, number, customerId, user.id, session.id, presId, fromOrder, subtotal, discount, tax, total, paidRecorded, change, b.idempotency_key ? String(b.idempotency_key) : null, offlineAt);
    for (const l of lines) {
      insert('INSERT INTO sale_lines(sale_id,product_id,batch_id,qty,unit_price,discount,tax_rate,unit_cost,line_total) VALUES (?,?,?,?,?,?,?,?,?)', saleId, l.p.id, l.batch.id, l.qty, l.unit_price, l.discount, l.tax_rate, l.unit_cost, l.line_total);
      applyMovement({ ph, batchId: l.batch.id, productId: l.p.id, type: 'sale', qty: -l.qty, refType: 'sale', refId: saleId, userId: user.id });
      if (l.p.rx_status !== 'free') insert('INSERT INTO dispensing_records(prescription_id,sale_id,product_id,batch_id,qty,pharmacist_id) VALUES (?,?,?,?,?,?)', presId, saleId, l.p.id, l.batch.id, l.qty, user.id);
    }
    for (const x of realPays) {
      insert('INSERT INTO payments(sale_id,method,method_code,amount) VALUES (?,?,?,?)', saleId, x.method, x.method_code ?? x.method, x.amount);
      insert('INSERT INTO cash_movements(session_id,kind,method,amount,ref_type,ref_id,user_id) VALUES (?,?,?,?,?,?,?)', session.id, 'sale', x.method, x.amount, 'sale', saleId, user.id);
    }
    for (const d of deposits) { // acompte déjà encaissé en caisse lors du dépôt : on le rattache à la vente sans nouveau mouvement d'espèces
      insert('INSERT INTO payments(sale_id,method,method_code,amount) VALUES (?,?,?,?)', saleId, d.method, d.method_code ?? d.method, d.amount); run("UPDATE order_deposits SET status='applied' WHERE id=?", d.id);
    }
    for (const [pid, q] of rxNeeded) run('UPDATE prescription_lines SET qty_delivered = qty_delivered + ? WHERE prescription_id=? AND product_id=?', q, presId, pid);
    if (presId && rxNeeded.size) recomputePrescriptionStatus(presId, user.id);
    if (customerId) {
      const perUnit = getSetting(ph, 'loyalty_points_per_unit', 1);
      const pts = Math.floor((total / Math.pow(10, pharmacy.currency_decimals)) * perUnit);
      if (pts > 0) { run('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id=?', pts, customerId); insert('INSERT INTO loyalty_transactions(customer_id,sale_id,points,kind) VALUES (?,?,?,?)', customerId, saleId, pts, 'earn'); }
    }
    audit(ctx, 'sale.create', 'sale', saleId, undefined, { number, total, lines: lines.length, prescription_id: presId });
    return getSale(saleId, ph);
  });
}

export function getSale(id, ph) {
  const sale = get(`SELECT s.*, u.name cashier_name, c.name customer_name FROM sales s JOIN users u ON u.id=s.cashier_id LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=? AND s.pharmacy_id=?`, id, ph);
  if (!sale) return null;
  sale.lines = all(`SELECT l.*, p.name product_name, p.sku, bt.batch_no, bt.exp_date FROM sale_lines l JOIN products p ON p.id=l.product_id JOIN batches bt ON bt.id=l.batch_id WHERE l.sale_id=?`, id);
  sale.payments = all('SELECT p.method, p.method_code, COALESCE(m.label, p.method) method_label, p.amount FROM payments p LEFT JOIN payment_methods m ON m.code=p.method_code WHERE p.sale_id=?', id);
  sale.refunds = all('SELECT id, number, amount, method, reason, created_at FROM refunds WHERE sale_id=?', id);
  sale.pharmacy = get('SELECT name,address,phone,currency,currency_decimals,legal_notice FROM pharmacies WHERE id=?', ph);
  sale.balance_due = saleBalance(sale);
  return sale;
}

// ---------- Retour / remboursement ----------
export function refundSale(ctx, saleId, b) {
  const ph = ctx.ph, user = ctx.user;
  const reason = (b.reason || '').trim();
  if (reason.length < 3) throw bad('VALIDATION', 'Le motif du remboursement est obligatoire');
  const method = METHODS.includes(b.method) ? b.method : 'cash';
  return tx(() => {
    const sale = get('SELECT * FROM sales WHERE id=? AND pharmacy_id=?', saleId, ph);
    if (!sale) throw new HttpError(404, 'NOT_FOUND', 'Vente introuvable');
    if (!Array.isArray(b.lines) || !b.lines.length) throw bad('VALIDATION', 'Aucune ligne à retourner');
    const lock = periodLockedUntil(ph);
    if (lock && sale.created_at.slice(0, 10) <= lock) throw conflict('PERIOD_LOCKED', `Période clôturée jusqu'au ${lock} : émettre une écriture dans la période ouverte (avoir) n'est pas possible pour cette vente`);
    const session = openSession(ctx);
    let amount = 0; const items = [];
    for (const r of b.lines) {
      const sl = get('SELECT * FROM sale_lines WHERE id=? AND sale_id=?', int(r.sale_line_id, 'ligne', { required: true }), saleId);
      if (!sl) throw bad('VALIDATION', 'Ligne de vente invalide');
      const q = int(r.qty, 'quantité', { required: true, min: 1 });
      if (sl.qty_refunded + q > sl.qty) throw conflict('REFUND_EXCEEDS', 'Quantité retournée supérieure à la quantité vendue');
      const part = (n) => Math.round((sl.line_total * n) / sl.qty);
      const amt = part(sl.qty_refunded + q) - part(sl.qty_refunded);
      amount += amt; items.push({ sl, q, amt });
    }
    // seconde validation au-delà du seuil (séparation des tâches)
    const threshold = getSetting(ph, 'refund_approval_threshold', 50000);
    let approvedBy = null;
    if (amount > threshold && !can(user, 'sales.refund_approve')) {
      const a = b.approver;
      const au = a?.email ? get("SELECT * FROM users WHERE email=? AND status='active' AND (pharmacy_id=? OR pharmacy_id IS NULL)", String(a.email).toLowerCase(), ph) : null;
      if (!au || au.id === user.id || !userHas(au.id, au.role_code, 'sales.refund_approve') || !verifyPassword(String(a.password || ''), au.password_hash))
        throw new HttpError(403, 'APPROVAL_REQUIRED', `Remboursement > ${threshold} : validation d'un responsable requise`, { threshold });
      approvedBy = au.id;
    }
    // Si la vente n'est pas intégralement payée (crédit), le retour réduit d'abord le solde dû : seul l'excédent est rendu en argent
    const prevValue = get('SELECT COALESCE(SUM(amount),0) v, COALESCE(SUM(cash_amount),0) c FROM refunds WHERE sale_id=?', saleId);
    const cashTotalAfter = Math.max(0, sale.paid - (sale.total - (prevValue.v + amount)));
    const cashNow = Math.max(0, cashTotalAfter - prevValue.c);
    if (cashNow > 0 && !session) throw conflict('NO_OPEN_CASH_SESSION', 'Ouvrez votre caisse pour rembourser');
    const number = nextNumber(ph, 'refund', 'AV');
    const refundId = insert('INSERT INTO refunds(sale_id,number,amount,cash_amount,method,reason,user_id,approved_by) VALUES (?,?,?,?,?,?,?,?)', saleId, number, amount, cashNow, method, reason, user.id, approvedBy);
    for (const { sl, q, amt } of items) {
      insert('INSERT INTO refund_lines(refund_id,sale_line_id,qty,amount) VALUES (?,?,?,?)', refundId, sl.id, q, amt);
      run('UPDATE sale_lines SET qty_refunded = qty_refunded + ? WHERE id=?', q, sl.id);
      // Sécurité : le produit retourné ne retourne PAS en stock vendable, il passe en quarantaine jusqu'à contrôle d'un pharmacien.
      applyMovement({ ph, batchId: sl.batch_id, productId: sl.product_id, type: 'customer_return', qty: q, bucket: 'quarantine', reason, refType: 'refund', refId: refundId, userId: user.id });
      if (sale.prescription_id) {
        const prod = get('SELECT rx_status FROM products WHERE id=?', sl.product_id);
        if (prod.rx_status !== 'free') run('UPDATE prescription_lines SET qty_delivered = MAX(0, qty_delivered - ?) WHERE prescription_id=? AND product_id=?', q, sale.prescription_id, sl.product_id);
      }
    }
    if (sale.prescription_id) recomputePrescriptionStatus(sale.prescription_id, user.id);
    if (cashNow > 0) insert('INSERT INTO cash_movements(session_id,kind,method,amount,ref_type,ref_id,reason,user_id) VALUES (?,?,?,?,?,?,?,?)', session.id, 'refund', method, -cashNow, 'refund', refundId, reason, user.id);
    const all2 = all('SELECT qty, qty_refunded FROM sale_lines WHERE sale_id=?', saleId);
    const st = all2.every((l) => l.qty_refunded >= l.qty) ? 'refunded' : 'partially_refunded';
    run('UPDATE sales SET status=? WHERE id=?', st, saleId);
    if (sale.customer_id) {
      const dec = get('SELECT currency_decimals d FROM pharmacies WHERE id=?', ph).d;
      const pts = Math.min(get('SELECT loyalty_points p FROM customers WHERE id=?', sale.customer_id).p, Math.floor((amount / Math.pow(10, dec)) * getSetting(ph, 'loyalty_points_per_unit', 1)));
      if (pts > 0) { run('UPDATE customers SET loyalty_points = loyalty_points - ? WHERE id=?', pts, sale.customer_id); insert('INSERT INTO loyalty_transactions(customer_id,sale_id,points,kind) VALUES (?,?,?,?)', sale.customer_id, saleId, -pts, 'refund'); }
    }
    audit(ctx, 'sale.refund', 'sale', saleId, undefined, { refund: number, amount, reason, approvedBy });
    return { id: refundId, number, amount, cash_returned: cashNow, sale: getSale(saleId, ph) };
  });
}

// ---------- Caisse ----------
export function cashExpected(sessionId) {
  const s = get('SELECT opening_float FROM cash_sessions WHERE id=?', sessionId);
  const m = get("SELECT COALESCE(SUM(amount),0) t FROM cash_movements WHERE session_id=? AND method='cash'", sessionId).t;
  return s.opening_float + m;
}
export function sessionSummary(sessionId) {
  const byMethod = all("SELECT method, SUM(amount) total FROM cash_movements WHERE session_id=? AND kind IN ('sale','refund','deposit','deposit_refund','balance_payment') GROUP BY method", sessionId);
  const sales = get("SELECT COUNT(*) n FROM sales WHERE cash_session_id=?", sessionId).n;
  return { expected_cash: cashExpected(sessionId), by_method: byMethod, sales };
}
export { notify };
