import { get, qs, download } from '../api.js';
import { h, clear, table, pager, when, debounce, modal, badge } from '../ui.js';
import { t } from '../i18n.js';

export default async function (box) {
  const list = h('div'); const q = h('input', { type: 'search', placeholder: 'Action, utilisateur, objet…' }), from = h('input', { type: 'date' }), to = h('input', { type: 'date' }), ent = h('input', { placeholder: 'Entité (sale, user…)' });
  async function load(page = 1) { const r = await get('/audit' + qs({ page, q: q.value, from: from.value, to: to.value, entity: ent.value })); clear(list).append(table([{ label: 'Date', render: (a) => when(a.created_at), nowrap: true }, { label: 'Utilisateur', key: 'user_email' }, { label: 'Action', render: (a) => badge(a.action, a.action.startsWith('view.') ? 'info' : a.action.includes('failed') ? 'bad' : '') }, { label: 'Objet', render: (a) => `${a.entity || ''} ${a.entity_id || ''}` }, { label: 'IP', key: 'ip' }], r.data, { onRow: (a) => modal(a.action, h('div', {}, h('p', {}, `${a.created_at} — ${a.user_email || ''} — ${a.ip || ''}`), h('h3', {}, 'Avant'), h('pre', { style: { whiteSpace: 'pre-wrap' } }, a.old_json || '—'), h('h3', {}, 'Après'), h('pre', { style: { whiteSpace: 'pre-wrap' } }, a.new_json || '—')), { wide: true }) }), pager(r, load)); }
  [q, ent].forEach((e) => (e.oninput = debounce(() => load()))); from.onchange = to.onchange = () => load();
  box.append(h('h1', {}, t('Journal d\'audit')), h('p', { class: 'sub' }, 'Journal en ajout seul : toute modification ou suppression est refusée par la base. Les consultations de données sensibles sont tracées.'), h('div', { class: 'row', style: { marginBottom: '12px' } }, q, ent, from, to), list); await load();
}
