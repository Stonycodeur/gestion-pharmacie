// Centre d'aide : messages et réclamations (client → pharmacie), réponses signées, échanges entre pharmacies, recherche inter-pharmacies.
import { get, post, can, state } from '../api.js';
import { soft } from '../silent.js';
import { h, clear, fail, toast, badge, icon, table, tabs, when, modal, formModal, debounce, money } from '../ui.js';
import { filePicker, previewFile, fmtKm } from '../net.js';
import { onEvent } from '../events.js';

const KIND = { message: 'Message', claim: 'Réclamation', interpharmacy: 'Entre pharmacies' };
const ST = { open: ['Ouvert', 'warn'], answered: ['Répondu', 'ok'], closed: ['Clôturé', ''] };
const isCustomer = () => (can('portal.use') || can('driver.use')) && !can('help.view'); // client ou chauffeur : mode « utilisateur » (écrire à une pharmacie, suivre ses conversations)

export default async function (box) {
  const body = h('div'); const customer = isCustomer(); let tab = 'in';
  const show = (id) => { tab = id; draw(); };
  const run = (b) => (tab === 'search' ? search : list)(b, tab, customer, show).catch(fail);
  const draw = (silent = false) => { if (!silent) { clear(body); return run(body); } const tmp = h('div'); return run(tmp).then(() => { if (tmp.innerHTML !== body.innerHTML) body.replaceChildren(...tmp.childNodes); }); }; // mise à jour : rendu hors écran, remplacé seulement si différent
  const items = customer ? [['in', 'Mes conversations']] : [['in', 'Reçus'], ['out', 'Envoyés'], ...(can('inter.search') ? [['search', 'Rechercher chez d\'autres pharmacies']] : [])];
  const head = h('div'); const nav = () => clear(head).append(h('div', { class: 'row between' }, tabs(items, tab, show), h('button', { class: 'btn primary', onclick: () => compose(customer, draw) }, icon('plus', { size: 16 }), customer ? 'Écrire à une pharmacie' : 'Contacter une pharmacie')));
  box.append(h('h1', {}, 'Centre d\'aide'), head, body); nav(); draw();
  onEvent('help', () => { if (tab !== 'search') soft(body, () => draw(true)); }, box);
  const t0 = new URLSearchParams(location.hash.split('?')[1] || '').get('ticket'); if (t0) openTicket(Number(t0), customer, draw);
}

async function pharmaciesFor(customer) { return customer ? (can('driver.use') ? get('/driver/pharmacies') : get('/public/pharmacies')) : get('/inter/pharmacies'); }
export async function compose(customer, done, preset = {}) {
  const phs = await pharmaciesFor(customer); const pick = filePicker({ label: 'Pièce jointe (photo ou PDF, 3 Mo max) — aperçu avant envoi' });
  formModal(customer ? 'Nouveau message' : 'Contacter une pharmacie', [
    { name: 'pharmacy_id', label: 'Pharmacie', type: 'select', required: true, options: phs.map((p) => ({ value: p.id, label: p.name + (p.city ? ` — ${p.city}` : '') })), value: preset.pharmacy_id },
    ...(customer ? [{ name: 'kind', label: 'Type', type: 'select', required: true, options: [{ value: 'message', label: 'Message' }, { value: 'claim', label: 'Réclamation' }], value: preset.kind || 'message' }] : []),
    { name: 'subject', label: 'Objet', required: true, value: preset.subject, maxLength: 160 }, { name: 'body', label: 'Message', type: 'textarea', required: true, value: preset.body }], async (v) => {
    const r = await post('/help/tickets', { ...v, pharmacy_id: Number(v.pharmacy_id), file: await pick.payload() }); toast(`Envoyé — ${r.number}`); done(); openTicket(r.id, customer, done);
  }, { wide: true, submitLabel: 'Envoyer', extra: pick.el });
}
async function list(body, tab, customer, show) {
  const rows = await get('/help/tickets' + (customer ? '' : `?box=${tab}`));
  body.append(table([{ label: 'N°', key: 'number' }, { label: 'Objet', render: (r) => h('strong', {}, r.subject) }, { label: 'Type', render: (r) => badge(KIND[r.kind], r.kind === 'claim' ? 'bad' : 'info') },
    { label: customer ? 'Pharmacie' : tab === 'in' ? 'De' : 'Vers', render: (r) => customer ? r.pharmacy_name : tab === 'in' ? (r.from_pharmacy_name ? `${r.from_name} — ${r.from_pharmacy_name}` : r.from_name) : r.pharmacy_name },
    { label: 'Statut', render: (r) => badge(ST[r.status][0], ST[r.status][1]) }, { label: 'Mis à jour', render: (r) => when(r.updated_at) }], rows, { onRow: (r) => openTicket(r.id, customer, () => show(tab)), empty: 'Aucune conversation' }));
}
export async function openTicket(id, customer, done) {
  const view = h('div'); let m;
  const paint = async () => {
    const t = await get('/help/tickets/' + id); clear(view);
    view.append(h('div', { class: 'row between' }, h('div', {}, badge(KIND[t.kind], t.kind === 'claim' ? 'bad' : 'info'), ' ', badge(ST[t.status][0], ST[t.status][1])), h('span', { class: 'muted' }, t.number)),
      h('div', { class: 'thread', style: { margin: '10px 0' } }, t.messages.map((x) => h('div', { class: 'msg' + (customer ? (x.from_staff ? '' : ' me') : (x.from_staff ? ' me' : '')) }, h('div', {}, x.body),
        x.attachments.map((a) => h('div', {}, h('button', { class: 'btn sm', onclick: () => previewFile(a) }, icon('image', { size: 14 }), a.name), a.status !== 'pending' ? ' ' : '', a.status !== 'pending' ? badge({ accepted: 'Validé', saved: 'Enregistré', rejected: 'Rejeté' }[a.status], a.status === 'rejected' ? 'bad' : 'ok') : null)),
        h('small', { class: 'muted' }, x.signature || x.author_name, ' · ', when(x.created_at))))));
    if (t.status === 'closed') return;
    const txt = h('textarea', { rows: 3, placeholder: 'Votre réponse…', required: true }); const pick = filePicker({ label: 'Joindre un fichier' });
    const asSel = !customer && can('help.reply') ? h('select', { 'aria-label': 'Signature' }, h('option', { value: 'user' }, `Signer en mon nom — ${state.user.name} (${state.pharmacy?.name || 'ma pharmacie'})`), h('option', { value: 'pharmacy' }, `Signer au nom de la pharmacie — ${state.pharmacy?.name || ''}`)) : null;
    if (!customer && !can('help.reply')) { view.append(h('div', { class: 'alert info' }, 'Vous pouvez lire cette conversation mais vous n\'avez pas le droit d\'y répondre.')); return; }
    view.append(h('form', { onsubmit: async (e) => { e.preventDefault(); try { await post(`/help/tickets/${id}/messages`, { body: txt.value, reply_as: asSel?.value, file: await pick.payload() }); await paint(); done?.(); } catch (er) { fail(er); } } }, h('label', { class: 'f' }, 'Répondre', txt), asSel ? h('label', { class: 'f' }, 'Signature (la pharmacie figure toujours)', asSel) : null, pick.el,
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('button', { type: 'button', class: 'btn', onclick: async () => { await post(`/help/tickets/${id}/close`, {}); m.close(); done?.(); } }, 'Clôturer'), h('button', { class: 'btn primary' }, icon('arrow', { size: 16 }), 'Envoyer'))));
  };
  m = modal('Conversation', view, { wide: true }); await paint().catch((e) => { m.close(); fail(e); });
}
async function search(body) {
  const q = h('input', { type: 'search', placeholder: 'Nom du médicament…', 'aria-label': 'Médicament', style: { width: '100%' } }), out = h('div');
  const run = async () => { const term = q.value.trim(); if (term.length < 2) return clear(out); const r = await get('/inter/search?q=' + encodeURIComponent(term));
    clear(out).append(table([{ label: 'Produit', render: (x) => h('strong', {}, `${x.name} ${x.dosage || ''}`) }, { label: 'Pharmacie', render: (x) => x.pharmacy_name + (x.city ? ` — ${x.city}` : '') }, { label: 'Distance', render: (x) => fmtKm(x.distance_km) }, { label: 'Téléphone', render: (x) => x.phone ? h('a', { href: 'tel:' + x.phone }, x.phone) : '—' },
      { label: '', render: (x) => h('button', { class: 'btn sm primary', onclick: () => compose(false, () => {}, { pharmacy_id: x.pharmacy_id, subject: `Demande : ${x.name} ${x.dosage || ''}`, body: 'Bonjour, pouvez-vous nous mettre de côté ce produit ? Merci.' }) }, icon('message', { size: 14 }), 'Contacter') }], r, { empty: 'Aucune autre pharmacie ne l\'a disponible' })); };
  q.addEventListener('input', debounce(() => run().catch(fail), 350)); body.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Seule la disponibilité est affichée (pas les quantités). Contactez directement la pharmacie depuis cette page.'), q), out);
}
