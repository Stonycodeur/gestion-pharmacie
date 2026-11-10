// Comptabilité : plan comptable, écritures AUTOMATIQUES dérivées des opérations (ventes, encaissements, retours, achats, règlements, acomptes, pertes)
// et écritures MANUELLES (saisies, extournables). Les montants sont TTC (la TVA sur achats n'est pas déductible automatiquement : saisir une écriture manuelle).
// Les écritures automatiques sont recalculées à la demande depuis les pièces d'origine : elles ne peuvent donc jamais diverger des opérations.
import { get, all, run, insert } from './db.js';

export const CHART = [
  ['101', 'Capital et apports', 'equity'], ['110', 'Report à nouveau', 'equity'], ['119', 'Résultat reporté / ajustements', 'equity'],
  ['31', 'Stock de marchandises', 'asset'], ['411', 'Clients (créances)', 'asset'], ['4191', 'Acomptes reçus des clients', 'liability'], ['401', 'Fournisseurs', 'liability'],
  ['4456', 'TVA déductible', 'asset'], ['4457', 'TVA collectée', 'liability'], ['431', 'Organismes sociaux (CNSS)', 'liability'], ['421', 'Personnel — rémunérations dues', 'liability'], ['164', 'Emprunts', 'liability'],
  ['512', 'Banque, TPE et paiements en ligne', 'asset'], ['531', 'Caisse (espèces)', 'asset'], ['215', 'Matériel et agencements', 'asset'],
  ['607', 'Coût des marchandises vendues', 'expense'], ['6571', 'Pertes, casse et péremptions', 'expense'], ['613', 'Loyers', 'expense'], ['614', 'Charges locatives et énergie', 'expense'], ['621', 'Salaires et charges sociales', 'expense'],
  ['622', 'Honoraires', 'expense'], ['625', 'Déplacements et livraisons', 'expense'], ['626', 'Télécom et informatique', 'expense'], ['627', 'Frais bancaires et commissions de paiement', 'expense'], ['635', 'Impôts et taxes', 'expense'], ['658', 'Charges diverses', 'expense'], ['681', 'Dotations aux amortissements', 'expense'],
  ['707', 'Ventes de marchandises', 'income'], ['709', 'Retours et remises sur ventes', 'income'], ['7581', 'Écarts d\'inventaire (gains)', 'income'], ['758', 'Produits divers', 'income'],
];
export function ensureChart(ph) {
  if (get('SELECT 1 FROM acc_accounts WHERE pharmacy_id=? LIMIT 1', ph)) return;
  for (const [code, label, type] of CHART) run('INSERT INTO acc_accounts(pharmacy_id,code,label,type,is_system) VALUES (?,?,?,?,1)', ph, code, label, type);
}
const cashAcc = (kind) => (kind === 'cash' ? '531' : '512');
const d10 = (s) => String(s).slice(0, 10);

// Écritures automatiques de la période [from, to] (dates AAAA-MM-JJ incluses)
export function derive(ph, from, to) {
  const lo = from + ' 00:00:00', hi = to + ' 23:59:59'; const out = []; const push = (date, source, ref, label, lines) => { const ls = lines.filter((l) => l.d || l.c); if (ls.length) out.push({ date: d10(date), source, ref, label, lines: ls }); };
  const sales = all('SELECT s.id,s.number,s.created_at,s.total,s.tax_total, (SELECT COALESCE(SUM(l.qty*l.unit_cost),0) FROM sale_lines l WHERE l.sale_id=s.id) cost FROM sales s WHERE s.pharmacy_id=? AND s.created_at BETWEEN ? AND ?', ph, lo, hi);
  for (const s of sales) {
    push(s.created_at, 'vente', s.number, `Vente ${s.number}`, [{ a: '411', d: s.total }, { a: '707', c: s.total - s.tax_total }, { a: '4457', c: s.tax_total }]);
    push(s.created_at, 'vente', s.number, `Coût des marchandises ${s.number}`, [{ a: '607', d: s.cost }, { a: '31', c: s.cost }]);
  }
  for (const p of all('SELECT p.amount,p.method,p.created_at,s.number FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.pharmacy_id=? AND p.created_at BETWEEN ? AND ?', ph, lo, hi))
    push(p.created_at, 'encaissement', p.number, `Encaissement ${p.number} (${p.method})`, [{ a: cashAcc(p.method), d: p.amount }, { a: '411', c: p.amount }]);
  for (const r of all('SELECT r.id,r.number,r.amount,r.cash_amount,r.created_at, (SELECT COALESCE(SUM(rl.amount*sl.tax_rate/(100.0+sl.tax_rate)),0) FROM refund_lines rl JOIN sale_lines sl ON sl.id=rl.sale_line_id WHERE rl.refund_id=r.id) vat, (SELECT COALESCE(SUM(rl.qty*sl.unit_cost),0) FROM refund_lines rl JOIN sale_lines sl ON sl.id=rl.sale_line_id WHERE rl.refund_id=r.id) cost FROM refunds r JOIN sales s ON s.id=r.sale_id WHERE s.pharmacy_id=? AND r.created_at BETWEEN ? AND ?', ph, lo, hi)) {
    const vat = Math.round(r.vat); push(r.created_at, 'retour', r.number, `Avoir client ${r.number}`, [{ a: '709', d: r.amount - vat }, { a: '4457', d: vat }, { a: '531', c: r.cash_amount }, { a: '411', c: r.amount - r.cash_amount }]);
    push(r.created_at, 'retour', r.number, `Retour en stock ${r.number}`, [{ a: '31', d: Math.round(r.cost) }, { a: '607', c: Math.round(r.cost) }]);
  }
  for (const g of all('SELECT g.number,g.created_at, (SELECT COALESCE(SUM(l.qty*l.unit_cost),0) FROM goods_receipt_lines l WHERE l.receipt_id=g.id) v FROM goods_receipts g WHERE g.pharmacy_id=? AND g.created_at BETWEEN ? AND ?', ph, lo, hi))
    push(g.created_at, 'achat', g.number, `Réception ${g.number}`, [{ a: '31', d: g.v }, { a: '401', c: g.v }]);
  for (const x of all('SELECT amount,method,reference,created_at,id FROM supplier_payments WHERE pharmacy_id=? AND created_at BETWEEN ? AND ?', ph, lo, hi))
    push(x.created_at, 'règlement fournisseur', 'RF-' + x.id, `Règlement fournisseur ${x.reference || ''}`.trim(), [{ a: '401', d: x.amount }, { a: x.method === 'cash' ? '531' : '512', c: x.amount }]);
  for (const x of all("SELECT id,credit_amount,credited_at,credit_note_ref FROM supplier_returns WHERE pharmacy_id=? AND status='credited' AND credited_at BETWEEN ? AND ?", ph, lo, hi))
    push(x.credited_at, 'avoir fournisseur', 'AF-' + x.id, `Avoir fournisseur ${x.credit_note_ref || ''}`.trim(), [{ a: '401', d: x.credit_amount || 0 }, { a: '31', c: x.credit_amount || 0 }]);
  for (const d of all("SELECT d.id,d.amount,d.method,d.created_at,o.number FROM order_deposits d JOIN customer_orders o ON o.id=d.order_id WHERE o.pharmacy_id=? AND d.status='held' AND d.created_at BETWEEN ? AND ?", ph, lo, hi))
    push(d.created_at, 'acompte', d.number, `Acompte ${d.number}`, [{ a: cashAcc(d.method), d: d.amount }, { a: '4191', c: d.amount }]);
  // Les acomptes imputés à la vente figurent déjà dans les encaissements de la vente ; les acomptes remboursés sont neutres.
  for (const m of all(`SELECT m.id,m.qty,m.movement_type,m.created_at, ABS(m.qty)*COALESCE(NULLIF(b.unit_cost,0),p.purchase_price) v FROM stock_movements m JOIN batches b ON b.id=m.batch_id JOIN products p ON p.id=m.product_id WHERE m.pharmacy_id=? AND m.movement_type IN ('loss','breakage','breakage_record','expiry_writeoff','donation','inventory_adjust') AND m.created_at BETWEEN ? AND ?`, ph, lo, hi)) {
    const v = Math.round(m.v); if (m.qty < 0) push(m.created_at, 'stock', 'MV-' + m.id, `Perte de stock (${m.movement_type})`, [{ a: '6571', d: v }, { a: '31', c: v }]); else if (m.movement_type === 'inventory_adjust') push(m.created_at, 'stock', 'MV-' + m.id, 'Écart d\'inventaire (gain)', [{ a: '31', d: v }, { a: '7581', c: v }]);
  }
  return out;
}
export function manual(ph, from, to, extra = '') {
  const es = all(`SELECT * FROM acc_entries WHERE pharmacy_id=? AND entry_date BETWEEN ? AND ? ${extra} ORDER BY entry_date, id`, ph, from, to); if (!es.length) return [];
  const ls = all(`SELECT * FROM acc_entry_lines WHERE entry_id IN (${es.map(() => '?').join(',')}) ORDER BY id`, ...es.map((e) => e.id));
  return es.map((e) => ({ id: e.id, date: e.entry_date, source: e.reversed_of ? 'extourne' : 'manuelle', ref: e.number, label: e.label, reference: e.reference, reversed_of: e.reversed_of, lines: ls.filter((l) => l.entry_id === e.id).map((l) => ({ a: l.account_code, d: l.debit, c: l.credit, memo: l.memo })) }));
}
export const journal = (ph, from, to) => [...derive(ph, from, to), ...manual(ph, from, to)].sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
// Totaux par compte
export function balances(ph, from, to) {
  ensureChart(ph); const acc = new Map(all('SELECT code,label,type FROM acc_accounts WHERE pharmacy_id=?', ph).map((a) => [a.code, { ...a, debit: 0, credit: 0 }]));
  for (const e of journal(ph, from, to)) for (const l of e.lines) { let a = acc.get(l.a); if (!a) { a = { code: l.a, label: 'Compte inconnu ' + l.a, type: 'asset', debit: 0, credit: 0 }; acc.set(l.a, a); } a.debit += l.d || 0; a.credit += l.c || 0; }
  return [...acc.values()].filter((a) => a.debit || a.credit).sort((a, b) => a.code.localeCompare(b.code)).map((a) => ({ ...a, balance: ['asset', 'expense'].includes(a.type) ? a.debit - a.credit : a.credit - a.debit }));
}
export const lockedUntil = (ph) => get('SELECT MAX(locked_until) v FROM period_locks WHERE pharmacy_id=?', ph)?.v || null;
export const START = '2000-01-01';
