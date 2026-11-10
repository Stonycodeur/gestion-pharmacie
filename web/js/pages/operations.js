// Opérations : transferts inter-établissements, retours/avoirs/paiements fournisseurs, créances clients, clôture de période & rapport Z.
import { get, post, can, download, qs, state } from '../api.js';
import { h, clear, money, table, pager, badge, modal, formModal, confirmDialog, fail, toast, when, tabs } from '../ui.js';
import { loadMethods, methodsNow, methodOptions, kindOf, kindIcon } from '../paymethods.js';
import { t } from '../i18n.js';
import { productPicker } from './purchases.js';

const TR = { shipped: ['Expédié', 'info'], received: ['Reçu', 'ok'], cancelled: ['Annulé', 'bad'], rejected: ['Refusé', 'bad'], requested: ['Demandé', ''] };
const SR = { sent: ['Envoyé', 'info'], credited: ['Avoir reçu', 'ok'], cancelled: ['Annulé', 'bad'] };
const dl = (path, name) => download(path, name).catch(fail);

export default async function (box) { await loadMethods('pos');
  const head = h('div'), body = h('div');
  const T = [];
  if (can('transfers.manage') || can('transfers.receive')) T.push(['transfers', 'Transferts']);
  if (can('supplier_returns.manage') || can('suppliers.view')) T.push(['returns', 'Retours fournisseur']);
  if (can('suppliers.view')) T.push(['balances', 'Soldes fournisseurs']);
  if (can('accounting.view')) T.push(['receivables', 'Créances clients'], ['closing', 'Clôture & rapport Z']);
  let tab = T[0]?.[0];
  const show = (id) => { tab = id; clear(head).append(tabs(T, tab, show)); clear(body); views[tab]().catch(fail); };
  const views = {
    // ---------- transferts ----------
    async transfers() {
      const list = h('div');
      async function load(page = 1) {
        const r = await get('/transfers?page=' + page);
        clear(list).append(table([{ label: 'N°', key: 'number' }, { label: 'Date', render: (x) => when(x.created_at) }, { label: 'De', key: 'from_name' }, { label: 'Vers', key: 'to_name' }, { label: 'Unités', num: true, key: 'units' }, { label: 'Statut', render: (x) => badge(t(TR[x.status][0]), TR[x.status][1]) }], r.data, { onRow: detail }), pager(r, load));
      }
      if (can('transfers.manage')) body.append(h('button', { class: 'btn primary', style: { marginBottom: '12px' }, onclick: create }, '+ Nouveau transfert'));
      body.append(list); await load();
      async function detail(row) {
        const x = await get('/transfers/' + row.id); const acts = [];
        const me = state.pharmacy?.id;
        if (x.status === 'shipped' && x.to_pharmacy_id === me && can('transfers.receive')) acts.push(h('button', { class: 'btn primary', onclick: () => { m.close(); receive(x); } }, 'Réceptionner'));
        if (x.status === 'shipped') acts.push(h('button', { class: 'btn danger', onclick: async () => { const r = await confirmDialog('Annuler / refuser ce transfert ? Le stock retourne à l\'expéditeur.', { reason: true, danger: true }); if (r) { try { await post(`/transfers/${x.id}/cancel`, { reason: r }); m.close(); load(); } catch (e) { fail(e); } } } }, 'Annuler / refuser'));
        const m = modal(`${x.number} · ${x.from_name} → ${x.to_name}`, h('div', {}, badge(t(TR[x.status][0]), TR[x.status][1]), x.notes ? h('p', { class: 'muted' }, x.notes) : null,
          table([{ label: 'Produit', key: 'product_name' }, { label: 'Lot', key: 'batch_no' }, { label: 'Péremption', key: 'exp_date' }, { label: 'Envoyé', num: true, key: 'qty' }, { label: 'Reçu', num: true, render: (l) => l.qty_received ?? '' }], x.lines)), { wide: true, actions: acts });
      }
      function receive(x) {
        const q = {}; x.lines.forEach((l) => (q[l.id] = l.qty)); const note = h('input', { placeholder: 'Justification (obligatoire en cas d\'écart)' });
        const m = modal('Réception ' + x.number, h('div', {}, table([{ label: 'Produit', key: 'product_name' }, { label: 'Lot', key: 'batch_no' }, { label: 'Envoyé', num: true, key: 'qty' }, { label: 'Reçu', render: (l) => h('input', { type: 'number', min: 0, max: l.qty, value: l.qty, style: { width: '80px' }, oninput: (e) => (q[l.id] = Number(e.target.value)) }) }], x.lines), h('label', { class: 'f' }, 'Justification', note)),
          { wide: true, actions: [h('button', { class: 'btn primary', onclick: async () => { try { const r = await post(`/transfers/${x.id}/receive`, { note: note.value, lines: x.lines.map((l) => ({ line_id: l.id, qty_received: q[l.id] })) }); m.close(); toast(r.short ? `Reçu avec écart de ${r.short}` : 'Réceptionné'); load(); } catch (e) { fail(e); } } }, 'Valider la réception')] });
      }
      async function create() {
        const dest = await get('/transfers/destinations'); if (!dest.length) return toast('Aucun autre établissement actif : créez-en un dans Paramètres.', true);
        const lines = []; const tb = h('div'); const s = h('select', {}, dest.map((d) => h('option', { value: d.id }, d.name))); const notes = h('input', { placeholder: 'Note (facultatif)' });
        const draw = () => clear(tb).append(table([{ label: 'Produit', key: 'name' }, { label: 'Quantité', render: (l) => h('input', { type: 'number', min: 1, value: l.qty, style: { width: '80px' }, onchange: (e) => (l.qty = Number(e.target.value)) }) }], lines));
        const m = modal('Nouveau transfert (sortie immédiate du stock, lots FEFO)', h('div', {}, h('label', { class: 'f' }, 'Destination', s), tb, h('button', { class: 'btn', onclick: () => productPicker((p) => { lines.push({ id: p.id, name: p.name, qty: 1 }); draw(); }) }, '+ Produit'), h('label', { class: 'f' }, 'Note', notes)),
          { wide: true, actions: [h('button', { class: 'btn primary', onclick: async () => { try { const r = await post('/transfers', { to_pharmacy_id: Number(s.value), notes: notes.value || undefined, lines: lines.map((l) => ({ product_id: l.id, qty: l.qty })) }); m.close(); toast('Transfert ' + r.number + ' expédié'); load(); } catch (e) { fail(e); } } }, 'Expédier')] });
      }
    },
    // ---------- retours fournisseur ----------
    async returns() {
      const list = h('div');
      async function load(page = 1) {
        const r = await get('/supplier-returns?page=' + page);
        clear(list).append(table([{ label: 'N°', key: 'number' }, { label: 'Date', render: (x) => when(x.created_at) }, { label: 'Fournisseur', key: 'supplier_name' }, { label: 'Unités', num: true, key: 'units' }, { label: 'Avoir', num: true, render: (x) => (x.credit_amount != null ? money(x.credit_amount) : '') }, { label: 'Statut', render: (x) => badge(t(SR[x.status][0]), SR[x.status][1]) }], r.data, { onRow: detail }), pager(r, load));
      }
      if (can('supplier_returns.manage')) body.append(h('button', { class: 'btn primary', style: { marginBottom: '12px' }, onclick: create }, '+ Nouveau retour'));
      body.append(list); await load();
      async function detail(row) {
        const x = await get('/supplier-returns/' + row.id); const acts = [];
        if (x.status === 'sent' && can('supplier_returns.manage')) {
          acts.push(h('button', { class: 'btn primary', onclick: () => { m.close(); formModal('Avoir fournisseur - ' + x.number, [{ name: 'credit_amount', label: 'Montant de l\'avoir', type: 'money', required: true }, { name: 'credit_note_ref', label: 'Référence de l\'avoir', required: true }], async (v) => { await post(`/supplier-returns/${x.id}/credit`, v); toast('Avoir enregistré'); load(); }); } }, 'Enregistrer l\'avoir'));
          acts.push(h('button', { class: 'btn danger', onclick: async () => { const r = await confirmDialog('Annuler ce retour ? Le stock est restitué.', { reason: true, danger: true }); if (r) { try { await post(`/supplier-returns/${x.id}/cancel`, { reason: r }); m.close(); load(); } catch (e) { fail(e); } } } }, 'Annuler le retour'));
        }
        const m = modal(`${x.number} - ${x.supplier_name}`, h('div', {}, badge(t(SR[x.status][0]), SR[x.status][1]), h('p', {}, 'Motif : ' + x.reason), x.credit_note_ref ? h('p', {}, `Avoir ${x.credit_note_ref} : ${money(x.credit_amount)}`) : null,
          table([{ label: 'Produit', key: 'product_name' }, { label: 'Lot', key: 'batch_no' }, { label: 'Compartiment', key: 'bucket' }, { label: 'Qté', num: true, key: 'qty' }], x.lines)), { wide: true, actions: acts });
      }
      async function create() {
        const sup = (await get('/suppliers?limit=200')).data; const lines = []; const tb = h('div'); const s = h('select', {}, sup.map((x) => h('option', { value: x.id }, x.name))); const reason = h('input', { placeholder: 'Motif du retour *', required: true });
        const draw = () => clear(tb).append(table([{ label: 'Produit', render: (l) => `${l.product_name} - lot ${l.batch_no}` }, { label: 'Compartiment', render: (l) => h('select', { onchange: (e) => (l.bucket = e.target.value) }, ['available', 'quarantine', 'damaged'].map((b) => h('option', { value: b, selected: b === l.bucket }, b))) }, { label: 'Qté', render: (l) => h('input', { type: 'number', min: 1, value: l.qty, style: { width: '70px' }, onchange: (e) => (l.qty = Number(e.target.value)) }) }], lines));
        const pick = async () => { const b = await get('/stock/batches?all=1'); const m2 = modal('Choisir un lot', h('div', { class: 'res' }, b.slice(0, 200).map((x) => h('button', { onclick: () => { m2.close(); lines.push({ batch_id: x.batch_id, product_name: x.product_name, batch_no: x.batch_no, qty: 1, bucket: 'available' }); draw(); } }, h('span', {}, h('strong', {}, x.product_name), h('div', { class: 'muted' }, `lot ${x.batch_no} · ${x.exp_date}`)), `dispo ${x.qty_available} · quar. ${x.qty_quarantine}`)))); };
        const m = modal('Retour fournisseur', h('div', {}, h('label', { class: 'f' }, 'Fournisseur', s), h('label', { class: 'f' }, 'Motif', reason), tb, h('button', { class: 'btn', onclick: pick }, '+ Lot')),
          { wide: true, actions: [h('button', { class: 'btn primary', onclick: async () => { try { const r = await post('/supplier-returns', { supplier_id: Number(s.value), reason: reason.value, lines: lines.map((l) => ({ batch_id: l.batch_id, qty: l.qty, bucket: l.bucket })) }); m.close(); toast('Retour ' + r.number); load(); } catch (e) { fail(e); } } }, 'Créer le retour')] });
      }
    },
    // ---------- soldes fournisseurs ----------
    async balances() {
      const r = await get('/supplier-balances'); const ex = h('div', { class: 'row', style: { marginBottom: '12px' } });
      if (can('reports.export')) ex.append(h('button', { class: 'btn', onclick: () => dl('/supplier-balances?format=xlsx', 'soldes_fournisseurs.xlsx') }, 'Excel'), h('button', { class: 'btn', onclick: () => dl('/supplier-balances?format=pdf', 'soldes_fournisseurs.pdf') }, 'PDF'));
      body.append(ex, table([{ label: 'Fournisseur', key: 'supplier' }, { label: 'Achats', num: true, render: (x) => money(x.bought) }, { label: 'Avoirs', num: true, render: (x) => money(x.credits) }, { label: 'Payé', num: true, render: (x) => money(x.paid) }, { label: 'Solde dû', num: true, render: (x) => badge(money(x.balance), x.balance > 0 ? 'warn' : 'ok') }], r.data,
        { onRow: can('supplier_payments.manage') ? (x) => formModal('Paiement - ' + x.supplier, [{ name: 'amount', label: 'Montant', type: 'money', required: true, hint: 'Solde dû : ' + money(x.balance) }, { name: 'method', label: 'Mode', type: 'select', required: true, value: 'transfer', options: ['transfer', 'cheque', 'card', 'other'] }, { name: 'reference', label: 'Référence (n° virement / chèque)' }], async (v) => { await post('/supplier-payments', { supplier_id: x.supplier_id, ...v }); toast('Paiement enregistré'); clear(body); views.balances().catch(fail); }) : null, empty: 'Aucune écriture fournisseur' }));
      if (can('supplier_payments.manage')) body.append(h('p', { class: 'muted' }, 'Cliquez sur une ligne pour enregistrer un paiement (virement, chèque, carte).'));
    },
    // ---------- créances clients ----------
    async receivables() {
      const r = await get('/receivables'); const ex = h('div', { class: 'row', style: { marginBottom: '12px' } }, h('div', { class: 'card kpi' }, h('div', { class: 'l' }, 'Total à recevoir'), h('div', { class: 'v' }, money(r.total))));
      if (can('reports.export')) ex.append(h('button', { class: 'btn', onclick: () => dl('/receivables?format=xlsx', 'creances.xlsx') }, 'Excel'), h('button', { class: 'btn', onclick: () => dl('/receivables?format=pdf', 'creances.pdf') }, 'PDF'));
      body.append(ex, table([{ label: 'Client', key: 'name' }, { label: 'Téléphone', key: 'phone' }, { label: 'Plus ancienne', render: (x) => when(x.oldest) }, { label: 'Solde dû', num: true, render: (x) => badge(money(x.balance), 'warn') }], r.data,
        { onRow: can('sales.create') ? (x) => formModal('Règlement - ' + x.name, [{ name: 'amount', label: 'Montant reçu', type: 'money', required: true, hint: 'Solde : ' + money(x.balance) }, { name: 'method', label: 'Mode', type: 'select', required: true, value: 'cash', options: methodOptions() }], async (v) => { const p = await post(`/customers/${x.customer_id}/payments`, v); toast('Reste dû : ' + money(p.balance)); clear(body); views.receivables().catch(fail); }) : null, empty: 'Aucune créance' }));
      body.append(h('p', { class: 'muted' }, 'Ventes à crédit : activées en fixant un plafond « credit_limit » (Paramètres) ; réservées aux clients identifiés. Le règlement exige une caisse ouverte.'));
    },
    // ---------- clôture / Z ----------
    async closing() {
      const day = h('input', { type: 'date', value: new Date(Date.now() - 864e5).toISOString().slice(0, 10) }); const out = h('div'); const locks = h('div');
      async function z() {
        const r = await get('/accounting/z-report' + qs({ date: day.value }));
        clear(out).append(h('div', { class: 'grid g4' }, [['Tickets', r.sales.tickets], ['Brut TTC', money(r.sales.gross)], ['Remboursements', money(r.refunds.amount)], ['Net', money(r.net)], ['TVA', money(r.sales.tax)], ['Laissé à crédit', money(r.sales.on_credit)]].map(([l, v]) => h('div', { class: 'card kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v)))),
          r.locked ? h('div', { class: 'alert info' }, 'Journée clôturée (verrouillée).') : null,
          h('h3', {}, 'Mouvements de caisse'), table([{ label: 'Type', key: 'kind' }, { label: 'Mode', key: 'method' }, { label: 'Nb', num: true, key: 'n' }, { label: 'Montant', num: true, render: (x) => money(x.amount) }], r.cash_movements),
          h('h3', {}, 'Sessions'), table([{ label: '#', key: 'id' }, { label: 'Caissier', key: 'cashier' }, { label: 'Statut', key: 'status' }, { label: 'Attendu', num: true, render: (x) => (x.expected_cash != null ? money(x.expected_cash) : '') }, { label: 'Écart', num: true, render: (x) => (x.difference != null ? badge(money(x.difference), x.difference ? 'bad' : 'ok') : '') }], r.sessions),
          can('reports.export') ? h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => dl('/accounting/z-report' + qs({ date: day.value, format: 'pdf' }), `z_${day.value}.pdf`) }, 'PDF'), h('button', { class: 'btn', onclick: () => dl('/accounting/z-report' + qs({ date: day.value, format: 'xlsx' }), `z_${day.value}.xlsx`) }, 'Excel')) : null);
      }
      async function loadLocks() {
        const r = await get('/accounting/locks');
        clear(locks).append(h('h3', {}, 'Périodes clôturées'), h('p', {}, r.locked_until ? `Verrouillé jusqu'au ${r.locked_until} inclus : plus de remboursement sur ces ventes.` : 'Aucune période clôturée.'),
          can('accounting.lock') ? h('button', { class: 'btn danger', onclick: () => formModal('Clôturer une période', [{ name: 'locked_until', label: 'Verrouiller jusqu\'au (inclus)', type: 'date', required: true, value: day.value, hint: 'Irréversible. Jours révolus uniquement ; toutes les caisses de la période doivent être fermées.' }, { name: 'note', label: 'Note' }], async (v) => { await post('/accounting/locks', v); toast('Période clôturée'); loadLocks(); z(); }, { submitLabel: 'Clôturer' }) }, 'Clôturer une période…') : null,
          r.data.length ? table([{ label: 'Jusqu\'au', key: 'locked_until' }, { label: 'Par', key: 'user_name' }, { label: 'Le', render: (x) => when(x.created_at) }, { label: 'Note', key: 'note' }], r.data) : null);
      }
      day.onchange = z; body.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, h('label', {}, 'Journée ', day)), out, locks); await Promise.all([z(), loadLocks()]);
    },
  };
  box.append(h('h1', {}, t('Opérations')), head, body); if (tab) show(tab); else body.append(h('p', {}, 'Aucune opération disponible pour votre profil.'));
}
