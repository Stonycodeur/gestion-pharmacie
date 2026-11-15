import { get, post, can, state } from '../api.js';
import { h, clear, money, toMinor, table, pager, badge, modal, formModal, confirmDialog, fail, toast, when, debounce, methodLabel } from '../ui.js';
import { loadMethods, methodsNow, methodOptions, kindOf, kindIcon } from '../paymethods.js';
import { t } from '../i18n.js';
import { receipt } from './pos.js';

export default async function (box) { await loadMethods('pos');
  const list = h('div'); const q = h('input', { type: 'search', placeholder: t('Rechercher') + ' (n°, client)' });
  const st = { good: ['completed', 'ok'], partially_refunded: ['partially_refunded', 'warn'], refunded: ['refunded', 'bad'] };
  const label = { completed: 'Validée', partially_refunded: 'Remb. partiel', refunded: 'Remboursée' };
  async function load(page = 1) { const r = await get(`/sales?page=${page}&q=${encodeURIComponent(q.value)}`); clear(list).append(table([{ label: 'N°', key: 'number' }, { label: 'Date', render: (s) => when(s.created_at) }, { label: 'Client', key: 'customer_name' }, { label: 'Caissier', key: 'cashier_name' }, { label: 'Total', num: true, render: (s) => money(s.total) }, { label: 'Statut', render: (s) => badge(label[s.status], s.status === 'completed' ? 'ok' : s.status === 'refunded' ? 'bad' : 'warn') }], r.data, { onRow: detail }), pager(r, load)); }
  async function detail(row) {
    const s = await get('/sales/' + row.id);
    const body = h('div', {}, h('div', { class: 'row between' }, h('div', {}, h('strong', {}, s.number), ' · ', when(s.created_at)), badge(label[s.status])),
      table([{ label: 'Produit', key: 'product_name' }, { label: 'Lot', key: 'batch_no' }, { label: 'Quantité', num: true, render: (l) => `${l.qty}${l.qty_refunded ? ` (−${l.qty_refunded})` : ''}` }, { label: 'Total', num: true, render: (l) => money(l.line_total) }], s.lines),
      h('p', {}, h('strong', {}, `${t('Total')} : ${money(s.total)}`), ' — ', s.payments.map((p) => `${methodLabel(p.method)} ${money(p.amount)}`).join(', ')), s.refunds.length ? h('div', { class: 'alert warn' }, s.refunds.map((r) => `${r.number} : ${money(r.amount)} — ${r.reason}`).join(' | ')) : null);
    const actions = [h('button', { class: 'btn', onclick: () => { m.close(); receipt(s); } }, t('Ticket'))];
    if (can('sales.refund') && s.status !== 'refunded') actions.push(h('button', { class: 'btn danger', onclick: () => { m.close(); refund(s); } }, t('Rembourser')));
    const m = modal(t('Ventes') + ' ' + s.number, body, { wide: true, actions });
  }
  function refund(s) {
    const qtys = {}; const rows = s.lines.filter((l) => l.qty > l.qty_refunded);
    const reason = h('textarea', { required: true, minLength: 3, placeholder: t('Motif') + ' *' }); const appr = h('input', { placeholder: 'E-mail du responsable (si > seuil)' }), apprPw = h('input', { type: 'password', placeholder: 'Mot de passe du responsable' });
    const meth = h('select', {}, methodsNow().map((x) => h('option', { value: x.code }, x.label)));
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); const lines = Object.entries(qtys).filter(([, v]) => v > 0).map(([id, qty]) => ({ sale_line_id: Number(id), qty })); if (!lines.length) return toast('Choisissez au moins une ligne', true);
      try { const r = await post(`/sales/${s.id}/refund`, { lines, reason: reason.value, method: meth.value, approver: appr.value ? { email: appr.value, password: apprPw.value } : undefined }); toast(`${r.number} : ${money(r.amount)}`); m.close(); load(); } catch (er) { fail(er); } } },
      h('div', { class: 'alert info' }, 'Les produits retournés sont placés en quarantaine jusqu\'au contrôle par un pharmacien.'),
      table([{ label: 'Produit', key: 'product_name' }, { label: 'Quantité', render: (l) => h('input', { type: 'number', min: 0, max: l.qty - l.qty_refunded, value: 0, style: { width: '70px' }, oninput: (e) => (qtys[l.id] = Number(e.target.value)) }) }], rows),
      h('label', { class: 'f' }, t('Motif'), reason), h('label', { class: 'f' }, 'Mode de remboursement', meth), h('div', { class: 'row' }, appr, apprPw), h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { class: 'btn primary' }, t('Rembourser'))));
    const m = modal(t('Rembourser') + ' ' + s.number, form, { wide: true });
  }
  q.oninput = debounce(() => load());
  box.append(h('h1', {}, t('Ventes')), h('div', { class: 'row', style: { marginBottom: '12px' } }, q), list); await load();
}
