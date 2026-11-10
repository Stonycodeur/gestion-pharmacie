import { get, put, post, del, can, state } from '../api.js';
import { h, clear, fail, toast, formModal, confirmDialog, icon } from '../ui.js';
import { t } from '../i18n.js';

export default async function (box) {
  const { permissions, roles } = await get('/roles'); const edit = can('roles.manage'); const sets = Object.fromEntries(roles.map((r) => [r.code, new Set(r.permissions)]));
  box.append(h('h1', {}, t('Rôles & droits')), h('p', { class: 'sub' }, 'Matrice RBAC. Les droits sont appliqués côté serveur sur chaque route et ressource.'));
  if (state.user.role === 'super_admin') {
    const custom = roles.filter((r) => !r.builtin);
    box.append(h('div', { class: 'card', style: { marginBottom: '14px' } }, h('div', { class: 'row between' }, h('h2', {}, 'Rôles personnalisés'), h('button', { class: 'btn sm primary', onclick: () => formModal('Nouveau rôle', [{ name: 'code', label: 'Code (a-z, 0-9, _)', required: true, hint: 'Ex. : auditeur_stock' }, { name: 'label', label: 'Libellé', required: true }, { name: 'privileged', label: 'Rôle privilégié (MFA obligatoire si activée)', type: 'checkbox' }], async (v) => { await post('/roles', { ...v, permissions: [] }); toast('Rôle créé : cochez ses permissions puis enregistrez'); location.reload(); }) }, icon('plus', { size: 14 }), 'Nouveau rôle')),
      custom.length ? custom.map((r) => h('div', { class: 'list-item' }, h('span', {}, h('strong', {}, r.label), ' ', h('small', { class: 'muted' }, `${r.code} · ${r.users} compte(s)`)), h('span', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => formModal('Renommer le rôle', [{ name: 'label', label: 'Libellé', required: true, value: r.label }], async (v) => { await put('/roles/' + r.code, v); location.reload(); }) }, icon('edit', { size: 14 })),
        h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(`Supprimer le rôle « ${r.label} » ?`, { danger: true })) try { await del('/roles/' + r.code); location.reload(); } catch (e) { fail(e); } } }, icon('trash', { size: 14 }))))) : h('p', { class: 'muted' }, 'Aucun rôle personnalisé : créez-en pour des profils sur mesure (les 10 rôles intégrés restent modifiables en permissions).')));
  }
  const head = h('tr', {}, h('th', {}, 'Permission'), roles.map((r) => h('th', { title: r.code, style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: '150px' } }, r.label)));
  const rows = permissions.map((p) => h('tr', {}, h('td', {}, h('div', {}, p.label), h('small', { class: 'muted' }, p.code)), roles.map((r) => h('td', { style: { textAlign: 'center' } }, h('input', { type: 'checkbox', checked: sets[r.code].has(p.code), disabled: !edit || r.code === 'super_admin', 'aria-label': `${r.label} : ${p.label}`, onchange: (e) => (e.target.checked ? sets[r.code].add(p.code) : sets[r.code].delete(p.code)) })))));
  box.append(h('div', { class: 'tw' }, h('table', {}, h('thead', {}, head), h('tbody', {}, rows))));
  if (edit) box.append(h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: async () => { try { for (const r of roles) if (r.code !== 'super_admin') await put(`/roles/${r.code}/permissions`, { permissions: [...sets[r.code]] }); toast('Permissions enregistrées (journalisé)'); } catch (e) { fail(e); } } }, t('Enregistrer'))));
}
