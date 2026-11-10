import { get, post, put, del, can } from '../api.js';
import { h, clear, money, table, pager, badge, modal, formModal, confirmDialog, fail, toast, when, debounce, icon } from '../ui.js';
import { t } from '../i18n.js';

export default async function (box) {
  const list = h('div'); const q = h('input', { type: 'search', placeholder: t('Rechercher'), 'aria-label': t('Rechercher') });
  const F = (c = {}) => [{ name: 'name', label: 'Nom', required: true, value: c.name }, { name: 'phone', label: 'Téléphone', value: c.phone }, { name: 'email', label: 'E-mail', type: 'email', value: c.email }, { name: 'address', label: 'Adresse', value: c.address }, { name: 'birth_date', label: 'Date de naissance', type: 'date', value: c.birth_date }, { name: 'marketing_consent', label: 'Consentement aux communications marketing', type: 'checkbox', value: c.marketing_consent }];
  async function load(page = 1) { const r = await get(`/customers?page=${page}&q=${encodeURIComponent(q.value)}`); clear(list).append(table([{ label: 'Nom', key: 'name' }, { label: 'Téléphone', key: 'phone' }, { label: 'E-mail', key: 'email' }, { label: 'Points', num: true, key: 'loyalty_points' }, { label: 'Marketing', render: (c) => (c.marketing_consent ? icon('check', { size: 16 }) : '') }], r.data, { onRow: open }), pager(r, load)); }
  async function open(row) {
    const c = await get('/customers/' + row.id); const extra = h('div', { class: 'row', style: { marginBottom: '8px' } });
    if (can('customers.history')) extra.append(h('button', { type: 'button', class: 'btn sm', onclick: async () => { const hs = await get(`/customers/${c.id}/history`); modal('Historique — ' + c.name, h('div', {}, h('p', { class: 'muted' }, 'Consultation journalisée.'), table([{ label: 'N°', key: 'number' }, { label: 'Date', render: (s) => when(s.created_at) }, { label: 'Total', num: true, render: (s) => money(s.total) }, { label: 'Statut', key: 'status' }], hs.sales)), { wide: true }); } }, 'Historique d\'achats'));
    if (can('customers.manage')) extra.append(h('button', { type: 'button', class: 'btn sm danger', onclick: async () => { if (await confirmDialog('Anonymiser ce client (droit à l\'effacement) ? Les écritures comptables sont conservées sans identité.', { danger: true })) { await post(`/customers/${c.id}/anonymize`); toast('Client anonymisé'); load(); } } }, 'Anonymiser'));
    if (can('users.manage')) extra.append(h('button', { type: 'button', class: 'btn sm danger', onclick: async () => { if (await confirmDialog('Supprimer ce client ? Définitif si aucun historique ; sinon anonymisé (écritures conservées sans identité). Son compte en ligne éventuel est supprimé aussi.', { danger: true, label: 'Supprimer' })) { const r = await del('/customers/' + c.id); toast(r.mode === 'deleted' ? 'Client supprimé' : 'Client anonymisé'); load(); document.querySelector('.overlay')?.remove(); } } }, icon('trash', { size: 14 }), 'Supprimer'));
    formModal('Client', F(c), async (v) => { await put('/customers/' + c.id, v); toast('Client enregistré'); load(); }, { extra });
  }
  q.oninput = debounce(() => load());
  box.append(h('div', { class: 'row between' }, h('h1', {}, t('Clients')), can('customers.manage') ? h('button', { class: 'btn primary', onclick: () => formModal('Nouveau', F(), async (v) => { await post('/customers', v); load(); }) }, '+ ' + t('Nouveau')) : null), h('div', { style: { margin: '12px 0' } }, q), list); await load();
}
