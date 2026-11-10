// Espace chauffeur : disponibilité, tarifs, GPS en direct, courses (accepter / refuser / terminer), messagerie, notes et signalements.
import { get, post, put, state } from '../api.js';
import { h, clear, fail, toast, badge, icon, money, formModal, modal, when, toMinor, fromMinor } from '../ui.js';
import { mapView, fmtM, stars, locate } from '../net.js';
import { onEvent } from '../events.js';

const AV = { offline: ['Hors ligne', ''], available: ['Disponible', 'ok'], busy: ['En course', 'warn'] };
const ST = { issued: 'Émise', received: 'Reçue', in_progress: 'En cours', delivered: 'Livrée', failed: 'Échec', cancelled: 'Annulée' };
let watch = null, lastSent = 0;

function stopGps() { if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; } }
function startGps(onFix) {
  if (!navigator.geolocation) return toast('GPS indisponible sur cet appareil', true); stopGps();
  watch = navigator.geolocation.watchPosition(async (p) => { const now = Date.now(); onFix?.(p.coords); if (now - lastSent < 5000) return; lastSent = now; try { await post('/driver/location', { lat: p.coords.latitude, lng: p.coords.longitude }); } catch {} },
    (e) => toast(e.code === 1 ? 'Autorisez la localisation pour être suivi par le client' : 'Position introuvable', true), { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
}

export default async function (box) {
  const root = h('div'); box.append(h('h1', {}, 'Espace chauffeur'), root); let me, pos = null;
  const draw = async () => {
    me = await get('/driver/me'); const dl = await get('/driver/deliveries'); clear(root);
    const [avl, avk] = AV[me.availability];
    const gpsOn = watch != null;
    root.append(h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, me.name), badge(avl, avk)), h('div', { class: 'muted' }, `${me.vehicle_type} · ${me.plate || me.matricule} · ${me.pharmacy?.name || ''}`), h('div', {}, stars(me.rating), me.rating_count ? h('small', { class: 'muted' }, ` (${me.rating_count} avis)`) : null),
        h('div', { class: 'seg', style: { margin: '12px 0' } }, ...['offline', 'available'].map((v) => h('button', { class: 'btn' + (me.availability === v ? ' primary' : ''), disabled: me.availability === 'busy', onclick: async () => { try { await put('/driver/me', { availability: v }); if (v === 'available' && !gpsOn) startGps(); if (v === 'offline') stopGps(); draw(); } catch (e) { fail(e); } } }, v === 'offline' ? 'Hors ligne' : 'Je suis disponible'))),
        h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: gpsOn, style: { width: 'auto' }, onchange: (e) => { e.target.checked ? startGps((c) => (pos = c)) : stopGps(); } }), 'Partager ma position en temps réel'),
        h('p', { class: 'muted' }, 'Gardez cette page ouverte pendant vos courses : la position est envoyée toutes les 5 secondes et suivie par le client dès que la pharmacie lance la livraison.')),
      h('div', { class: 'card' }, h('h2', {}, 'Mes tarifs'), h('p', { class: 'muted' }, 'Affichés au client avant qu\'il vous choisisse (avec la distance et le délai estimé).'),
        h('div', {}, `Frais de base : `, h('strong', {}, money(me.base_fee))), h('div', {}, 'Par kilomètre : ', h('strong', {}, money(me.per_km))), h('div', {}, 'Attente moyenne : ', h('strong', {}, `${me.wait_min} min`), ` · vitesse moyenne ${me.speed_kmh} km/h`),
        h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: () => formModal('Mes tarifs et véhicule', [{ name: 'base_fee', label: 'Frais de base', type: 'money', value: me.base_fee }, { name: 'per_km', label: 'Prix par kilomètre', type: 'money', value: me.per_km }, { name: 'wait_min', label: 'Temps d\'attente moyen (minutes)', type: 'number', value: me.wait_min }, { name: 'speed_kmh', label: 'Vitesse moyenne (km/h)', type: 'number', value: me.speed_kmh }, { name: 'vehicle_type', label: 'Véhicule', type: 'select', required: true, value: me.vehicle_type, options: ['moto', 'scooter', 'velo', 'voiture', 'camionnette', 'taxi'] }, { name: 'plate', label: 'Plaque', value: me.plate }], async (v) => { await put('/driver/me', { ...v, wait_min: Number(v.wait_min), speed_kmh: Number(v.speed_kmh) }); draw(); }) }, icon('edit', { size: 14 }), 'Modifier'))));
    root.append(h('h2', { style: { marginTop: '16px' } }, 'Mes courses'), ...(dl.data.length ? dl.data.map((d) => course(d, dl.pharmacy, draw)) : [h('div', { class: 'empty' }, 'Aucune course pour le moment')]));
  };
  const course = (d, ph, redraw) => {
    const live = d.status === 'in_progress', offered = ['issued', 'received'].includes(d.status) && d.driver_response === 'pending';
    const c = h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'row between' }, h('strong', {}, `${d.number}`), badge(offered ? 'À accepter' : ST[d.status], offered ? 'warn' : d.status === 'delivered' ? 'ok' : d.status === 'in_progress' ? 'info' : '')),
      h('div', {}, icon('pin', { size: 14 }), ' ', d.address), h('div', { class: 'muted' }, [d.distance_m != null ? fmtM(d.distance_m) : null, d.eta_min ? `${d.eta_min}–${d.eta_max} min` : null, `Prix : ${money(d.fee)}`].filter(Boolean).join(' · ')), d.notes ? h('div', { class: 'muted' }, d.notes) : null, d.customer_phone ? h('div', {}, h('a', { href: 'tel:' + d.customer_phone }, d.customer_phone)) : null);
    if (d.dest_lat != null) c.append(mapView({ height: 220, points: [{ ...ph, kind: 'pharmacy', label: 'Pharmacie' }, { lat: d.dest_lat, lng: d.dest_lng, kind: 'dest', label: 'Client' }, ...(pos && live ? [{ lat: pos.latitude, lng: pos.longitude, kind: 'driver', label: 'Moi' }] : [])] }));
    const act = h('div', { class: 'row', style: { marginTop: '10px' } });
    if (offered) act.append(h('button', { class: 'btn primary', onclick: async () => { try { await post(`/driver/deliveries/${d.id}/respond`, { accept: true }); if (watch == null) startGps((x) => (pos = x)); redraw(); } catch (e) { fail(e); } } }, icon('check', { size: 16 }), 'Accepter'), h('button', { class: 'btn danger', onclick: async () => { try { await post(`/driver/deliveries/${d.id}/respond`, { accept: false }); redraw(); } catch (e) { fail(e); } } }, 'Refuser'));
    if (['issued', 'received'].includes(d.status) && d.driver_response === 'accepted') act.append(h('span', { class: 'muted' }, 'Acceptée — en attente du départ de la pharmacie'), h('button', { class: 'btn sm danger', onclick: () => formModal('Annuler la course', [{ name: 'reason', label: 'Motif', required: true }], async (v) => { await post(`/driver/deliveries/${d.id}/cancel`, v); redraw(); }) }, 'Me retirer'));
    if (live) act.append(h('button', { class: 'btn primary', onclick: () => finish(d, redraw) }, icon('check', { size: 16 }), 'Terminer la livraison'));
    act.append(h('button', { class: 'btn sm', onclick: () => chat(d) }, icon('message', { size: 14 }), 'Messages'));
    if (d.status === 'delivered') act.append(h('button', { class: 'btn sm', onclick: () => rate(d) }, icon('star', { size: 14 }), 'Noter le client'));
    act.append(h('button', { class: 'btn sm', onclick: () => formModal('Signaler le client', [{ name: 'reason', label: 'Motif', required: true }, { name: 'details', label: 'Détails', type: 'textarea' }], async (v) => { await post(`/driver/deliveries/${d.id}/report`, v); toast('Signalement transmis à la pharmacie'); }) }, icon('alert', { size: 14 }), 'Signaler'));
    c.append(act); return c;
  };
  const finish = (d, redraw) => formModal('Terminer la course', [{ name: 'result', label: 'Résultat', type: 'select', required: true, options: [{ value: 'delivered', label: 'Livrée' }, { value: 'failed', label: 'Échec (client absent, adresse introuvable…)' }] }, { name: 'note', label: 'Note / motif', type: 'textarea' }], async (v) => { await post(`/driver/deliveries/${d.id}/finish`, v); toast('Course terminée'); redraw(); });
  const rate = (d) => formModal('Noter le client', [{ name: 'stars', label: 'Note (1 à 5)', type: 'number', min: 1, max: 5, required: true, value: 5 }, { name: 'comment', label: 'Commentaire' }], async (v) => { await post(`/driver/deliveries/${d.id}/rate`, { stars: Number(v.stars), comment: v.comment }); toast('Merci'); });
  const chat = async (d) => {
    const th = h('div', { class: 'thread' }), inp = h('input', { placeholder: 'Votre message…', maxLength: 500, style: { flex: 1 } });
    const load = async () => { const r = await get(`/driver/deliveries/${d.id}/messages`); clear(th).append(...r.map((x) => h('div', { class: 'msg' + (x.sender_role === 'driver' ? ' me' : '') }, x.body, h('small', { class: 'muted', style: { display: 'block' } }, `${x.sender_name} · ${when(x.created_at)}`)))); th.scrollTop = th.scrollHeight; };
    modal(`Messages — ${d.number}`, h('div', {}, th, h('form', { class: 'row', onsubmit: async (e) => { e.preventDefault(); if (!inp.value.trim()) return; try { await post(`/driver/deliveries/${d.id}/messages`, { body: inp.value }); inp.value = ''; load(); } catch (er) { fail(er); } } }, inp, h('button', { class: 'btn primary' }, icon('arrow', { size: 16 }))))); await load(); onEvent('delivery_message', load, th);
  };
  onEvent('delivery', () => draw().catch(() => {}), root); onEvent('notification', () => draw().catch(() => {}), root);
  await draw(); if (me.availability !== 'offline' && watch == null) startGps((x) => (pos = x));
}
