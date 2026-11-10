import { get, post, put, del, can } from '../api.js';
import { h, clear, money, toMinor, table, pager, badge, modal, formModal, confirmDialog, fail, toast, when, tabs, debounce } from '../ui.js';
import { t } from '../i18n.js';

const PO = { draft: ['Brouillon', ''], sent: ['Envoyée', 'info'], partial: ['Reçue partiellement', 'warn'], received: ['Reçue', 'ok'], cancelled: ['Annulée', 'bad'] };

// sélecteur de produit avec recherche
export async function productPicker(onPick) {
  const q = h('input', { type: 'search', placeholder: t('Rechercher'), style: { width: '100%' } }), res = h('div', { class: 'res' });
  const m = modal('Choisir un produit', h('div', {}, q, res)); q.oninput = debounce(async () => { if (q.value.length < 2) return; const r = await get('/products?limit=20&q=' + encodeURIComponent(q.value)); clear(res).append(...r.data.map((p) => h('button', { onclick: () => { m.close(); onPick(p); } }, h('span', {}, h('strong', {}, p.name), h('div', { class: 'muted' }, p.sku)), money(p.purchase_price)))); });
}

export default async function (box) {
  let tab = 'orders'; const head = h('div'), body = h('div');
  const show = (id) => { tab = id; clear(head).append(tabs([['orders', 'Commandes'], ['receipts', 'Réceptions'], ['suggest', 'Suggestions'], ...(can('rfq.manage') ? [['rfq', 'Demandes de prix']] : []), ['suppliers', 'Fournisseurs']], tab, show)); clear(body); views[tab]().catch(fail); };
  const views = {
    async rfq() { (await import('./rfq.js')).rfqView(body); },
    async orders() {
      const list = h('div'); async function load(page = 1) { const r = await get('/purchase-orders?page=' + page); clear(list).append(table([{ label: 'N°', key: 'number' }, { label: 'Date', render: (p) => when(p.created_at) }, { label: 'Fournisseur', key: 'supplier_name' }, { label: 'Total', num: true, render: (p) => money(p.total) }, { label: 'Statut', render: (p) => badge(PO[p.status][0], PO[p.status][1]) }], r.data, { onRow: detail }), pager(r, load)); }
      if (can('purchases.manage')) body.append(h('button', { class: 'btn primary', style: { marginBottom: '12px' }, onclick: create }, '+ Nouvelle commande'));
      body.append(list); await load();
      async function create() {
        const sup = (await get('/suppliers?limit=200')).data.filter((s) => s.status === 'active'); const lines = []; const tb = h('div');
        const draw = () => clear(tb).append(table([{ label: 'Produit', key: 'name' }, { label: 'Quantité', render: (l) => h('input', { type: 'number', min: 1, value: l.qty, style: { width: '80px' }, onchange: (e) => (l.qty = Number(e.target.value)) }) }, { label: 'Coût unitaire', render: (l) => h('input', { type: 'number', step: '0.001', value: (l.cost / 1000).toFixed(3), style: { width: '100px' }, onchange: (e) => (l.cost = toMinor(e.target.value)) }) }], lines));
        const s = h('select', {}, sup.map((x) => h('option', { value: x.id }, x.name)));
        const m = modal('Nouvelle commande fournisseur', h('div', {}, h('label', { class: 'f' }, 'Fournisseur', s), tb, h('button', { class: 'btn', onclick: () => productPicker((p) => { lines.push({ id: p.id, name: p.name, qty: 10, cost: p.purchase_price }); draw(); }) }, '+ Produit')), { wide: true, actions: [h('button', { class: 'btn primary', onclick: async () => { try { await post('/purchase-orders', { supplier_id: Number(s.value), lines: lines.map((l) => ({ product_id: l.id, qty_ordered: l.qty, unit_cost: l.cost })) }); m.close(); toast('Commande créée'); load(); } catch (e) { fail(e); } } }, 'Créer')] });
      }
      async function detail(row) {
        const po = await get('/purchase-orders/' + row.id); const acts = [];
        if (po.status === 'draft' && can('purchases.approve')) acts.push(h('button', { class: 'btn primary', onclick: async () => { await post(`/purchase-orders/${po.id}/status`, { status: 'sent' }); m.close(); load(); } }, 'Valider et envoyer'));
        if (['draft', 'sent'].includes(po.status) && can('purchases.manage')) acts.push(h('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog('Annuler la commande ?', { danger: true })) { await post(`/purchase-orders/${po.id}/status`, { status: 'cancelled' }); m.close(); load(); } } }, 'Annuler'));
        if (['sent', 'partial'].includes(po.status) && can('receipts.create')) acts.push(h('button', { class: 'btn primary', onclick: () => { m.close(); receive(po); } }, 'Réceptionner'));
        const m = modal(`${po.number} - ${po.supplier_name}`, h('div', {}, badge(PO[po.status][0], PO[po.status][1]), table([{ label: 'Produit', key: 'product_name' }, { label: 'Commandé', num: true, key: 'qty_ordered' }, { label: 'Reçu', num: true, key: 'qty_received' }, { label: 'Coût', num: true, render: (l) => money(l.unit_cost) }], po.lines), po.receipts.length ? h('p', {}, 'Réceptions : ' + po.receipts.map((r) => r.number).join(', ')) : null), { wide: true, actions: acts });
      }
    },
    async receipts() {
      const list = h('div'); async function load(page = 1) { const r = await get('/goods-receipts?page=' + page); clear(list).append(table([{ label: 'N°', key: 'number' }, { label: 'Date', render: (p) => when(p.created_at) }, { label: 'Fournisseur', key: 'supplier_name' }, { label: 'Facture', key: 'supplier_invoice_ref' }, { label: 'Réceptionné par', key: 'user_name' }], r.data), pager(r, load)); }
      if (can('receipts.create')) body.append(h('button', { class: 'btn primary', style: { marginBottom: '12px' }, onclick: () => receive(null) }, '+ Réception sans commande'));
      body.append(list); await load();
    },
    async suggest() {
      const r = await get('/purchase-suggestions'); body.append(h('div', { class: 'alert info' }, r.note), table([{ label: 'Produit', key: 'name' }, { label: 'Vendable', num: true, key: 'sellable' }, { label: 'En commande', num: true, key: 'inbound' }, { label: 'Ventes/jour', num: true, key: 'avg_daily_sales' }, { label: 'Délai (j)', num: true, key: 'lead_days' }, { label: 'À commander', num: true, render: (x) => h('strong', {}, x.suggested_qty) }, { label: 'Fournisseur', key: 'supplier_name' }, { label: 'Confiance', render: (x) => badge(x.confidence, x.confidence === 'élevée' ? 'ok' : x.confidence === 'moyenne' ? 'warn' : 'bad') }], r.data));
    },
    async suppliers() {
      const list = h('div'); const F = (s = {}) => [{ name: 'name', label: 'Nom', required: true, value: s.name }, { name: 'contact_name', label: 'Contact', value: s.contact_name }, { name: 'phone', label: 'Téléphone', value: s.phone }, { name: 'email', label: 'E-mail', value: s.email }, { name: 'address', label: 'Adresse', value: s.address }, { name: 'legal_id', label: 'Identifiant légal', value: s.legal_id }, { name: 'payment_terms', label: 'Conditions de paiement', value: s.payment_terms }, { name: 'lead_days', label: 'Délai de livraison (jours)', type: 'number', value: s.lead_days ?? 2, min: 0 }, { name: 'rating', label: 'Note (0-5)', type: 'number', value: s.rating ?? 0, min: 0, max: 5 }, { name: 'status', label: 'Statut', type: 'select', required: true, value: s.status || 'active', options: ['active', 'inactive'] }];
      async function load(page = 1) { const r = await get('/suppliers?page=' + page); clear(list).append(table([{ label: 'Nom', key: 'name' }, { label: 'Contact', key: 'contact_name' }, { label: 'Téléphone', key: 'phone' }, { label: 'Délai (j)', num: true, key: 'lead_days' }, { label: 'Statut', key: 'status' }], r.data, { onRow: async (s) => { const perf = await get(`/suppliers/${s.id}/performance`); can('suppliers.manage') ? formModal('Modifier', F(s), async (v) => { await put('/suppliers/' + s.id, v); load(); }, { extra: h('div', {}, h('div', { class: 'alert info' }, `Performance : ${perf.orders} commande(s), ${perf.late_orders} en retard, taux de service ${perf.service_rate ?? '-'} %`), h('button', { type: 'button', class: 'btn sm danger', style: { marginBottom: '10px' }, onclick: async () => { if (await confirmDialog('Supprimer ce fournisseur ? (impossible s\'il a un historique : passez-le en inactive)', { danger: true })) try { await del('/suppliers/' + s.id); document.querySelector('.overlay')?.remove(); load(); } catch (e) { fail(e); } } }, 'Supprimer')) }) : modal(s.name, h('p', {}, `${perf.orders} commande(s), taux de service ${perf.service_rate ?? '-'} %`)); } }), pager(r, load)); }
      if (can('suppliers.manage')) body.append(h('button', { class: 'btn primary', style: { marginBottom: '12px' }, onclick: () => formModal('Nouveau fournisseur', F(), async (v) => { await post('/suppliers', v); load(); }) }, '+ ' + t('Nouveau')));
      body.append(list); await load();
    },
  };
  function receive(po) {
    const lines = []; const tb = h('div'); const inv = h('input', { placeholder: 'N° de facture fournisseur' });
    const draw = () => clear(tb).append(table([{ label: 'Produit', key: 'name' }, { label: 'Qté', render: (l) => h('input', { type: 'number', min: 1, value: l.qty, style: { width: '70px' }, onchange: (e) => (l.qty = Number(e.target.value)) }) }, { label: 'N° de lot', render: (l) => h('input', { value: l.batch_no, style: { width: '110px' }, onchange: (e) => (l.batch_no = e.target.value) }) }, { label: 'Péremption', render: (l) => h('input', { type: 'date', value: l.exp_date, onchange: (e) => (l.exp_date = e.target.value) }) }, { label: 'Coût', render: (l) => h('input', { type: 'number', step: '0.001', value: (l.cost / 1000).toFixed(3), style: { width: '90px' }, onchange: (e) => (l.cost = toMinor(e.target.value)) }) }, { label: 'Emplacement', render: (l) => h('input', { value: l.location || '', style: { width: '90px' }, onchange: (e) => (l.location = e.target.value) }) }, { label: 'Quarantaine', render: (l) => h('input', { type: 'checkbox', checked: l.quarantine, onchange: (e) => (l.quarantine = e.target.checked) }) }], lines));
    if (po) po.lines.filter((l) => l.qty_received < l.qty_ordered).forEach((l) => lines.push({ id: l.product_id, name: l.product_name, qty: l.qty_ordered - l.qty_received, batch_no: '', exp_date: '', cost: l.unit_cost }));
    draw(); let supSel = null; const extra = [];
    const pre = h('div'); if (!po) get('/suppliers?limit=200').then((r) => { supSel = h('select', {}, r.data.map((x) => h('option', { value: x.id }, x.name))); pre.append(h('label', { class: 'f' }, 'Fournisseur', supSel)); });
    const m = modal(po ? `Réception - ${po.number}` : 'Réception', h('div', {}, pre, h('label', { class: 'f' }, 'Facture fournisseur', inv), tb, !po ? h('button', { class: 'btn', onclick: () => productPicker((p) => { lines.push({ id: p.id, name: p.name, qty: 1, batch_no: '', exp_date: '', cost: p.purchase_price }); draw(); }) }, '+ Produit') : null), { wide: true,
      actions: [h('button', { class: 'btn primary', onclick: async () => { try { const r = await post('/goods-receipts', { po_id: po?.id, supplier_id: supSel ? Number(supSel.value) : undefined, supplier_invoice_ref: inv.value || null, lines: lines.filter((l) => l.qty > 0).map((l) => ({ product_id: l.id, qty: l.qty, batch_no: l.batch_no, exp_date: l.exp_date, unit_cost: l.cost, location: l.location || undefined, quarantine: l.quarantine || undefined })) }); m.close(); toast(`Réception ${r.number} enregistrée`); r.warnings.forEach((w) => toast(w)); show(tab); } catch (e) { fail(e); } } }, 'Enregistrer la réception')] });
  }
  box.append(h('h1', {}, t('Achats')), head, body); show('orders');
}
