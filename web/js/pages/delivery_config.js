// Paramètres des livraisons (administrateur / super-administrateur) : tarifs de base des 4 modes, coût au km, distance maximale, délais, majoration express, négociation.
import { get, put } from '../api.js';
import { h, fail, toast, icon } from '../ui.js';
import { t } from '../i18n.js';

export default async function () {
  const c = await get('/delivery-config'), f = 10 ** (c.decimals || 0), maj = (v) => (v / f), min = (v) => Math.round(Number(v) * f);
  const num = (value, extra = {}) => h('input', { type: 'number', step: 'any', min: 0, value, style: { maxWidth: '130px' }, ...extra });
  const base = {}, eta = {}; const rows = Object.entries(c.modes).map(([m, label]) => { base[m] = num(maj(c.base[m])); eta[m] = [num(c.eta[m][0], { step: 1 }), num(c.eta[m][1], { step: 1 })];
    return h('tr', {}, h('td', {}, h('strong', {}, t(label))), h('td', { 'data-label': t('Tarif de base') }, base[m], ' ', c.currency), h('td', { 'data-label': t('Délai estimé (min)') }, m === 'scheduled' ? h('span', { class: 'muted' }, t('à l\'heure choisie')) : h('span', { class: 'row', style: { gap: '4px' } }, eta[m][0], '–', eta[m][1]))); });
  const perKm = num(maj(c.per_km)), maxKm = num(c.max_km), pct = num(c.express_pct), margin = num(c.margin_pct), neg = h('input', { type: 'checkbox', checked: c.negotiation, style: { width: 'auto' } });
  const save = h('button', { class: 'btn primary', type: 'button', onclick: async () => { try { await put('/delivery-config', { base: Object.fromEntries(Object.keys(base).map((m) => [m, min(base[m].value)])), eta: Object.fromEntries(Object.keys(eta).map((m) => [m, [Number(eta[m][0].value), Number(eta[m][1].value)]])), per_km: min(perKm.value), max_km: Number(maxKm.value), express_pct: Number(pct.value), negotiation: neg.checked, margin_pct: Number(margin.value) }); toast(t('Enregistré')); } catch (e) { fail(e); } } }, t('Enregistrer'));
  const F = (label, el, unit, hint) => h('label', { class: 'f' }, t(label), h('span', { class: 'row', style: { gap: '6px' } }, el, unit ? h('span', { class: 'muted' }, unit) : null), hint ? h('small', { class: 'muted' }, t(hint)) : null);
  return h('div', { class: 'card', style: { marginTop: '14px' } }, h('h2', {}, icon('truck', { size: 18 }), ' ', t('Livraison : modes et tarifs')),
    h('p', { class: 'muted' }, t('Prix de la course = (tarif de base du mode + coût au km × distance pharmacie → client), majoré pour l\'Express. Les chauffeurs ne peuvent négocier que dans la marge ci-dessous.')),
    h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Mode', 'Tarif de base', 'Délai estimé (min)'].map((x) => h('th', {}, t(x))))), h('tbody', {}, rows)),
    h('div', { class: 'grid g2', style: { marginTop: '10px' } }, F('Coût par kilomètre', perKm, c.currency), F('Distance maximale de livraison', maxKm, 'km'), F('Majoration Express', pct, '%', 'Ajoutée au prix du mode Express'),
      F('Marge maximale de négociation', margin, '%', 'Écart autorisé (+/-) entre le prix du chauffeur et le tarif'), h('label', { class: 'row', style: { gap: '8px' } }, neg, t('Autoriser les chauffeurs à négocier le prix'))), h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, save));
}
