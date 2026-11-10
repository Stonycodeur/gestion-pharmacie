import { get, post, put, can } from '../api.js';
const cats = await get('/categories').catch(() => []);
import { h, clear, table, pager, badge, modal, formModal, fail, toast, when } from '../ui.js';
import { t } from '../i18n.js';

const ST = { open: ['Ouvert', 'warn'], submitted: ['Soumis', 'info'], validated: ['Validé', 'ok'], cancelled: ['Annulé', 'bad'] };
export default async function (box) {
  const list = h('div');
  async function load(page = 1) { const r = await get('/inventories?page=' + page); clear(list).append(table([{ label: 'Libellé', key: 'label' }, { label: 'Type', key: 'kind' }, { label: 'Créé le', render: (i) => when(i.created_at) }, { label: 'Par', key: 'created_by_name' }, { label: 'Lignes', num: true, key: 'lines' }, { label: 'Écarts', num: true, key: 'variances' }, { label: 'Statut', render: (i) => badge(ST[i.status][0], ST[i.status][1]) }], r.data, { onRow: open }), pager(r, load)); }
  async function open(row) {
    const inv = await get('/inventories/' + row.id); const counts = {}, reasons = {};
    const editable = inv.status === 'open';
    const rows = inv.lines.map((l) => ({ ...l }));
    const tb = table([{ label: 'Produit', render: (l) => h('span', {}, h('strong', {}, l.product_name), h('div', { class: 'muted' }, l.sku)) }, { label: 'Lot', key: 'batch_no' }, { label: 'Péremption', key: 'exp_date' }, inv.blind ? null : { label: 'Théorique', num: true, key: 'expected_qty' },
      { label: 'Compté', render: (l) => editable ? h('input', { type: 'number', min: 0, value: l.counted_qty ?? '', style: { width: '80px' }, oninput: (e) => (counts[l.batch_id] = e.target.value === '' ? undefined : Number(e.target.value)) }) : l.counted_qty },
      { label: 'Justification de l\'écart', render: (l) => editable || inv.status === 'submitted' ? h('input', { value: l.reason || '', placeholder: 'si écart', onchange: (e) => (reasons[l.batch_id] = e.target.value) }) : l.reason }].filter(Boolean), rows);
    const acts = []; const save = async () => { const lines = rows.filter((l) => counts[l.batch_id] !== undefined || reasons[l.batch_id] !== undefined).map((l) => ({ batch_id: l.batch_id, counted_qty: counts[l.batch_id] ?? l.counted_qty ?? 0, reason: reasons[l.batch_id] ?? l.reason })); if (lines.length) await put(`/inventories/${inv.id}/lines`, { lines }); };
    if (editable) acts.push(h('button', { class: 'btn', onclick: async () => { try { await save(); toast('Comptage enregistré'); } catch (e) { fail(e); } } }, 'Enregistrer'), h('button', { class: 'btn primary', onclick: async () => { try { await save(); await post(`/inventories/${inv.id}/submit`); m.close(); load(); toast('Inventaire soumis'); } catch (e) { fail(e); } } }, 'Soumettre'));
    if (inv.status === 'submitted' && can('inventory.validate')) acts.push(h('button', { class: 'btn', onclick: async () => { try { await save(); } catch (e) { fail(e); } } }, 'Enregistrer justifications'), h('button', { class: 'btn primary', onclick: async () => { try { await save().catch(() => {}); const r = await post(`/inventories/${inv.id}/validate`); m.close(); load(); toast(`${r.adjustments} ajustement(s) appliqué(s)`); } catch (e) { fail(e); } } }, 'Valider et ajuster le stock'));
    const m = modal(inv.label, h('div', {}, badge(ST[inv.status][0], ST[inv.status][1]), inv.blind ? h('div', { class: 'alert info' }, 'Comptage en aveugle : le stock théorique est masqué.') : null, tb), { wide: true, actions: acts });
  }
  box.append(h('div', { class: 'row between' }, h('h1', {}, t('Inventaires')), h('button', { class: 'btn primary', onclick: () => formModal('Nouvel inventaire', [{ name: 'label', label: 'Libellé', required: true, value: 'Inventaire ' + new Date().toLocaleDateString() }, { name: 'kind', label: 'Type', type: 'select', required: true, value: 'full', options: [{ value: 'full', label: 'Complet' }, { value: 'cycle', label: 'Tournant (catégorie)' }] }, { name: 'category_id', label: 'Catégorie (inventaire tournant)', type: 'select', options: cats.map((c) => ({ value: c.id, label: c.name })) }], async (v) => { const r = await post('/inventories', v); toast(`${r.lines} ligne(s)`); load(); }) }, '+ ' + t('Nouveau'))), list);
  await load();
}
