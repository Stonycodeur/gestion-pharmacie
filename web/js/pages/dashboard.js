import { get, can } from '../api.js';
import { h, money, barChart, table, badge } from '../ui.js';
import { t } from '../i18n.js';

export default async function (box) {
  const d = await get('/dashboard');
  const COL = { bad: 'var(--danger)', warn: 'var(--warn)', ok: 'var(--ok)' };
  const kpi = (label, v, kind, href) => h('a', { class: 'card kpi', href, style: { textDecoration: 'none', color: 'inherit', borderInlineStartWidth: '5px', borderInlineStartColor: COL[kind] || 'var(--line)' } }, h('div', { class: 'l' }, t(label)), h('div', { class: 'v' }, v));
  box.append(h('h1', {}, t('Tableau de bord')), h('p', { class: 'sub' }, new Date().toLocaleDateString(undefined, { dateStyle: 'full' })));
  const k = h('div', { class: 'grid g4' });
  if (d.today) k.append(h('div', { class: 'card kpi' }, h('div', { class: 'l' }, t('Chiffre d\'affaires du jour')), h('div', { class: 'v' }, money(d.today.total)), h('div', { class: 'muted' }, `${d.today.tickets} ${t('tickets')}`)),
    h('div', { class: 'card kpi' }, h('div', { class: 'l' }, t('Chiffre d\'affaires du mois')), h('div', { class: 'v' }, money(d.month.total)), h('div', { class: 'muted' }, `${d.month.tickets} ${t('tickets')}`)));
  const a = d.alerts;
  k.append(kpi('Ruptures', a.out, a.out ? 'bad' : 'ok', '#/stock'), kpi('Stock critique', a.critical, a.critical ? 'bad' : 'ok', '#/stock'), kpi('Stock bas', a.low, a.low ? 'warn' : 'ok', '#/stock'),
    kpi('Péremption proche', a.expiring, a.expiring ? 'warn' : 'ok', '#/stock'), kpi('Périmés en stock', a.expired, a.expired ? 'bad' : 'ok', '#/stock'));
  if (d.prescriptions_to_verify != null) k.append(kpi('Ordonnances à vérifier', d.prescriptions_to_verify, d.prescriptions_to_verify ? 'warn' : 'ok', '#/prescriptions'));
  if (d.orders_open != null) k.append(kpi('Commandes en cours', d.orders_open, '', '#/orders'));
  box.append(k);
  if (d.series) box.append(h('div', { class: 'grid g2', style: { marginTop: '14px' } },
    h('div', { class: 'card' }, h('h2', {}, t('Ventes sur 14 jours')), d.series.length ? barChart(d.series) : h('div', { class: 'empty' }, t('Aucun résultat'))),
    h('div', { class: 'card' }, h('h2', {}, t('Produits les plus vendus')), table([{ label: 'Nom', key: 'name' }, { label: 'Quantité', key: 'qty', num: true }], d.top))));
}
