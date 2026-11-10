// Corbeille : restauration ou suppression définitive ; vidée automatiquement après 90 jours.
import { get, post, del } from '../api.js';
import { h, clear, fail, toast, badge, icon, table, when, confirmDialog, tabs } from '../ui.js';

const LBL = { user: 'Utilisateur', supplier: 'Fournisseur', product: 'Produit', driver: 'Chauffeur' };
export default async function (box) {
  let ent = ''; const body = h('div'), head = h('div');
  const draw = async () => { clear(head).append(h('div', { class: 'row between' }, tabs([['', 'Tout'], ...Object.entries(LBL)], ent, (k) => { ent = k; draw(); }), h('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog('Vider définitivement la corbeille ? Cette action est irréversible.', { danger: true, label: 'Vider' })) try { const r = await post('/trash/empty', {}); toast(`${r.purged} élément(s) supprimé(s)`); draw(); } catch (e) { fail(e); } } }, icon('trash', { size: 16 }), 'Vider la corbeille')));
    clear(body); try { const r = await get('/trash' + (ent ? '?entity=' + ent : ''));
      body.append(h('p', { class: 'muted' }, `Les éléments sont supprimés définitivement après ${r.retention_days} jours.`), table([{ label: 'Type', render: (x) => badge(LBL[x.entity] || x.entity, 'info') }, { label: 'Élément', render: (x) => h('strong', {}, x.label) }, { label: 'Supprimé le', render: (x) => when(x.deleted_at) }, { label: 'Suppression définitive', render: (x) => when(x.purge_at) },
        { label: '', render: (x) => h('span', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: async () => { try { await post(`/trash/${x.id}/restore`, {}); toast('Restauré'); draw(); } catch (e) { fail(e); } } }, icon('restore', { size: 14 }), 'Restaurer'),
          h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(`Supprimer définitivement « ${x.label} » ?`, { danger: true })) try { const d = await del('/trash/' + x.id); toast(d.mode === 'anonymized' ? 'Compte anonymisé (historique conservé)' : d.mode === 'archived' ? 'Archivé : déjà utilisé dans l\'historique' : 'Supprimé définitivement'); draw(); } catch (e) { fail(e); } } }, icon('trash', { size: 14 }), 'Supprimer')) }], r.items, { empty: 'La corbeille est vide' })); } catch (e) { fail(e); } };
  box.append(h('h1', {}, 'Corbeille'), head, body); await draw();
}
