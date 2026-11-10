// Comptabilité : plan comptable, journal, écritures manuelles, grand livre, balance, compte de résultat, bilan, exports.
import { router, audit, can, need } from '../http.js';
import { get, all, run, insert, tx, nextNumber } from '../db.js';
import { bad, conflict, notFound, forbidden, str, int, oneOf, todaySql, addDays } from '../util.js';
import { ensureChart, journal, balances, manual, lockedUntil, START } from '../accounting.js';
import { sendCsv } from './reports.js';

const D = /^\d{4}-\d{2}-\d{2}$/;
const range = (q) => { const to = q.to || todaySql(), from = q.from || to.slice(0, 4) + '-01-01'; if (!D.test(from) || !D.test(to) || from > to) throw bad('VALIDATION', 'Période invalide'); return { from, to }; };
const out = (ctx, name, rows, cols, extra = {}) => (['csv', 'xlsx', 'pdf'].includes(ctx.query.format) ? sendCsv(ctx, name, rows, cols) : { ...extra, data: rows });

router.get('/accounting/accounts', { perm: 'accounting.view' }, (ctx) => { ensureChart(ctx.ph); return all('SELECT id,code,label,type,is_system FROM acc_accounts WHERE pharmacy_id=? ORDER BY code', ctx.ph); });
router.post('/accounting/accounts', { perm: 'accounting.manage' }, (ctx) => {
  ensureChart(ctx.ph); const code = String(ctx.body.code || '').trim(); if (!/^[0-9]{2,8}$/.test(code)) throw bad('VALIDATION', 'Code : 2 à 8 chiffres'); if (get('SELECT 1 FROM acc_accounts WHERE pharmacy_id=? AND code=?', ctx.ph, code)) throw conflict('DUPLICATE', 'Ce compte existe déjà');
  const id = insert('INSERT INTO acc_accounts(pharmacy_id,code,label,type) VALUES (?,?,?,?)', ctx.ph, code, str(ctx.body.label, 'libellé', { required: true, max: 100 }), oneOf(ctx.body.type, 'type', ['asset', 'liability', 'equity', 'expense', 'income'], { required: true })); audit(ctx, 'accounting.account_create', 'account', id, undefined, { code }); return { id };
});
router.put('/accounting/accounts/:id', { perm: 'accounting.manage', ok200: true }, (ctx) => { const a = get('SELECT * FROM acc_accounts WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!a) throw notFound('Compte'); run('UPDATE acc_accounts SET label=? WHERE id=?', str(ctx.body.label, 'libellé', { required: true, max: 100 }), a.id); audit(ctx, 'accounting.account_update', 'account', a.id, { label: a.label }, { label: ctx.body.label }); return { ok: true }; });
router.delete('/accounting/accounts/:id', { perm: 'accounting.manage', ok200: true }, (ctx) => { const a = get('SELECT * FROM acc_accounts WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!a) throw notFound('Compte'); if (a.is_system) throw forbidden('Compte système : non supprimable'); if (get('SELECT 1 FROM acc_entry_lines l JOIN acc_entries e ON e.id=l.entry_id WHERE e.pharmacy_id=? AND l.account_code=? LIMIT 1', ctx.ph, a.code)) throw conflict('IN_USE', 'Compte utilisé dans des écritures'); run('DELETE FROM acc_accounts WHERE id=?', a.id); audit(ctx, 'accounting.account_delete', 'account', a.id, a); return { ok: true }; });

router.get('/accounting/journal', { perm: 'accounting.view' }, (ctx) => {
  const { from, to } = range(ctx.query); ensureChart(ctx.ph); const src = ctx.query.source; let es = journal(ctx.ph, from, to); if (src === 'auto') es = es.filter((e) => !['manuelle', 'extourne'].includes(e.source)); if (src === 'manual') es = es.filter((e) => ['manuelle', 'extourne'].includes(e.source));
  const flat = es.flatMap((e) => e.lines.map((l, i) => ({ date: e.date, ref: e.ref, source: e.source, label: i === 0 ? e.label : '', code: l.a, debit: l.d || 0, credit: l.c || 0 })));
  if (['csv', 'xlsx', 'pdf'].includes(ctx.query.format)) return sendCsv(ctx, 'journal', flat, ['date', 'ref', 'source', 'label', 'code', 'debit', 'credit']);
  const lim = Math.min(Number(ctx.query.limit) || 300, 1000), off = Math.max(Number(ctx.query.offset) || 0, 0);
  return { total: es.length, data: es.slice(off, off + lim), totals: { debit: flat.reduce((a, x) => a + x.debit, 0), credit: flat.reduce((a, x) => a + x.credit, 0) } };
});
router.post('/accounting/entries', { perm: 'accounting.manage' }, (ctx) => tx(() => {
  ensureChart(ctx.ph); const date = String(ctx.body.date || todaySql()); if (!D.test(date)) throw bad('VALIDATION', 'Date invalide'); const lk = lockedUntil(ctx.ph); if (lk && date <= lk) throw conflict('PERIOD_LOCKED', `Période verrouillée jusqu'au ${lk}`);
  const lines = Array.isArray(ctx.body.lines) ? ctx.body.lines : []; if (lines.length < 2 || lines.length > 40) throw bad('VALIDATION', 'Une écriture comporte 2 à 40 lignes');
  const codes = new Set(all('SELECT code FROM acc_accounts WHERE pharmacy_id=?', ctx.ph).map((a) => a.code)); let d = 0, c = 0;
  const clean = lines.map((l) => { const a = String(l.account_code || ''); if (!codes.has(a)) throw bad('VALIDATION', `Compte inconnu : ${a}`); const de = int(l.debit || 0, 'débit', { min: 0, max: 1e12 }), cr = int(l.credit || 0, 'crédit', { min: 0, max: 1e12 }); if ((de > 0) === (cr > 0)) throw bad('VALIDATION', 'Chaque ligne porte soit un débit, soit un crédit'); d += de; c += cr; return { a, de, cr, memo: str(l.memo, 'libellé de ligne', { max: 120 }) }; });
  if (d !== c || d === 0) throw bad('UNBALANCED', `Écriture déséquilibrée : débit ${d} ≠ crédit ${c}`);
  const number = nextNumber(ctx.ph, 'acc_entry', 'EC'); const id = insert('INSERT INTO acc_entries(pharmacy_id,number,entry_date,label,reference,user_id) VALUES (?,?,?,?,?,?)', ctx.ph, number, date, str(ctx.body.label, 'libellé', { required: true, min: 3, max: 150 }), str(ctx.body.reference, 'référence', { max: 60 }), ctx.user.id);
  for (const l of clean) insert('INSERT INTO acc_entry_lines(entry_id,account_code,debit,credit,memo) VALUES (?,?,?,?,?)', id, l.a, l.de, l.cr, l.memo);
  audit(ctx, 'accounting.entry', 'acc_entry', id, undefined, { number, total: d }); return { id, number };
}));
router.post('/accounting/entries/:id/reverse', { perm: 'accounting.manage' }, (ctx) => tx(() => { // pas de suppression : contre-passation traçable
  const e = get('SELECT * FROM acc_entries WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!e) throw notFound('Écriture'); if (e.reversed_of) throw conflict('BAD_STATE', 'Une extourne ne s\'extourne pas'); if (get('SELECT 1 FROM acc_entries WHERE reversed_of=?', e.id)) throw conflict('ALREADY', 'Déjà extournée');
  const date = todaySql(); const lk = lockedUntil(ctx.ph); if (lk && date <= lk) throw conflict('PERIOD_LOCKED', `Période verrouillée jusqu'au ${lk}`);
  const number = nextNumber(ctx.ph, 'acc_entry', 'EC'); const id = insert('INSERT INTO acc_entries(pharmacy_id,number,entry_date,label,reference,reversed_of,user_id) VALUES (?,?,?,?,?,?,?)', ctx.ph, number, date, `Extourne de ${e.number} - ${e.label}`.slice(0, 150), e.reference, e.id, ctx.user.id);
  for (const l of all('SELECT * FROM acc_entry_lines WHERE entry_id=?', e.id)) insert('INSERT INTO acc_entry_lines(entry_id,account_code,debit,credit,memo) VALUES (?,?,?,?,?)', id, l.account_code, l.credit, l.debit, l.memo);
  audit(ctx, 'accounting.reverse', 'acc_entry', e.id, undefined, { number }); return { id, number };
}));
router.get('/accounting/ledger', { perm: 'accounting.view' }, (ctx) => {
  const { from, to } = range(ctx.query); const code = String(ctx.query.account || ''); ensureChart(ctx.ph); const acc = get('SELECT * FROM acc_accounts WHERE pharmacy_id=? AND code=?', ctx.ph, code); if (!acc) throw notFound('Compte');
  const sign = ['asset', 'expense'].includes(acc.type) ? 1 : -1; const opening = balances(ctx.ph, START, addDays(from, -1).slice(0, 10)).find((b) => b.code === code)?.balance || 0; let run_ = opening;
  const rows = journal(ctx.ph, from, to).flatMap((e) => e.lines.filter((l) => l.a === code).map((l) => { run_ += sign * ((l.d || 0) - (l.c || 0)); return { date: e.date, ref: e.ref, source: e.source, label: e.label, debit: l.d || 0, credit: l.c || 0, balance: run_ }; }));
  return out(ctx, 'grand_livre', rows, ['date', 'ref', 'label', 'debit', 'credit', 'balance'], { account: acc, opening, closing: run_ });
});
router.get('/accounting/trial-balance', { perm: 'accounting.view' }, (ctx) => { const { from, to } = range(ctx.query); const b = balances(ctx.ph, from, to); const rows = b.map((x) => ({ code: x.code, label: x.label, debit: x.debit, credit: x.credit, balance: x.balance })); const t = { debit: rows.reduce((a, x) => a + x.debit, 0), credit: rows.reduce((a, x) => a + x.credit, 0) }; return out(ctx, 'balance_comptable', rows, ['code', 'label', 'debit', 'credit', 'balance'], { totals: t, balanced: t.debit === t.credit }); });
router.get('/accounting/income-statement', { perm: 'accounting.view' }, (ctx) => {
  const { from, to } = range(ctx.query); const b = balances(ctx.ph, from, to); const inc = b.filter((x) => x.type === 'income'), exp = b.filter((x) => x.type === 'expense'); const sum = (l) => l.reduce((a, x) => a + x.balance, 0);
  const sales = b.find((x) => x.code === '707')?.balance || 0, ret = b.find((x) => x.code === '709')?.balance || 0, cogs = b.find((x) => x.code === '607')?.balance || 0; // 709 est un produit à solde débiteur : balance négative
  const rows = [...inc.map((x) => ({ section: 'Produits', label: `${x.code} ${x.label}`, amount: x.balance })), { section: 'Total produits', label: '', amount: sum(inc) }, ...exp.map((x) => ({ section: 'Charges', label: `${x.code} ${x.label}`, amount: x.balance })), { section: 'Total charges', label: '', amount: sum(exp) }, { section: 'RÉSULTAT NET', label: '', amount: sum(inc) - sum(exp) }];
  return out(ctx, 'compte_resultat', rows, ['section', 'label', 'amount'], { net_sales: sales + ret, gross_margin: sales + ret - cogs, total_income: sum(inc), total_expense: sum(exp), result: sum(inc) - sum(exp) });
});
router.get('/accounting/balance-sheet', { perm: 'accounting.view' }, (ctx) => {
  const to = ctx.query.to || todaySql(); if (!D.test(to)) throw bad('VALIDATION', 'Date invalide'); const b = balances(ctx.ph, START, to); const by = (t) => b.filter((x) => x.type === t); const sum = (l) => l.reduce((a, x) => a + x.balance, 0);
  const result = sum(by('income')) - sum(by('expense')); const assets = by('asset'), liab = by('liability'), eq = by('equity');
  const totalA = sum(assets), totalP = sum(liab) + sum(eq) + result;
  const real = get('SELECT COALESCE(SUM((s.qty_available + s.qty_quarantine) * COALESCE(NULLIF(b.unit_cost,0),p.purchase_price)),0) v FROM stock_levels s JOIN batches b ON b.id=s.batch_id JOIN products p ON p.id=b.product_id WHERE s.pharmacy_id=?', ctx.ph).v;
  const book = b.find((x) => x.code === '31')?.balance || 0;
  const rows = [...assets.map((x) => ({ section: 'Actif', label: `${x.code} ${x.label}`, amount: x.balance })), { section: 'Total actif', label: '', amount: totalA }, ...liab.map((x) => ({ section: 'Passif', label: `${x.code} ${x.label}`, amount: x.balance })), ...eq.map((x) => ({ section: 'Capitaux propres', label: `${x.code} ${x.label}`, amount: x.balance })), { section: 'Capitaux propres', label: 'Résultat de la période', amount: result }, { section: 'Total passif', label: '', amount: totalP }];
  return out(ctx, 'bilan', rows, ['section', 'label', 'amount'], { total_assets: totalA, total_liabilities_equity: totalP, balanced: totalA === totalP, result, stock_book: book, stock_real: real, stock_gap: real - book, stock_hint: real !== book ? 'La valeur comptable du stock (compte 31) diffère de la valorisation réelle : saisissez une écriture d\'ouverture (débit 31 / crédit 101) pour le stock initial, ou un ajustement.' : null });
});
router.get('/accounting/vat', { perm: 'accounting.view' }, (ctx) => { const { from, to } = range(ctx.query); const b = balances(ctx.ph, from, to); const col = b.find((x) => x.code === '4457')?.balance || 0, ded = b.find((x) => x.code === '4456')?.balance || 0; return { collected: col, deductible: ded, payable: col - ded }; });
