// Espace chauffeur : disponibilité, courses proposées (accepter au prix du tarif ou proposer le sien), « produit récupéré », GPS en direct,
// messagerie / appel / note / signalement, photo de profil et pièce d'identité. Fonctionne en données mobiles, Wi-Fi et hors connexion (file d'attente).
import { get, post, put, postQueued, state } from '../api.js';
import { h, clear, fail, toast, badge, icon, money, formModal, modal, fromMinor, toMinor, historyToggle, when } from '../ui.js';
import { mapView, fmtM, stars, locate, filePicker, previewFile, directionsLink } from '../net.js';
import { onEvent } from '../events.js';
import { t } from '../i18n.js';
import { avatar, callBtn, partiesCard, chatModal, rateModal, reportModal } from './delivery_common.js';

const AV = { offline: ['Hors ligne', ''], available: ['Disponible', 'ok'], busy: ['En course', 'warn'] };
const ST = { issued: 'Émise', received: 'Reçue', in_progress: 'En cours', delivered: 'Livrée', failed: 'Échec', cancelled: 'Annulée' };
let watch = null, lastSent = 0, lastPos = null;
const fm = (n, o) => `${(n / 10 ** (o.decimals ?? 0)).toLocaleString(undefined, { minimumFractionDigits: o.decimals ?? 0, maximumFractionDigits: o.decimals ?? 0 })} ${o.currency || ''}`.trim();
function stopGps() { if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; } }
function startGps() {
  if (!navigator.geolocation) return toast('GPS indisponible sur cet appareil', true); stopGps();
  watch = navigator.geolocation.watchPosition((p) => { lastPos = p.coords; const now = Date.now(); if (now - lastSent < 5000) return; lastSent = now; postQueuedLoc(p.coords); },
    (e) => toast(e.code === 1 ? 'Autorisez la localisation pour être suivi par le client' : 'Position introuvable', true), { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
}
const postQueuedLoc = async (c) => { try { await post('/driver/location', { lat: c.latitude, lng: c.longitude }); } catch { /* hors ligne : la position suivante prend le relais */ } };

export default async function (box) {
  const root = h('div'); box.append(h('h1', {}, 'Espace chauffeur'), root); let me, busy = false;
  const act = (fn) => async () => { try { await fn(); } catch (e) { fail(e); } };
  const draw = async () => {
    if (busy) return; busy = true;
    try {
      me = await get('/driver/me'); const [dl, of] = await Promise.all([get('/driver/deliveries'), get('/driver/offers').catch(() => ({ data: [] }))]); const hid = await get('/driver/offers?hidden=1').catch(() => ({ data: [] })); clear(root);
      const [avl, avk] = AV[me.availability], gpsOn = watch != null;
      root.append(h('div', { class: 'grid g2' },
        h('div', { class: 'card' }, h('div', { class: 'offer' }, h('button', { class: 'linklike', type: 'button', 'aria-label': 'Changer ma photo de profil', onclick: () => photoModal() }, avatar(me.photo_url, me.name, 64)), h('div', { style: { flex: 1 } }, h('h2', { style: { margin: 0 } }, me.name), h('div', { class: 'muted' }, `${me.vehicle_type} · ${me.plate || me.matricule}`), h('div', {}, stars(me.rating), me.rating_count ? h('small', { class: 'muted' }, ` (${me.rating_count} avis)`) : null)), badge(avl, avk)),
          !me.photo_url || !me.has_id_doc ? h('p', { class: 'muted' }, icon('info', { size: 14 }), ' Complétez votre profil : ', !me.photo_url ? 'photo de profil ' : '', !me.has_id_doc ? 'pièce d\'identité' : '') : null,
          h('div', { class: 'seg', style: { margin: '12px 0' } }, ...['offline', 'available'].map((v) => h('button', { class: 'btn' + (me.availability === v ? ' primary' : ''), disabled: me.availability === 'busy', onclick: act(async () => { await put('/driver/me', { availability: v }); if (v === 'available' && !gpsOn) startGps(); if (v === 'offline') stopGps(); draw(); }) }, v === 'offline' ? 'Hors ligne' : 'Disponible'))),
          h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: gpsOn, style: { width: 'auto' }, onchange: (e) => { e.target.checked ? startGps() : stopGps(); } }), 'Partager ma position en temps réel'),
          h('p', { class: 'muted' }, 'Gardez cette page ouverte pendant vos courses : la position est envoyée toutes les 5 secondes.'),
          h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => photoModal() }, icon('image', { size: 14 }), 'Photo de profil'), h('button', { class: 'btn sm', onclick: () => idModal() }, icon('file', { size: 14 }), me.has_id_doc ? 'Pièce d\'identité (remplacer)' : 'Déposer ma pièce d\'identité'), me.has_id_doc ? h('button', { class: 'btn sm', onclick: act(() => previewFile({ name: 'Pièce d\'identité', mime: 'image/jpeg' }, '/driver/me/id-doc')) }, 'Voir') : null)),
        h('div', { class: 'card' }, h('h2', {}, 'Mes tarifs'), h('p', { class: 'muted' }, 'Fixés par l\'administrateur. Vous pouvez proposer un autre prix pour une course précise (la pharmacie, son administrateur et les super-administrateurs en sont alertés).'),
          h('div', {}, 'Frais de base : ', h('strong', {}, money(me.base_fee))), h('div', {}, 'Par kilomètre : ', h('strong', {}, money(me.per_km))), h('div', {}, 'Vitesse moyenne ', h('strong', {}, `${me.speed_kmh} km/h`), ` · attente ${me.wait_min} min`),
          h('h3', { style: { marginTop: '12px' } }, 'Mes pharmacies et lieux de départ'), ...(me.pharmacies?.length ? me.pharmacies.map((p) => h('div', { class: 'muted' }, icon('pin', { size: 14 }), ' ', h('strong', {}, p.name), p.depart_label ? ' — ' + p.depart_label : p.depart_lat != null ? ' — position enregistrée' : ' — position de la pharmacie')) : [h('div', { class: 'muted' }, me.pharmacy?.name || '')]),
          h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: () => profileModal() }, icon('edit', { size: 14 }), 'Mon véhicule et mes coordonnées'), ' ', h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: async () => (await import('../personalize.js')).personalize({ onLang: () => location.reload() }) }, icon('palette', { size: 14 }), 'Sonnerie, langue, apparence'))));
      // ----- courses proposées -----
      root.append(h('h2', { style: { marginTop: '16px' } }, `Courses proposées${of.data.length ? ` (${of.data.length})` : ''}`));
      if (me.availability === 'offline') root.append(h('div', { class: 'empty' }, 'Passez en « Disponible » pour recevoir les courses proposées.'));
      else if (!of.data.length) root.append(h('div', { class: 'empty' }, 'Aucune course proposée pour le moment. Les nouvelles courses apparaissent ici en direct.'));
      for (const o of of.data) root.append(offer(o));
      if (hid.data.length) root.append(h('details', { style: { marginTop: '10px' } }, h('summary', {}, `Courses masquées (${hid.data.length})`), ...hid.data.map((o) => h('div', { class: 'card history', style: { marginTop: '8px' } }, h('div', { class: 'row between' }, h('span', {}, h('strong', {}, o.number), ' — ', o.address), h('strong', {}, fm(o.price, { currency: o.currency, decimals: o.decimals }))), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: act(async () => { await post(`/driver/offers/${o.id}/unhide`, {}); toast('Course de nouveau affichée'); draw(); }) }, icon('eye', { size: 14 }), 'Démasquer')))));
      const closed = (d) => ['delivered', 'failed', 'cancelled'].includes(d.status), act_ = dl.data.filter((d) => !closed(d)), past = dl.data.filter(closed);
      const sq = h('input', { type: 'search', placeholder: 'Rechercher une course (n°, adresse, client…)', 'aria-label': 'Rechercher une course', style: { maxWidth: '420px' } });
      const list = h('div'), paintList = () => { const q = sq.value.trim().toLowerCase(), m = (d) => !q || JSON.stringify(d).toLowerCase().includes(q); clear(list).append(...(act_.filter(m).length ? act_.filter(m).map((d) => course(d, dl.pharmacy)) : [h('div', { class: 'empty' }, q ? 'Aucun résultat' : 'Aucune course en cours')]), ...(past.filter(m).length ? [h('h3', { style: { marginTop: '14px' } }, `Historique (${past.filter(m).length})`), ...past.filter(m).map((d) => h('div', { class: 'history' }, course(d, dl.pharmacy)))] : [])); };
      sq.oninput = paintList; paintList(); root.append(h('h2', { style: { marginTop: '16px' } }, 'Mes courses'), h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, sq, historyToggle()), list);
    } catch (e) { clear(root).append(h('div', { class: 'empty' }, e.status === 0 ? 'Hors connexion : les dernières données sont affichées dès qu\'elles sont en cache. Vos actions seront envoyées au retour du réseau.' : e.message)); }
    finally { busy = false; }
  };
  const offer = (o) => {
    const mine = o.my_offer, c = h('div', { class: 'card', style: { marginBottom: '12px', borderLeft: '4px solid var(--accent, #0f766e)' } },
      h('div', { class: 'row between' }, h('span', {}, h('strong', {}, o.number), ' ', badge(o.mode_label || 'Livraison Standard', o.mode === 'express' ? 'bad' : o.mode === 'economy' ? 'ok' : 'info'), o.scheduled_at ? h('div', { class: 'muted' }, icon('clock', { size: 13 }), ' ', t('Programmée'), ' : ', when(o.scheduled_at.replace(' ', 'T') + 'Z')) : null), h('strong', { style: { fontSize: '1.2em' } }, fm(o.price, { currency: o.currency, decimals: o.decimals }))),
      o.customer_name ? h('div', { class: 'muted' }, icon('user', { size: 14 }), ' ', t('Client'), ' : ', o.customer_name) : null,
      h('div', {}, icon('store', { size: 14 }), ' Départ : ', h('strong', {}, o.pharmacy_name), o.pharmacy_address ? ' — ' + o.pharmacy_address : ''), h('div', {}, icon('pin', { size: 14 }), ' Livraison : ', o.address),
      h('div', { class: 'muted' }, [o.distance_m != null ? `Trajet ${fmtM(o.distance_m)}` : null, o.pickup_distance_m != null ? `Jusqu'à la pharmacie ${fmtM(o.pickup_distance_m)}` : null, o.notes].filter(Boolean).join(' · ')));
    if (o.pharmacy_lat != null && o.dest_lat != null) c.append(mapView({ height: 180, points: [{ lat: o.pharmacy_lat, lng: o.pharmacy_lng, kind: 'pharmacy', label: o.pharmacy_name }, { lat: o.dest_lat, lng: o.dest_lng, kind: 'dest', label: 'Client' }] }));
    const row = h('div', { class: 'row', style: { marginTop: '10px' } });
    if (mine?.kind === 'counter' && mine.status === 'pending') row.append(badge(`Votre prix ${fm(mine.price, { currency: o.currency, decimals: o.decimals })} — en attente du client`, 'info'));
    row.append(h('button', { class: 'btn primary', onclick: act(async () => { const r = await postQueued(`/driver/offers/${o.id}/accept`, {}, 'Accepter ' + o.number); if (r.queued) toast('Hors connexion : acceptation envoyée au retour du réseau'); else toast(`Course acceptée — ${fm(r.price, { currency: o.currency, decimals: o.decimals })}. La pharmacie peut lancer la livraison.`); if (watch == null) startGps(); draw(); }) }, icon('check', { size: 16 }), 'Accepter ce prix'),
      h('button', { class: 'btn', onclick: () => formModal('Proposer mon prix', [{ name: 'price', label: `Mon prix (${o.currency})`, type: 'number', step: 'any', min: 0, required: true, value: (o.price / 10 ** o.decimals).toFixed(o.decimals), hint: `Tarif standard : ${fm(o.price, { currency: o.currency, decimals: o.decimals })}. La pharmacie, son administrateur et les super-administrateurs seront alertés ; le client choisira.` }], async (v) => { const r = await postQueued(`/driver/offers/${o.id}/accept`, { price: Math.round(Number(v.price) * 10 ** o.decimals) }, 'Prix proposé ' + o.number); toast(r.queued ? 'Proposition envoyée au retour du réseau' : r.counter ? 'Votre prix a été transmis' : 'Course acceptée'); draw(); }, { submitLabel: 'Envoyer' }) }, icon('cash', { size: 16 }), 'Proposer mon prix'),
      h('button', { class: 'btn sm', onclick: act(async () => { await post(`/driver/offers/${o.id}/decline`, {}); draw(); }) }, 'Masquer'));
    c.append(row); return c;
  };
  const course = (d, ph) => {
    const live = d.status === 'in_progress', accepted = d.driver_response === 'accepted', offered = ['issued', 'received'].includes(d.status) && d.driver_response === 'pending', open = ['issued', 'received', 'in_progress'].includes(d.status);
    const c = h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'row between' }, h('strong', {}, d.number), badge(offered ? 'À accepter' : ST[d.status], offered ? 'warn' : d.status === 'delivered' ? 'ok' : live ? 'info' : '')),
      h('div', {}, icon('pin', { size: 14 }), ' ', d.address), h('div', { class: 'muted' }, [d.distance_m != null ? fmtM(d.distance_m) : null, d.eta_min ? `${d.eta_min}–${d.eta_max} min` : null, `Prix : ${money(d.fee)}`].filter(Boolean).join(' · ')), d.notes ? h('div', { class: 'muted' }, d.notes) : null);
    const slot = h('div'); c.append(slot); partiesCard('/driver', d.id, 'driver').then((p) => slot.append(p)).catch(() => {});
    if (d.dest_lat != null && open) { // course terminée : plus d'itinéraire
      const pos = lastPos && open ? [{ lat: lastPos.latitude, lng: lastPos.longitude, kind: 'driver', label: 'Moi' }] : [];
      c.append(mapView({ height: 240, stage: d.picked_up_at ? 'delivery' : 'pickup', points: [{ lat: d.pharmacy_lat ?? ph?.lat, lng: d.pharmacy_lng ?? ph?.lng, kind: 'pharmacy', label: d.pharmacy_name || ph?.name || 'Pharmacie' }, { lat: d.dest_lat, lng: d.dest_lng, kind: 'dest', label: 'Client' }, ...pos] }));
    }
    const row = h('div', { class: 'row', style: { marginTop: '10px' } });
    if (offered) row.append(h('button', { class: 'btn primary', onclick: act(async () => { await postQueued(`/driver/deliveries/${d.id}/respond`, { accept: true }, 'Accepter ' + d.number); if (watch == null) startGps(); draw(); }) }, icon('check', { size: 16 }), 'Accepter'), h('button', { class: 'btn danger', onclick: act(async () => { await post(`/driver/deliveries/${d.id}/respond`, { accept: false }); draw(); }) }, 'Refuser'));
    if (['issued', 'received'].includes(d.status) && accepted) row.append(h('span', { class: 'muted' }, 'Acceptée — rendez-vous à la pharmacie'), h('button', { class: 'btn primary', onclick: act(async () => { const r = await postQueued(`/driver/deliveries/${d.id}/pickup`, {}, 'Produit récupéré ' + d.number); toast(r.queued ? 'Départ enregistré, envoyé au retour du réseau' : 'Départ enclenché : le client suit votre trajet'); if (watch == null) startGps(); draw(); }) }, icon('check', { size: 16 }), 'Produit récupéré'),
      h('button', { class: 'btn sm danger', onclick: () => formModal('Annuler la course', [{ name: 'reason', label: 'Motif', required: true }], async (v) => { await post(`/driver/deliveries/${d.id}/cancel`, v); draw(); }) }, 'Annuler'));
    if (live && !d.picked_up_at) row.append(h('button', { class: 'btn', onclick: act(async () => { await postQueued(`/driver/deliveries/${d.id}/pickup`, {}, 'Produit récupéré ' + d.number); draw(); }) }, 'Produit récupéré'));
    if (live) row.append(h('button', { class: 'btn primary', onclick: () => finish(d) }, icon('check', { size: 16 }), 'Terminer la livraison'), d.dest_lat != null ? directionsLink(d.dest_lat, d.dest_lng, 'Guidage vers le client') : null);
    if (live || ['delivered', 'failed'].includes(d.status)) row.append(h('button', { class: 'btn sm', onclick: () => chatModal('/driver', d, { me: 'driver' }) }, icon('message', { size: 14 }), live ? 'Messages' : 'Historique'), live ? callBtn(d.customer_phone, 'Appeler le client') : null);
    if (d.status === 'delivered' && !d.rated) row.append(h('button', { class: 'btn sm', onclick: () => rateModal('/driver', d, 'le client') }, icon('star', { size: 14 }), 'Noter le client'));
    if (live || ['delivered', 'failed'].includes(d.status)) row.append(h('button', { class: 'btn sm', onclick: () => reportModal('/driver', d, 'le client') }, icon('alert', { size: 14 }), 'Signaler'));
    c.append(row); return c;
  };
  const finish = (d) => formModal('Terminer la course', [{ name: 'result', label: 'Résultat', type: 'select', required: true, options: [{ value: 'delivered', label: 'Livrée' }, { value: 'failed', label: 'Échec (client absent, adresse introuvable…)' }] }, { name: 'note', label: 'Note / motif', type: 'textarea' }], async (v) => { await postQueued(`/driver/deliveries/${d.id}/finish`, v, 'Fin ' + d.number); toast('Course terminée'); if (v.result === 'delivered' && me.availability !== 'offline') startGps(); draw(); });
  const photoModal = () => { const fp = filePicker({ accept: 'image/jpeg,image/png,image/webp', max: 1024 * 1024, label: 'Photo de profil (visage, JPEG/PNG, 1 Mo max)' }); formModal('Photo de profil', [], async () => { if (!fp.file) throw new Error('Choisissez une photo'); await put('/driver/me/photo', { file: await fp.payload() }); toast('Photo enregistrée'); draw(); }, { extra: fp.el }); };
  const idModal = () => { const fp = filePicker({ label: 'Scan ou photo de la pièce (JPEG, PNG ou PDF, 3 Mo max)' }); formModal('Pièce d\'identité', [{ name: 'type', label: 'Type de pièce', type: 'select', required: true, value: 'cni', options: [{ value: 'cni', label: 'Carte d\'identité' }, { value: 'passport', label: 'Passeport' }, { value: 'permis', label: 'Permis de conduire' }, { value: 'autre', label: 'Autre' }] }, { name: 'number', label: 'Numéro de la pièce' }], async (v) => { if (!fp.file) throw new Error('Choisissez un fichier'); await put('/driver/me/id-doc', { ...v, file: await fp.payload() }); toast('Pièce enregistrée (visible uniquement par l\'administration)'); draw(); }, { extra: fp.el }); };
  const profileModal = () => formModal('Mon véhicule et mes coordonnées', [{ name: 'vehicle_type', label: 'Type de véhicule', type: 'select', required: true, value: me.vehicle_type, options: ['moto', 'scooter', 'velo', 'voiture', 'camionnette', 'taxi'] }, { name: 'vehicle', label: 'Modèle', value: me.vehicle || '' }, { name: 'plate', label: 'Plaque', value: me.plate || '' }, { name: 'phone', label: 'Téléphone', type: 'phone', value: me.phone || '' }, { name: 'home_address', label: 'Adresse', value: me.home_address || '' }, { name: 'wait_min', label: 'Attente moyenne (minutes)', type: 'number', value: me.wait_min }, { name: 'speed_kmh', label: 'Vitesse moyenne (km/h)', type: 'number', value: me.speed_kmh }], async (v) => { await put('/driver/me', v); toast('Profil mis à jour'); draw(); }, { wide: true });
  onEvent('delivery', () => draw().catch(() => {}), root); onEvent('notification', () => draw().catch(() => {}), root);
  const iv = setInterval(() => { if (!root.isConnected) return clearInterval(iv); if (navigator.onLine) draw().catch(() => {}); }, 20000);
  await draw(); if (me?.availability && me.availability !== 'offline' && watch == null) startGps();
}
