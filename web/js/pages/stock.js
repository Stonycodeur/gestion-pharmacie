import { get, post, can, download } from '../api.js';
import { h, clear, money, table, pager, badge, modal, formModal, confirmDialog, fail, toast, debounce, statusBadge, when, tabs, guard } from '../ui.js';
import { t } from '../i18n.js';

export default async function (box) {
  let tab = 'stock'; const body = h('div'); const head = h('div');
  const show = (id) => { tab = id; clear(head).append(tabs([['stock', 'Stock'], ['batches', 'Lots'], ['movements', 'Mouvements'], ['alerts', 'Alertes'], ['temps', 'Températures']], tab, show)); clear(body); views[tab]().catch(fail); };
  const views = {
    async stock() {
      const q = h('input', { type: 'search', placeholder: t('Rechercher'), 'aria-label': t('Rechercher') }), st = h('select', {}, h('option', { value: '' }, 'Tous états'), ['out', 'critical', 'low', 'over', 'ok'].map((s) => h('option', { value: s }, t({ out: 'Rupture', critical: 'Stock critique', low: 'Stock bas', over: 'Surstock', ok: 'OK' }[s])))); const list = h('div');
      async function load(page = 1) { const r = await get(`/stock?page=${page}&q=${encodeURIComponent(q.value)}&state=${st.value}`);
        clear(list).append(table([{ label: 'Produit', render: (s) => h('span', {}, h('strong', {}, s.name), h('div', { class: 'muted' }, s.sku)) }, { label: 'Vendable', num: true, key: 'sellable' }, { label: 'Disponible', num: true, key: 'available' }, { label: 'Réservé', num: true, key: 'reserved' }, { label: 'Quarantaine', num: true, key: 'quarantine' }, { label: 'Casse', num: true, key: 'damaged' }, { label: 'Péremption', render: (s) => s.next_expiry || '' }, { label: 'Statut', render: (s) => statusBadge('stock', s.state) }], r.data, { onRow: (s) => batchesModal(s) }), pager(r, load)); }
      q.oninput = debounce(() => load()); st.onchange = () => load(); body.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, q, st), list); await load();
    },
    async batches() { const rows = await get('/stock/batches'); body.append(batchTable(rows)); },
    async movements() {
      const list = h('div'); const type = h('input', { placeholder: 'Type (sale, receipt…)' }); async function load(page = 1) { const r = await get(`/stock/movements?page=${page}&type=${type.value}`); clear(list).append(table([{ label: 'Date', render: (m) => when(m.created_at) }, { label: 'Produit', key: 'product_name' }, { label: 'Lot', key: 'batch_no' }, { label: 'Type', key: 'movement_type' }, { label: 'Quantité', num: true, render: (m) => (m.qty > 0 ? '+' : '') + m.qty }, { label: 'Compartiment', key: 'bucket' }, { label: 'Utilisateur', key: 'user_name' }, { label: 'Motif', key: 'reason' }], r.data), pager(r, load)); }
      type.onchange = () => load(); body.append(type, list); await load();
    },
    async alerts() {
      const a = await get('/alerts'); const sec = (title, rows, cols, kind) => h('div', { style: { marginBottom: '16px' } }, h('h2', {}, `${title} (${rows.length})`), table(cols, rows));
      body.append(sec(t('Ruptures'), a.out, [{ label: 'Produit', key: 'name' }, { label: 'Seuil min.', num: true, key: 'min_stock' }]), sec(t('Stock critique'), a.critical, [{ label: 'Produit', key: 'name' }, { label: 'Vendable', num: true, key: 'sellable' }, { label: 'Seuil', num: true, key: 'critical_stock' }]),
        sec(t('Stock bas'), a.low, [{ label: 'Produit', key: 'name' }, { label: 'Vendable', num: true, key: 'sellable' }, { label: 'Seuil', num: true, key: 'min_stock' }]),
        sec(`${t('Péremption proche')} (≤ ${a.warnDays} j)`, a.expiring, [{ label: 'Produit', key: 'name' }, { label: 'Lot', key: 'batch_no' }, { label: 'Péremption', key: 'exp_date' }, { label: 'Jours', num: true, key: 'days_left' }, { label: 'Qté', num: true, key: 'qty' }]),
        sec(t('Périmés en stock'), a.expired, [{ label: 'Produit', key: 'name' }, { label: 'Lot', key: 'batch_no' }, { label: 'Péremption', key: 'exp_date' }, { label: 'Qté', num: true, key: 'qty' }]),
        sec('Lots bloqués / rappelés / en quarantaine', a.blocked, [{ label: 'Produit', key: 'name' }, { label: 'Lot', key: 'batch_no' }, { label: 'Statut', key: 'status' }, { label: 'Qté', num: true, key: 'qty' }]));
    },
    async temps() {
      const list = h('div'); const load = async () => { const r = await get('/temperature'); clear(list).append(table([{ label: 'Date', render: (x) => when(x.created_at) }, { label: 'Emplacement', key: 'location' }, { label: '°C', num: true, key: 'celsius' }, { label: 'Statut', render: (x) => badge(x.in_range ? 'Conforme' : 'Hors plage', x.in_range ? 'ok' : 'bad') }, { label: 'Utilisateur', key: 'user_name' }], r)); };
      if (can('temperature.manage')) body.append(h('button', { class: 'btn primary', style: { marginBottom: '12px' }, onclick: () => formModal('Relevé de température', [{ name: 'location', label: 'Emplacement', required: true, value: 'Réfrigérateur 1' }, { name: 'celsius', label: 'Température (°C)', type: 'number', step: '0.1', required: true }], async (v) => { const r = await post('/temperature', v); toast(r.in_range ? 'Relevé enregistré' : 'ALERTE : hors plage', !r.in_range); load(); }) }, '+ Relevé'));
      body.append(list); await load();
    },
  };
  const batchTable = (rows, onRow) => table([{ label: 'Produit', key: 'product_name' }, { label: 'Lot', key: 'batch_no' }, { label: 'Péremption', render: (b) => h('span', {}, b.exp_date, ' ', b.days_left < 0 ? badge('périmé', 'bad') : b.days_left <= 90 ? badge(`${b.days_left} j`, 'warn') : '') }, { label: 'Statut', render: (b) => badge(b.status, b.status === 'ok' ? 'ok' : 'bad') }, { label: 'Disp.', num: true, key: 'qty_available' }, { label: 'Rés.', num: true, key: 'qty_reserved' }, { label: 'Quar.', num: true, key: 'qty_quarantine' }, { label: 'Casse', num: true, key: 'qty_damaged' }, { label: 'Emplacement', key: 'location' }], rows, { onRow });
  async function batchesModal(s) {
    const rows = await get('/stock/batches?product_id=' + s.id); const holder = h('div');
    const draw = (rows) => clear(holder).append(batchTable(rows, (b) => lotActions(b)));
    function lotActions(b) {
      const acts = [h('button', { class: 'btn', onclick: () => trace(b) }, 'Traçabilité')];
      if (can('stock.adjust')) acts.push(h('button', { class: 'btn', onclick: () => adjust(b) }, 'Corriger / perte'), h('button', { class: 'btn', onclick: () => moveBucket(b) }, 'Changer de compartiment'));
      if (can('stock.block_batch')) acts.push(h('button', { class: 'btn danger', onclick: () => block(b) }, 'Statut du lot'));
      modal(`${b.product_name} — lot ${b.batch_no}`, h('div', { class: 'row' }, acts));
    }
    const refresh = async () => draw(await get('/stock/batches?product_id=' + s.id));
    const adjust = (b) => formModal('Correction de stock', [{ name: 'type', label: 'Type', type: 'select', required: true, options: [['loss', 'Perte'], ['breakage', 'Casse'], ['expiry_writeoff', 'Destruction (péremption)'], ['donation', 'Don autorisé'], ['supplier_return', 'Retour fournisseur'], ['correction_in', 'Correction (+)'], ['correction_out', 'Correction (−)']].map(([value, label]) => ({ value, label })) }, { name: 'qty', label: 'Quantité', type: 'number', min: 1, required: true }, { name: 'reason', label: 'Motif', required: true }], async (v) => { await post('/stock/adjust', { ...v, batch_id: b.batch_id }); toast('Stock corrigé'); refresh(); });
    const moveBucket = (b) => formModal('Changer de compartiment', [{ name: 'from', label: 'De', type: 'select', required: true, value: 'quarantine', options: ['available', 'quarantine', 'damaged'] }, { name: 'to', label: 'Vers', type: 'select', required: true, value: 'available', options: ['available', 'quarantine', 'damaged'] }, { name: 'qty', label: 'Quantité', type: 'number', min: 1, required: true }, { name: 'reason', label: 'Motif / contrôle effectué', required: true }], async (v) => { await post('/stock/move-bucket', { ...v, batch_id: b.batch_id }); toast('Déplacé'); refresh(); });
    const block = (b) => formModal('Statut du lot', [{ name: 'status', label: 'Statut', type: 'select', required: true, value: b.status, options: [{ value: 'ok', label: 'OK (vendable)' }, { value: 'quarantine', label: 'Quarantaine' }, { value: 'blocked', label: 'Bloqué' }, { value: 'recalled', label: 'Rappelé' }] }, { name: 'reason', label: 'Motif', required: true }], async (v) => { await post(`/batches/${b.batch_id}/status`, v); toast('Statut mis à jour'); refresh(); });
    async function trace(b) { const tr = await get(`/batches/${b.batch_id}/trace`); modal('Traçabilité — lot ' + tr.batch.batch_no, h('div', {}, h('h3', {}, 'Réceptions (amont)'), table([{ label: 'Bon', key: 'number' }, { label: 'Date', render: (r) => when(r.created_at) }, { label: 'Fournisseur', key: 'supplier' }, { label: 'Qté', num: true, key: 'qty' }, { label: 'Facture', key: 'supplier_invoice_ref' }], tr.receipts), h('h3', { style: { marginTop: '14px' } }, 'Ventes (aval)'), !tr.customers_visible ? h('p', { class: 'muted' }, 'Identité des clients masquée (droit « historique clients » requis).') : null, table([{ label: 'Vente', key: 'number' }, { label: 'Date', render: (r) => when(r.created_at) }, { label: 'Qté', num: true, key: 'qty' }, { label: 'Client', key: 'customer_name' }, { label: 'Tél.', key: 'customer_phone' }], tr.sales)), { wide: true }); }
    draw(rows); modal(s.name, holder, { wide: true });
  }
  box.append(h('h1', {}, t('Stock')), head, body); show('stock');
}
