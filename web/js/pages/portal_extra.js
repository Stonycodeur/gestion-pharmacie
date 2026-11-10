// Espace client : accueil personnalisable, commandes + paiement en ligne, suivi de livraison en temps réel, personnalisation.
import { get, post, put, state } from '../api.js';
import { h, clear, money, table, badge, fail, toast, when, statusBadge, formModal, modal, icon } from '../ui.js';
import { t } from '../i18n.js';
import { onEvent } from '../events.js';
import { timeline } from './deliveries.js';
import { methodsNow, loadMethods } from '../paymethods.js';
import { phoneField, locate, mapView, fmtM, stars, filePicker, previewFile } from '../net.js';
import { compose, openTicket } from './help.js';

const WIDGETS = { orders: 'Mes commandes', deliveries: 'Mes livraisons', prescriptions: 'Mes ordonnances', payments: 'Paiements', catalog: 'Catalogue', history: 'Historique' };
export const prefsGet = async () => { try { return await get('/me/preferences'); } catch { return {}; } };
const DKIND = { issued: 'warn', received: 'info', in_progress: 'info', delivered: 'ok', failed: 'bad', cancelled: '' };

export const driverCard = (d) => (d.driver ? h('div', { class: 'card', style: { background: 'var(--panel2)', padding: '10px 12px', marginTop: '8px' } }, icon('truck', { size: 18 }), ' ', h('strong', {}, d.driver.name), h('div', { class: 'muted' }, `${t('Matricule')} : `, h('strong', {}, d.driver.matricule), d.driver.phone ? ` · ${d.driver.phone}` : '', d.driver.vehicle ? ` · ${d.driver.vehicle}` : '')) : null);
export const deliveryCard = (d) => h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'row between' }, h('div', {}, h('strong', {}, `${t('Livraison')} ${d.number}`), h('div', { class: 'muted' }, `${t('Commande')} ${d.order_number} · ${d.address}`)), badge(d.status_label, DKIND[d.status])), driverCard(d), timeline(d));

export async function orders(body, reload) {
  await loadMethods('online'); const r = await get('/portal/orders'); const online = methodsNow().filter((m) => m.code);
  const pay = async (o) => {
    const due = o.total - o.paid; if (!online.length) return toast(t('Aucun mode de paiement en ligne n\'est proposé par la pharmacie'), true);
    formModal(`${t('Payer')} ${o.number} — ${money(due)}`, [{ name: 'method_code', label: 'Mode de paiement', type: 'select', required: true, options: online.map((m) => ({ value: m.code, label: m.label })) }], async (v) => {
      const res = await post(`/portal/orders/${o.id}/pay`, v);
      if (res.mode === 'redirect') { location.href = res.checkout_url; return; }
      modal(t('Paiement enregistré'), h('p', {}, res.instructions)); reload();
    }, { submitLabel: 'Continuer' });
  };
  const deliver = async (o) => {
    const addr = h('input', { required: true, maxLength: 200, placeholder: 'Adresse de livraison' }), phone = phoneField({ required: true }), notes = h('textarea', { rows: 2, maxLength: 300, placeholder: 'Étage, digicode, repère…' }); const drv = h('div'); let pos = null, choice = null;
    const loadDrivers = async () => { clear(drv).append(h('p', { class: 'muted' }, 'Recherche des chauffeurs disponibles…')); const qs = pos ? `?lat=${pos.lat}&lng=${pos.lng}` : ''; const r = await get(`/portal/orders/${o.id}/delivery-quote${qs}`);
      clear(drv).append(h('h3', {}, 'Chauffeurs disponibles'), ...(r.drivers.length ? r.drivers.map((d) => h('label', { class: 'pcard', style: { cursor: 'pointer' } }, h('input', { type: 'radio', name: 'drv', style: { width: 'auto' }, onchange: () => (choice = d.id) }), h('div', { class: 'grow' }, h('div', { class: 'row between' }, h('strong', {}, d.name), h('strong', {}, money(d.quote.fee))), h('div', { class: 'muted' }, `${d.vehicle_type}${d.plate ? ' · ' + d.plate : ''}`), h('div', {}, stars(d.rating)), h('div', { class: 'muted' }, [d.quote.distance_m != null ? fmtM(d.quote.distance_m) : null, `${d.quote.eta_min}–${d.quote.eta_max} min`].filter(Boolean).join(' · '))))) : [h('div', { class: 'alert info' }, 'Aucun chauffeur disponible pour le moment : la pharmacie en affectera un dès que possible.')]),
        r.drivers.length ? h('label', { class: 'row' }, h('input', { type: 'radio', name: 'drv', checked: true, style: { width: 'auto' }, onchange: () => (choice = null) }), 'Laisser la pharmacie choisir') : null); };
    const geo = h('button', { type: 'button', class: 'btn sm', onclick: async () => { try { pos = await locate(); toast('Position enregistrée : distance et prix calculés'); await loadDrivers(); } catch (e) { fail(e); } } }, icon('pin', { size: 14 }), 'Utiliser ma position');
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); try { await post(`/portal/orders/${o.id}/delivery`, { address: addr.value, phone: phone.value, notes: notes.value || undefined, ...(pos ? { lat: pos.lat, lng: pos.lng } : {}), ...(choice ? { driver_id: choice } : {}) }); toast(t('Demande de livraison envoyée')); m.close(); reload('deliveries'); } catch (er) { fail(er); } } },
      h('label', { class: 'f' }, 'Adresse de livraison', addr), h('div', { class: 'row' }, geo), h('label', { class: 'f' }, 'Téléphone joignable', phone), h('label', { class: 'f' }, 'Instructions', notes), drv, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, h('button', { class: 'btn primary' }, 'Demander la livraison')));
    const m = modal(`${t('Demander la livraison')} — ${o.number}`, form, { wide: true }); loadDrivers().catch(() => clear(drv));
  };
  body.append(table([{ label: 'N°', key: 'number' }, { label: 'Créée', render: (o) => when(o.created_at) }, { label: 'Statut', render: (o) => statusBadge('order', o.status) }, { label: 'Total', num: true, render: (o) => money(o.total) }, { label: 'Payé', num: true, render: (o) => money(o.paid) },
    { label: 'Pharmacie', key: 'pharmacy_name' }, { label: 'Mon message', render: (o) => h('span', {}, o.notes || h('span', { class: 'muted' }, '—')) }, { label: 'Livraison', render: (o) => (o.delivery_id ? badge({ issued: 'Émise', received: 'Reçue', in_progress: 'En cours', delivered: 'Livrée', failed: 'Échec', cancelled: 'Annulée' }[o.delivery_status], DKIND[o.delivery_status]) : '—') },
    { label: '', render: (o) => { const open = !['cancelled', 'expired', 'picked_up'].includes(o.status); return h('span', { class: 'row' }, ['pending', 'confirmed', 'preparing'].includes(o.status) ? h('button', { class: 'btn sm', onclick: () => formModal(`Message — ${o.number}`, [{ name: 'notes', label: 'Message pour la pharmacie (modifiable tant que la commande n\'est pas prête)', type: 'textarea', value: o.notes, maxLength: 500 }], async (v) => { await put(`/portal/orders/${o.id}/message`, { notes: v.notes || '' }); toast('Message envoyé à la pharmacie'); reload('orders'); }) }, icon('message', { size: 14 }), 'Message') : null, h('button', { class: 'btn sm', onclick: async () => { try { const hs = await get(`/portal/orders/${o.id}/history`); modal(`Historique des messages — ${o.number}`, h('div', {}, hs.length ? hs.map((x) => h('div', { class: 'list-item' }, h('span', {}, x.notes || '(supprimé)'), h('small', { class: 'muted' }, when(x.at)))) : h('div', { class: 'empty' }, 'Aucun message'))); } catch (e) { fail(e); } } }, icon('history', { size: 14 }), 'Historique'), open && o.total - o.paid > 0 ? h('button', { class: 'btn sm primary', onclick: () => pay(o).catch(fail) }, icon('wallet', { size: 14 }), t('Payer en ligne')) : null, open && !o.delivery_id ? h('button', { class: 'btn sm', onclick: () => deliver(o) }, icon('truck', { size: 14 }), t('Livraison')) : null, o.delivery_id ? h('button', { class: 'btn sm', onclick: () => reload('deliveries') }, icon('history', { size: 14 }), t('Suivre')) : null); } }], r, { empty: 'Aucune commande' }));
  return r;
}
export async function deliveries(body) {
  const box = h('div'); let timer = null;
  const chat = async (d) => { const th = h('div', { class: 'thread' }), inp = h('input', { placeholder: 'Votre message…', maxLength: 500, style: { flex: 1 } });
    const load = async () => { const r = await get(`/portal/deliveries/${d.id}/messages`); clear(th).append(...r.map((x) => h('div', { class: 'msg' + (x.sender_role === 'customer' ? ' me' : '') }, x.body, h('small', { class: 'muted', style: { display: 'block' } }, `${x.sender_name} · ${when(x.created_at)}`)))); th.scrollTop = th.scrollHeight; };
    modal(`Messages — ${d.number}`, h('div', {}, th, h('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); if (!inp.value.trim()) return; try { await post(`/portal/deliveries/${d.id}/messages`, { body: inp.value }); inp.value = ''; load(); } catch (er) { fail(er); } } }, inp, h('button', { class: 'btn primary' }, icon('arrow', { size: 16 }))))); await load(); onEvent('delivery_message', load, th); };
  const live = async (d, holder) => { const paint = async () => { try { const r = await get(`/portal/deliveries/${d.id}/track`); clear(holder);
      if (!r.tracking) { holder.append(h('div', { class: 'muted' }, d.status === 'in_progress' ? 'Position du chauffeur en attente…' : 'Le suivi sur la carte démarre dès que la pharmacie lance la livraison.')); return; }
      holder.append(h('div', { class: 'row between' }, h('strong', {}, r.remaining_m != null ? `À ${fmtM(r.remaining_m)} de chez vous` : 'En route'), r.remaining_min ? h('span', { class: 'badge b-info' }, `≈ ${r.remaining_min} min`) : null),
        mapView({ height: 260, points: [{ ...r.pharmacy, kind: 'pharmacy', label: 'Pharmacie' }, ...(r.destination ? [{ ...r.destination, kind: 'dest', label: 'Vous' }] : []), ...(r.driver?.lat != null ? [{ lat: r.driver.lat, lng: r.driver.lng, kind: 'driver', label: r.driver.name }] : [])], path: r.path || [] }),
        r.driver?.phone ? h('div', { style: { marginTop: '6px' } }, icon('truck', { size: 14 }), ' ', h('a', { href: 'tel:' + r.driver.phone }, `Appeler ${r.driver.name}`)) : null); } catch { /* réseau */ } }; await paint(); return paint; };
  const card = async (d) => { const holder = h('div'); const c = deliveryCard(d); c.append(holder);
    const act = h('div', { class: 'row', style: { marginTop: '10px' } }, d.driver || d.driver_response ? h('button', { class: 'btn sm', onclick: () => chat(d) }, icon('message', { size: 14 }), 'Écrire au chauffeur') : null,
      ['issued', 'received'].includes(d.status) ? h('button', { class: 'btn sm danger', onclick: () => formModal('Annuler la livraison', [{ name: 'reason', label: 'Motif (facultatif)' }], async (v) => { await post(`/portal/deliveries/${d.id}/cancel`, { reason: v.reason || undefined }); toast('Livraison annulée'); draw(); }) }, 'Annuler') : null,
      d.status === 'delivered' && d.driver ? h('button', { class: 'btn sm', onclick: () => formModal('Noter le chauffeur', [{ name: 'stars', label: 'Note (1 à 5)', type: 'number', min: 1, max: 5, required: true, value: 5 }, { name: 'comment', label: 'Commentaire' }], async (v) => { await post(`/portal/deliveries/${d.id}/rate`, { stars: Number(v.stars), comment: v.comment }); toast('Merci pour votre avis'); }) }, icon('star', { size: 14 }), 'Noter') : null,
      d.driver ? h('button', { class: 'btn sm', onclick: () => formModal('Signaler le chauffeur', [{ name: 'reason', label: 'Motif', required: true }, { name: 'details', label: 'Détails', type: 'textarea' }], async (v) => { await post(`/portal/deliveries/${d.id}/report`, v); toast('Signalement transmis à la pharmacie'); }) }, icon('alert', { size: 14 }), 'Signaler') : null);
    c.append(act); if (['in_progress', 'received', 'issued'].includes(d.status)) { const p = await live(d, holder); if (d.status === 'in_progress') (timer ||= []).push(p); } return c; };
  const draw = async () => { const l = await get('/portal/deliveries'); timer = null; clear(box); if (!l.length) { box.append(h('div', { class: 'empty' }, t('Aucune livraison. Demandez la livraison depuis « Mes commandes ».'))); return; } for (const d of l) box.append(await card(d)); };
  body.append(h('div', { class: 'muted', style: { marginBottom: '8px' } }, h('span', { class: 'live' }), t('Suivi en temps réel')), box); await draw();
  const tick = () => (timer || []).forEach((p) => p()); onEvent('driver_location', tick, body); onEvent('delivery', () => draw().catch(() => {}), body); onEvent('order', () => draw().catch(() => {}), body);
}
export async function appointments(body) {
  const phs = (await get('/public/pharmacies')).filter((p) => p.appointments_enabled); const mine = await get('/portal/appointments');
  const ST = { requested: ['Demandé', 'warn'], confirmed: ['Confirmé', 'ok'], refused: ['Refusé', 'bad'], cancelled: ['Annulé', ''], done: ['Terminé', 'info'] };
  const list = table([{ label: 'Date', render: (a) => h('strong', {}, when(a.starts_at)) }, { label: 'Médecin', key: 'doctor' }, { label: 'Pharmacie', key: 'pharmacy_name' }, { label: 'Statut', render: (a) => badge(ST[a.status][0], ST[a.status][1]) }, { label: 'Motif', render: (a) => h('div', {}, a.reason || '', a.file_name ? h('div', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => previewFile({ name: a.file_name, mime: a.file_mime }, `/appointments/${a.id}/file`) }, icon('file', { size: 14 }), a.file_name)) : null) }, { label: 'Réponse', key: 'doctor_note' },
    { label: '', render: (a) => ['requested', 'confirmed'].includes(a.status) ? h('button', { class: 'btn sm danger', onclick: async () => { try { await post(`/portal/appointments/${a.id}/cancel`, {}); toast('Rendez-vous annulé'); body.replaceChildren(); appointments(body); } catch (e) { fail(e); } } }, 'Annuler') : null }], mine, { empty: 'Aucun rendez-vous' });
  const slots = h('div'); const sel = h('select', {}, h('option', { value: '' }, 'Choisir une pharmacie…'), phs.map((p) => h('option', { value: p.id }, p.name)));
  sel.addEventListener('change', async () => { clear(slots); if (!sel.value) return; const r = await get(`/portal/appointments/slots?pharmacy_id=${sel.value}`); slots.append(...(r.slots.length ? r.slots.map((s) => h('div', { class: 'list-item' }, h('span', {}, h('strong', {}, when(s.starts_at)), ` · ${s.doctor} · ${s.duration_min} min`), h('button', { class: 'btn sm primary', onclick: () => { const fp = filePicker({ label: 'Joindre un fichier au motif (ordonnance, analyse, photo — facultatif)' }); formModal(`Rendez-vous — ${s.doctor}`, [{ name: 'reason', label: 'Motif de la consultation', type: 'textarea' }], async (v) => { await post('/portal/appointments', { slot_id: s.id, reason: v.reason, file: await fp.payload() }); toast('Demande envoyée au médecin'); body.replaceChildren(); appointments(body); }, { submitLabel: 'Demander', extra: fp.el }); } }, 'Réserver'))) : [h('div', { class: 'empty' }, 'Aucun créneau disponible')])); });
  body.append(h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', {}, 'Prendre rendez-vous avec un médecin'), phs.length ? h('div', {}, sel, slots) : h('div', { class: 'muted' }, 'Aucune pharmacie du réseau ne propose les rendez-vous en ligne pour le moment.')), h('h3', {}, 'Mes rendez-vous'), list);
}
export async function help(body) { const { default: page } = await import('./help.js'); await page(body); }
export async function home(body, go) {
  const prefs = await prefsGet(); const order = prefs.home_widgets || ['deliveries', 'orders', 'prescriptions', 'payments'];
  const [os, ds, rx] = await Promise.all([get('/portal/orders').catch(() => []), get('/portal/deliveries').catch(() => []), get('/portal/prescriptions').catch(() => [])]);
  const W = {
    orders: () => ['Mes commandes', 'tab:orders', h('div', {}, h('strong', { style: { fontSize: '1.6em' } }, os.filter((o) => !['cancelled', 'expired', 'picked_up'].includes(o.status)).length), ` ${t('en cours')}`)],
    deliveries: () => { const a = ds.filter((d) => ['issued', 'received', 'in_progress'].includes(d.status))[0]; return ['Mes livraisons', 'tab:deliveries', a ? h('div', {}, badge(a.status_label, DKIND[a.status]), h('div', { class: 'muted' }, a.number), driverCard(a)) : h('div', { class: 'muted' }, t('Aucune livraison en cours'))]; },
    prescriptions: () => ['Mes ordonnances', 'tab:rx', h('div', {}, h('strong', { style: { fontSize: '1.6em' } }, rx.filter((x) => ['received', 'to_verify'].includes(x.status)).length), ` ${t('en attente de validation par le pharmacien')}`)],
    payments: () => ['Paiements', 'tab:orders', h('div', {}, h('strong', { style: { fontSize: '1.6em' } }, money(os.filter((o) => !['cancelled', 'expired', 'picked_up'].includes(o.status)).reduce((a, o) => a + Math.max(0, o.total - o.paid), 0))), ` ${t('restant à payer')}`)],
    catalog: () => ['Catalogue', 'tab:catalog', h('div', { class: 'muted' }, t('Rechercher un produit et réserver'))],
    history: () => ['Historique', 'tab:orders', h('div', {}, h('strong', { style: { fontSize: '1.6em' } }, os.length), ` ${t('commandes au total')}`)],
  };
  const grid = h('div', { class: 'wgrid' }); order.filter((k) => W[k]).forEach((k) => { const [title, target, content] = W[k](); grid.append(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', {}, t(title)), h('button', { class: 'btn sm', onclick: () => go(target.slice(4)) }, icon('arrow', { size: 14 }))), content)); });
  body.append(grid.children.length ? grid : h('div', { class: 'empty' }, t('Tous les blocs sont masqués : réactivez-les dans « Personnaliser ».')));
}
export async function custom(body) {
  const prefs = await prefsGet(); let order = prefs.home_widgets || ['deliveries', 'orders', 'prescriptions', 'payments']; const n = { inapp: true, email: false, sms: false, push: true, ...(prefs.notify || {}) };
  const list = h('div'); const save = async (p) => { try { await put('/me/preferences', p); } catch (e) { fail(e); } };
  const draw = () => { clear(list); const all = [...order, ...Object.keys(WIDGETS).filter((k) => !order.includes(k))]; all.forEach((k) => { const on = order.includes(k), i = order.indexOf(k);
    list.append(h('div', { class: 'list-item' }, h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: on, style: { width: 'auto' }, onchange: (e) => { order = e.target.checked ? [...order, k] : order.filter((x) => x !== k); save({ home_widgets: order }); draw(); } }), t(WIDGETS[k])),
      on ? h('span', { class: 'row' }, h('button', { class: 'btn sm', disabled: i === 0, 'aria-label': t('Monter'), onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; save({ home_widgets: order }); draw(); } }, '↑'), h('button', { class: 'btn sm', disabled: i === order.length - 1, 'aria-label': t('Descendre'), onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; save({ home_widgets: order }); draw(); } }, '↓')) : null)); }); };
  draw();
  const ch = (k, label) => h('label', { class: 'row', style: { marginBottom: '6px' } }, h('input', { type: 'checkbox', checked: n[k], style: { width: 'auto' }, onchange: (e) => { n[k] = e.target.checked; save({ notify: { ...n } }); } }), t(label));
  body.append(h('div', { class: 'grid g2' },
    h('div', { class: 'card' }, h('h3', {}, t('Mon écran d\'accueil')), h('p', { class: 'muted' }, t('Choisissez les blocs affichés et leur ordre. Vos choix vous suivent sur tous vos appareils.')), list),
    h('div', { class: 'card' }, h('h3', {}, t('Notifications')), ch('inapp', 'Dans l\'application'), ch('push', 'Notifications push (mobile)'), ch('email', 'Par e-mail'), ch('sms', 'Par SMS'), h('p', { class: 'muted' }, t('Les messages de sécurité (réinitialisation de mot de passe) sont toujours envoyés.'))),
    h('div', { class: 'card' }, h('h3', {}, t('Apparence')), h('p', { class: 'muted' }, t('Thème, couleur, taille du texte, densité, langue.')), h('button', { class: 'btn primary', onclick: async () => (await import('../personalize.js')).personalize({ onLang: () => location.reload() }) }, icon('palette', { size: 16 }), t('Personnaliser l\'interface')))));
}
