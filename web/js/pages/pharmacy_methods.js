// Modes de paiement DE CETTE PHARMACIE : où chaque mode est proposé au client (à la caisse, à la livraison, en ligne).
import { get, put, state } from '../api.js';
import { h, clear, fail, toast, badge, icon, table } from '../ui.js';
import { t } from '../i18n.js';

export default async function () {
  const isSuper = state.user.role === 'super_admin', card = h('div', { class: 'card', style: { marginTop: '14px' } }), list = h('div');
  let phId = state.pharmacy?.id; const phs = isSuper ? await get('/pharmacies').catch(() => []) : [];
  const sel = isSuper ? h('select', { 'aria-label': t('Pharmacie'), onchange: () => { phId = Number(sel.value); load(); } }, phs.map((p) => h('option', { value: p.id, selected: p.id === phId }, p.name))) : null;
  const flag = (m, k, label, locked) => { const c = h('input', { type: 'checkbox', checked: !!m[k], disabled: !!locked, 'aria-label': `${m.label} — ${label}`, onchange: async () => { try { await put(`/pharmacy-payment-methods/${m.code}`, { pharmacy_id: phId, [k]: c.checked }); m[k] = c.checked ? 1 : 0; toast(t('Enregistré')); } catch (e) { c.checked = !c.checked; fail(e); } } }); return c; };
  const load = async () => {
    const rows = await get('/pharmacy-payment-methods' + (isSuper ? `?pharmacy_id=${phId}` : '')).catch((e) => { fail(e); return []; });
    clear(list).append(table([{ label: 'Mode', render: (m) => h('span', {}, h('strong', {}, m.label), ' ', m.global_enabled ? null : badge(t('Désactivé par l\'administrateur'), 'warn')) },
      { label: 'Proposé', render: (m) => flag(m, 'enabled', t('Proposé')) }, { label: 'À la caisse', render: (m) => flag(m, 'at_counter', t('À la caisse')) }, { label: 'À la livraison', render: (m) => flag(m, 'on_delivery', t('À la livraison')) },
      { label: 'En ligne', render: (m) => h('span', {}, flag(m, 'online', t('En ligne'), !m.global_online), !m.global_online ? h('small', { class: 'muted' }, ' ' + t('non activé pour ce mode')) : null) }], rows, { empty: t('Aucun mode') }));
  };
  card.append(h('h2', {}, icon('wallet', { size: 18 }), ' ', t('Modes de paiement de la pharmacie')), h('p', { class: 'muted' }, t('Chaque pharmacie a ses propres modes. Les modes usuels (espèces à la caisse, carte, paiement à la livraison…) sont créés automatiquement ; cochez où chacun est proposé au client.')), sel || '', list);
  await load(); return card;
}
