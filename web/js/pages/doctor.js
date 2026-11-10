// Espace médecin : créneaux de rendez-vous (activables en ligne) et demandes des clients.
import { get, post, put, del } from '../api.js';
import { previewFile } from '../net.js';
import { h, clear, fail, toast, badge, icon, table, when, formModal, confirmDialog, tabs } from '../ui.js';

const ST = { requested: ['Demandé', 'warn'], confirmed: ['Confirmé', 'ok'], refused: ['Refusé', 'bad'], cancelled: ['Annulé', ''], done: ['Terminé', 'info'] };
export default async function (box) {
  let tab = 'appts'; const body = h('div'), head = h('div');
  const draw = async () => { clear(head).append(tabs([['appts', 'Demandes de rendez-vous'], ['slots', 'Mes créneaux']], tab, (k) => { tab = k; draw(); })); clear(body); try { await (tab === 'slots' ? slots : appts)(body, draw); } catch (e) { fail(e); } };
  box.append(h('h1', {}, 'Espace médecin'), head, body); await draw();
}
async function appts(body, redraw) {
  const rows = await get('/doctor/appointments');
  const dec = (a, status, label) => formModal(`${label} - ${a.customer_name}`, [{ name: 'note', label: 'Message au client (facultatif)', type: 'textarea' }], async (v) => { await post(`/doctor/appointments/${a.id}/decision`, { status, note: v.note }); toast('Enregistré'); redraw(); }, { submitLabel: label });
  body.append(table([{ label: 'Date', render: (a) => h('strong', {}, when(a.starts_at)) }, { label: 'Durée', render: (a) => a.duration_min + ' min' }, { label: 'Client', render: (a) => h('span', {}, a.customer_name, a.customer_phone ? h('div', {}, h('a', { href: 'tel:' + a.customer_phone }, a.customer_phone)) : null) }, { label: 'Motif', render: (a) => h('div', {}, a.reason || '', a.file_name ? h('div', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => previewFile({ name: a.file_name, mime: a.file_mime }, `/appointments/${a.id}/file`) }, icon('file', { size: 14 }), a.file_name)) : null) }, { label: 'Statut', render: (a) => badge(ST[a.status][0], ST[a.status][1]) },
    { label: '', render: (a) => h('span', { class: 'row' }, a.status === 'requested' ? h('button', { class: 'btn sm primary', onclick: () => dec(a, 'confirmed', 'Confirmer') }, 'Confirmer') : null, ['requested', 'confirmed'].includes(a.status) ? h('button', { class: 'btn sm danger', onclick: () => dec(a, 'refused', 'Refuser') }, 'Refuser') : null, a.status === 'confirmed' ? h('button', { class: 'btn sm', onclick: () => dec(a, 'done', 'Terminer') }, 'Terminé') : null) }], rows, { empty: 'Aucune demande' }));
}
async function slots(body, redraw) {
  const rows = await get('/doctor/slots');
  body.append(h('div', { class: 'row between' }, h('p', { class: 'muted' }, 'Un créneau n\'est proposé aux clients que si la prise de rendez-vous est activée pour votre pharmacie par l\'administrateur ET pour ce créneau.'),
    h('button', { class: 'btn primary', onclick: () => formModal('Nouveau créneau', [{ name: 'starts_at', label: 'Date et heure', type: 'datetime-local', required: true }, { name: 'duration_min', label: 'Durée (minutes)', type: 'number', value: 20, required: true }, { name: 'online_enabled', label: 'Réservable en ligne', type: 'checkbox', value: true }], async (v) => { await post('/doctor/slots', { starts_at: new Date(v.starts_at).toISOString(), duration_min: Number(v.duration_min), online_enabled: !!v.online_enabled }); redraw(); }) }, icon('plus', { size: 16 }), 'Ajouter un créneau')),
    table([{ label: 'Date', render: (s) => h('strong', {}, when(s.starts_at)) }, { label: 'Durée', render: (s) => s.duration_min + ' min' }, { label: 'État', render: (s) => badge({ open: 'Libre', booked: 'Réservé', cancelled: 'Supprimé' }[s.status], s.status === 'open' ? 'ok' : s.status === 'booked' ? 'warn' : '') },
      { label: 'En ligne', render: (s) => h('input', { type: 'checkbox', checked: !!s.online_enabled, style: { width: 'auto' }, disabled: s.status !== 'open', onchange: async (e) => { try { await put('/doctor/slots/' + s.id, { online_enabled: e.target.checked }); } catch (er) { fail(er); e.target.checked = !e.target.checked; } } }) },
      { label: '', render: (s) => s.status === 'open' ? h('button', { class: 'btn sm danger', 'aria-label': 'Supprimer', onclick: async () => { if (await confirmDialog('Supprimer ce créneau ?', { danger: true })) try { await del('/doctor/slots/' + s.id); redraw(); } catch (e) { fail(e); } } }, icon('trash', { size: 14 })) : null }], rows.filter((s) => s.status !== 'cancelled'), { empty: 'Aucun créneau' }));
}
