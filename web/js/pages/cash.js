import { get, post, can } from '../api.js';
import { h, clear, money, table, pager, badge, formModal, confirmDialog, fail, toast, when, methodLabel, modal } from '../ui.js';
import { t } from '../i18n.js';

export default async function (box) {
  const cur = can('cash.use') ? await get('/cash/current') : null; const list = h('div');
  box.append(h('h1', {}, t('Ma caisse')));
  if (can('cash.use')) {
    if (!cur) {
      const regs = await get('/cash/registers');
      box.append(h('div', { class: 'card' }, h('p', {}, 'Aucune session ouverte.'), h('button', { class: 'btn primary', onclick: () => formModal('Ouvrir la caisse', [{ name: 'register_id', label: 'Caisse', type: 'select', required: true, options: regs.map((r) => ({ value: r.id, label: r.name })) }, { name: 'opening_float', label: 'Fond de caisse', type: 'money', value: 0 }], async (v) => { await post('/cash/open', v); location.reload(); }) }, t('Ouvrir la caisse'))));
    } else {
      box.append(h('div', { class: 'grid g4' }, h('div', { class: 'card kpi' }, h('div', { class: 'l' }, 'Espèces attendues'), h('div', { class: 'v' }, money(cur.expected_cash))), h('div', { class: 'card kpi' }, h('div', { class: 'l' }, 'Ventes de la session'), h('div', { class: 'v' }, cur.sales)),
        ...cur.by_method.map((m) => h('div', { class: 'card kpi' }, h('div', { class: 'l' }, methodLabel(m.method)), h('div', { class: 'v' }, money(m.total))))),
        h('div', { class: 'row', style: { margin: '14px 0' } },
          h('button', { class: 'btn', onclick: () => mv('cash_in', 'Entrée d\'espèces') }, '+ Entrée'), h('button', { class: 'btn', onclick: () => mv('cash_out', 'Sortie d\'espèces') }, '− Sortie'),
          h('button', { class: 'btn danger', onclick: close }, t('Fermer la caisse'))));
      function mv(kind, title) { formModal(title, [{ name: 'amount', label: 'Montant', type: 'money', required: true }, { name: 'reason', label: 'Motif', required: true }], async (v) => { await post('/cash/movement', { kind, ...v }); location.reload(); }); }
      function close() { formModal('Fermer la caisse', [{ name: 'counted_cash', label: 'Espèces comptées', type: 'money', required: true, hint: `Attendu : ${money(cur.expected_cash)}` }, { name: 'reason', label: 'Justification de l\'écart (si écart)', type: 'textarea' }], async (v) => { const r = await post('/cash/close', v); toast(`Écart : ${money(r.difference)}`); location.reload(); }); }
    }
  }
  box.append(h('h2', {}, 'Sessions'), list);
  async function load(page = 1) { const r = await get('/cash/sessions?page=' + page); clear(list).append(table([{ label: 'Ouverture', render: (s) => when(s.opened_at) }, { label: 'Caisse', key: 'register_name' }, { label: 'Utilisateur', key: 'user_name' }, { label: 'Attendu', num: true, render: (s) => (s.expected_cash != null ? money(s.expected_cash) : '') }, { label: 'Compté', num: true, render: (s) => (s.counted_cash != null ? money(s.counted_cash) : '') },
    { label: 'Écart', num: true, render: (s) => (s.difference == null ? '' : badge(money(s.difference), s.difference === 0 ? 'ok' : 'bad')) }, { label: 'Statut', render: (s) => badge(s.status, s.status === 'open' ? 'warn' : '') }], r.data), pager(r, load)); }
  await load();
}
