// Éléments communs des livraisons : profils partagés, messagerie avec pièces jointes (lecture seule pour la pharmacie), note, signalement, appel.
import { get, post, postQueued } from '../api.js';
import { h, clear, fail, toast, badge, icon, when, modal, formModal } from '../ui.js';
import { stars, filePicker, previewFile } from '../net.js';
import { onEvent } from '../events.js';

const mimeOf = (n) => (/\.pdf$/i.test(n || '') ? 'application/pdf' : 'image/jpeg');
export const avatar = (url, name, size = 48) => (url ? h('img', { class: 'avatar', src: url, alt: name || 'Photo', style: { width: size + 'px', height: size + 'px' }, loading: 'lazy' }) : h('div', { class: 'avatar', style: { width: size + 'px', height: size + 'px' }, 'aria-hidden': 'true' }, (name || '?').trim().charAt(0).toUpperCase()));
export const callBtn = (phone, label = 'Appeler') => (phone ? h('a', { class: 'btn sm', href: 'tel:' + phone }, icon('phone', { size: 14 }), label) : null);

// Profils partagés : qui vient avec le produit / à qui le remettre.
export async function partiesCard(base, id, viewer) {
  const p = await get(`${base}/deliveries/${id}/parties`), card = h('div', { class: 'card', style: { margin: '8px 0' } });
  const row = (title, who, extra) => h('div', { class: 'offer', style: { padding: '6px 0' } }, avatar(who.photo_url, who.name, 52), h('div', { style: { flex: 1, minWidth: '160px' } }, h('small', { class: 'muted' }, title), h('div', {}, h('strong', {}, who.name || '—')), extra), title === 'Vous' ? null : callBtn(who.phone));
  if (p.driver) card.append(row(viewer === 'driver' ? 'Vous' : 'Chauffeur', p.driver, h('div', { class: 'muted' }, [p.driver.matricule && `Matricule ${p.driver.matricule}`, p.driver.vehicle_type, p.driver.plate].filter(Boolean).join(' · '), ' ', stars(p.driver.rating))));
  else card.append(h('div', { class: 'muted' }, 'Le chauffeur sera affiché dès son départ de la pharmacie avec le produit.'));
  if (p.customer) card.append(row(viewer === 'customer' ? 'Vous' : 'Client', p.customer, h('div', { class: 'muted' }, p.customer.address || '')));
  if (p.pharmacy) card.append(h('div', { class: 'muted' }, icon('pin', { size: 14 }), ' ', p.pharmacy.name, p.pharmacy.address ? ' — ' + p.pharmacy.address : ''));
  return card;
}

// Messagerie : ouverte dès le départ ; la pharmacie ne fait que lire (readOnly).
export async function chatModal(base, d, { me = 'customer', readOnly = false } = {}) {
  const closed = !!d.status && d.status !== 'in_progress'; readOnly = readOnly || closed;
  const th = h('div', { class: 'thread' }), inp = h('input', { placeholder: 'Votre message…', maxLength: 500, style: { flex: 1 } }), fp = filePicker({ label: 'Pièce jointe (photo ou PDF)' });
  const load = async () => {
    const r = await get(`${base}/deliveries/${d.id}/messages`); clear(th).append(...(r.length ? r : []).map((x) => h('div', { class: 'msg' + (x.sender_role === me ? ' me' : '') }, x.body === '📎' ? null : x.body, x.has_file ? h('div', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => previewFile({ name: x.file_name, mime: mimeOf(x.file_name) }, `/delivery-files/message/${x.id}`) }, icon('file', { size: 14 }), x.file_name || 'Pièce jointe')) : null, h('small', { class: 'muted', style: { display: 'block' } }, `${x.sender_name} · ${when(x.created_at)}`))));
    if (!r.length) th.append(h('div', { class: 'empty' }, 'Aucun message')); th.scrollTop = th.scrollHeight;
  };
  const send = readOnly ? h('p', { class: 'muted' }, closed ? 'Livraison terminée : la conversation est fermée. Seul l\'historique reste consultable.' : 'Lecture seule : seuls le client et le chauffeur peuvent écrire.') : h('form', { onsubmit: async (e) => { e.preventDefault(); if (!inp.value.trim() && !fp.file) return; try { const file = await fp.payload(); const r = await postQueued(`${base}/deliveries/${d.id}/messages`, { body: inp.value, file }, 'Message'); if (r?.queued) toast('Hors connexion : message envoyé au retour du réseau'); inp.value = ''; load().catch(() => {}); } catch (er) { fail(er); } } }, h('div', { class: 'row' }, inp, h('button', { class: 'btn primary', 'aria-label': 'Envoyer' }, icon('arrow', { size: 16 }))), fp.el);
  modal(`${closed ? 'Historique' : 'Messages'} — ${d.number}`, h('div', {}, th, send), { wide: true }); try { await load(); } catch (e) { fail(e); }
  onEvent('delivery_message', (m) => { if (!m || m.delivery_id === d.id) load().catch(() => {}); }, th);
}
export const rateModal = (base, d, who) => formModal(`Noter ${who}`, [{ name: 'stars', label: 'Votre note (une seule fois)', type: 'select', required: true, value: '5', options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: '★'.repeat(n) + '☆'.repeat(5 - n) + ` (${n}/5)` })) }, { name: 'comment', label: 'Message (facultatif)', type: 'textarea', maxLength: 300 }], async (v) => { await postQueued(`${base}/deliveries/${d.id}/rate`, { stars: Number(v.stars), comment: v.comment }, 'Note'); toast('Merci ! Votre note sera comptée après validation par l\'administration'); });
export function reportModal(base, d, who) {
  const fp = filePicker({ label: 'Pièce jointe (preuve : photo ou PDF)' });
  formModal(`Signaler ${who}`, [{ name: 'reason', label: 'Motif', required: true }, { name: 'details', label: 'Détails', type: 'textarea' }], async (v) => { await post(`${base}/deliveries/${d.id}/report`, { ...v, file: await fp.payload() }); toast('Signalement transmis à la pharmacie et aux administrateurs'); }, { extra: fp.el });
}
