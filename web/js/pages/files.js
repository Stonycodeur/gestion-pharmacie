// Centre de fichiers : tout ce qui est envoyé et reçu (pièces jointes des échanges, ordonnances) avec aperçu, validation, enregistrement ou rejet.
import { get, post, can } from '../api.js';
import { h, clear, fail, toast, badge, icon, table, tabs, when, formModal } from '../ui.js';
import { previewFile } from '../net.js';

const ST = { pending: ['En attente', 'warn'], accepted: ['Validé', 'ok'], saved: ['Enregistré', 'info'], rejected: ['Rejeté', 'bad'] };
export default async function (box) {
  let tab = 'in'; const body = h('div'), head = h('div');
  const show = (id) => { tab = id; draw(); };
  const draw = async () => { clear(head).append(tabs([['in', 'Reçus'], ['out', 'Envoyés']], tab, show)); clear(body); try { const rows = await get('/files?box=' + tab);
    body.append(table([{ label: '', render: (f) => icon(f.mime === 'application/pdf' ? 'file' : 'image', { size: 20 }) }, { label: 'Fichier', render: (f) => h('button', { class: 'btn sm', onclick: () => f.owner_type === 'prescription' ? previewFile(f, `/prescriptions/${f.owner_id}/file`) : previewFile(f) }, f.name) },
      { label: tab === 'in' ? 'De' : 'Pharmacie', render: (f) => tab === 'in' ? f.sender_name || '—' : f.pharmacy_name || '—' }, { label: 'Origine', render: (f) => f.owner_type === 'prescription' ? `Ordonnance ${f.number || ''}` : 'Conversation' }, { label: 'Date', render: (f) => when(f.created_at) },
      { label: 'Statut', render: (f) => f.owner_type === 'prescription' ? badge(f.status, 'info') : badge(ST[f.status][0], ST[f.status][1]) },
      { label: '', render: (f) => f.owner_type === 'prescription' ? h('a', { class: 'btn sm', href: '#/prescriptions' }, 'Ouvrir l\'ordonnance') : (tab === 'in' && f.status === 'pending' ? h('span', { class: 'row' },
        ...[['accepted', 'Valider', 'check'], ['saved', 'Enregistrer', 'inbox'], ['rejected', 'Rejeter', 'x']].map(([d, l, ic]) => h('button', { class: 'btn sm' + (d === 'rejected' ? ' danger' : d === 'accepted' ? ' primary' : ''), onclick: () => formModal(`${l} « ${f.name} »`, [{ name: 'note', label: d === 'rejected' ? 'Motif (visible par l\'expéditeur)' : 'Note (facultatif)', type: 'textarea' }], async (v) => { await post(`/files/${f.id}/decision`, { decision: d, note: v.note }); toast('Décision enregistrée'); draw(); }, { submitLabel: l }) }, icon(ic, { size: 14 }), l))) : (f.note ? h('small', { class: 'muted' }, f.note) : null)) }], rows, { empty: tab === 'in' ? 'Aucun fichier reçu' : 'Aucun fichier envoyé' })); } catch (e) { fail(e); } };
  box.append(h('h1', {}, 'Fichiers'), head, body); await draw();
}
