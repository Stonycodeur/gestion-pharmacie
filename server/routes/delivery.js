import { moveToTrash } from './network.js';
import { releaseOrder, readyForDelivery } from './clients.js';
// Livraison à domicile : chauffeurs (nom + matricule), suivi par étapes, temps réel pour le client.
// Étapes visibles du client : émise → reçue → en cours → livrée (ou échec / annulée).
import { router, audit, notify, publish } from '../http.js';
import { get, all, run, insert, tx, nextNumber, getSetting } from '../db.js';
import { bad, conflict, notFound, str, int, oneOf, forbidden, nowSql } from '../util.js';
import { hashPassword, randomToken } from '../security.js';
import { normalizePhone, phoneFor } from '../phone.js';
import { quoteFor, setAvailability, applyAffiliations, AFF, isAffiliated, driverPharmacies, standardFee, photoUrl, notifySupers } from './drivers.js';
import { savePublicImage, savePrivate, dropPublic } from '../files.js';
import { sendWelcome } from '../emailtpl.js';
import { dlvConfig, priceFor, MODES, MODE_CODES, utc, saveConfig, acceptsMode } from '../delivery_config.js';
import { haversineKm } from './discover.js';

export const DSTATUS = { issued: 'Commande émise', received: 'Reçue par la pharmacie', in_progress: 'En cours de livraison', delivered: 'Livrée', failed: 'Échec de livraison', cancelled: 'Annulée' };
const NEXT = { issued: ['received', 'in_progress', 'cancelled'], received: ['in_progress', 'cancelled'], in_progress: ['delivered', 'failed'], failed: ['received', 'cancelled'], delivered: [], cancelled: [] };
const myCustomer = (ctx) => { const c = get('SELECT * FROM customers WHERE user_id=? LIMIT 1', ctx.user.id); if (!c) throw notFound('Fiche client'); return c; };
const customerUser = (customerId) => get('SELECT user_id FROM customers WHERE id=?', customerId)?.user_id || null;

// Relance : chauffeur retiré → immédiat ; annulée par le client → seulement après accord de la pharmacie (appel téléphonique + motif).
function canRelaunch(d) {
  const o = get('SELECT status FROM customer_orders WHERE id=?', d.order_id); if (!o || ['cancelled', 'expired', 'picked_up'].includes(o.status)) return false;
  if (d.status === 'cancelled') return d.cancelled_by === 'driver' || d.relaunch_status === 'approved';
  return ['issued', 'received'].includes(d.status) && !d.driver_id && d.cancelled_by === 'driver';
}
const view = (d, forCustomer) => {
  const drv0 = d.driver_id ? get('SELECT id,name,matricule,phone,vehicle,vehicle_type,plate,rating_sum,rating_count,photo_file FROM drivers WHERE id=?', d.driver_id) : null;
  // un client qui n'a pas choisi de chauffeur (course ouverte) ne le connaît qu'une fois le départ lancé depuis la pharmacie
  const drv = drv0 && (!forCustomer || d.offer_mode === 'driver' || ['in_progress', 'delivered', 'failed'].includes(d.status)) ? drv0 : null;
  const events = all('SELECT status,note,driver_name,driver_matricule,created_at FROM delivery_events WHERE delivery_id=? ORDER BY id', d.id);
  const o = get('SELECT number FROM customer_orders WHERE id=?', d.order_id);
  const out = { id: d.id, number: d.number, order_id: d.order_id, order_number: o?.number, status: d.status, status_label: DSTATUS[d.status], address: d.address, phone: d.phone, notes: d.notes, fee: d.fee, failure_reason: d.failure_reason, created_at: d.created_at, updated_at: d.updated_at, delivered_at: d.delivered_at,
    mode: d.mode, mode_label: MODES[d.mode]?.label, scheduled_at: d.scheduled_at, dest_lat: d.dest_lat, dest_lng: d.dest_lng, distance_m: d.distance_m, eta_min: d.eta_min, eta_max: d.eta_max, driver_response: d.driver_response, offer_mode: d.offer_mode, standard_fee: d.standard_fee, rated: !!get("SELECT 1 FROM delivery_ratings WHERE delivery_id=? AND target='driver'", d.id), picked_up_at: d.picked_up_at, cancelled_by: d.cancelled_by, cancel_reason: d.cancel_reason, relaunch_status: d.relaunch_status, standard_fee: d.standard_fee, ...(forCustomer ? { counter_offers: all("SELECT o.id,o.price,o.standard_price,o.driver_id,dr.name driver_name FROM delivery_offers o JOIN drivers dr ON dr.id=o.driver_id WHERE o.delivery_id=? AND o.kind='counter' AND o.status='pending'", d.id).map((o) => ({ ...o, ...get('SELECT currency, currency_decimals decimals FROM pharmacies WHERE id=?', d.pharmacy_id) })) } : {}), relaunch_reason: d.relaunch_reason, can_relaunch: canRelaunch(d),
    driver: drv ? { photo_url: photoUrl(drv), name: drv.name, matricule: drv.matricule, phone: drv.phone, vehicle: drv.vehicle, vehicle_type: drv.vehicle_type, plate: drv.plate, rating: drv.rating_count ? Math.round((drv.rating_sum / drv.rating_count) * 10) / 10 : null, rating_count: drv.rating_count } : null,
    events: events.map((e) => ({ ...e, label: DSTATUS[e.status] || e.status, note: e.note })) };
  if (!forCustomer) { out.customer_id = d.customer_id; out.customer_name = get('SELECT name FROM customers WHERE id=?', d.customer_id)?.name; }
  return out;
};
function addEvent(d, status, note, userId, drv) {
  insert('INSERT INTO delivery_events(delivery_id,status,note,user_id,driver_name,driver_matricule) VALUES (?,?,?,?,?,?)', d.id, status, note || null, userId, drv?.name ?? null, drv?.matricule ?? null);
}
function push(d, title) { // temps réel : le client concerné + le personnel
  const payload = { id: d.id, order_id: d.order_id, number: d.number, status: d.status };
  publish(d.pharmacy_id, 'delivery', payload, customerUser(d.customer_id)); publish(d.pharmacy_id, 'delivery', payload);
  const cu = customerUser(d.customer_id); if (cu && title) notify({ pharmacyId: d.pharmacy_id, userId: cu, kind: 'delivery', title, body: `Livraison ${d.number}`, link: `#/portal?tab=deliveries&id=${d.id}` });
}
function create(ctx, order, b, userId) {
  if (['cancelled', 'expired', 'picked_up'].includes(order.status)) throw conflict('BAD_STATE', 'Cette commande ne peut plus être livrée');
  if (get('SELECT 1 FROM deliveries WHERE order_id=?', order.id)) throw conflict('DUPLICATE', 'Une livraison existe déjà pour cette commande');
  if (!['preparing', 'ready'].includes(order.status)) throw conflict('BAD_STATE', 'Une livraison ne peut être demandée que lorsque la commande est au minimum « En préparation »');
  const mode = oneOf(b.mode || 'standard', 'mode de livraison', MODE_CODES), cfg = dlvConfig(order.pharmacy_id); let scheduledAt = null;
  if (mode === 'scheduled') { const dt = new Date(b.scheduled_at); if (!b.scheduled_at || Number.isNaN(dt.getTime())) throw bad('VALIDATION', 'Choisissez la date et l\'heure de la livraison programmée'); if (dt.getTime() < Date.now() + 20 * 60000) throw bad('VALIDATION', 'La livraison programmée doit être prévue dans au moins 20 minutes'); if (dt.getTime() > Date.now() + 60 * 86400000) throw bad('VALIDATION', 'La livraison programmée ne peut pas dépasser 60 jours'); scheduledAt = utc(dt); }
  if (!b.driver_id && mode !== 'scheduled' && !all("SELECT d.* FROM drivers d WHERE " + AFF + " AND d.status='active' AND d.availability='available'", order.pharmacy_id, order.pharmacy_id).some((d) => acceptsMode(d, mode))) throw conflict('NO_DRIVER', all("SELECT 1 FROM drivers d WHERE " + AFF + " AND d.status='active' AND d.availability='available'", order.pharmacy_id, order.pharmacy_id).length ? `Aucun chauffeur disponible n'a choisi le mode « ${MODES[mode].short} » : choisissez un autre mode` : 'Aucun chauffeur n\'est disponible actuellement dans le secteur');
  const address = str(b.address ?? order.delivery_address, 'adresse', { required: true, min: 5, max: 300 }), phone = phoneFor({ ph: order.pharmacy_id, user: {} }, b.phone, 'téléphone'), notes = str(b.notes, 'instructions', { max: 300 });
  const lat = b.lat === undefined || b.lat === null || b.lat === '' ? null : Number(b.lat), lng = b.lng === undefined || b.lng === null || b.lng === '' ? null : Number(b.lng);
  if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lng !== null && !(lng >= -180 && lng <= 180)) || (lat === null) !== (lng === null)) throw bad('VALIDATION', 'Coordonnées de livraison invalides');
  let driverId = null, q = null, offerMode = 'driver', standard = null; const phRow = get('SELECT lat,lng FROM pharmacies WHERE id=?', order.pharmacy_id);
  const km = lat !== null && phRow?.lat != null ? haversineKm(phRow.lat, phRow.lng, lat, lng) * 1.3 : null;
  if (km !== null && cfg.max_km > 0 && km > cfg.max_km) throw bad('TOO_FAR', `Adresse trop éloignée : la distance maximale de livraison est de ${cfg.max_km} km`);
  let fee = priceFor(cfg, mode, km);
  if (b.driver_id) {
    const dr = get("SELECT d.* FROM drivers d WHERE d.id=? AND " + AFF + " AND d.status='active' AND d.availability='available'", int(b.driver_id, 'chauffeur'), order.pharmacy_id, order.pharmacy_id); if (dr && !acceptsMode(dr, mode)) throw conflict('DRIVER_MODE', `Ce chauffeur n'a pas choisi le mode « ${MODES[mode].short} »`); if (!dr) throw conflict('DRIVER_UNAVAILABLE', 'Ce chauffeur n\'est plus disponible');
    q = quoteFor(dr, phRow, lat, lng); driverId = dr.id; standard = fee;
  } else { // course ouverte : proposée à tous les chauffeurs disponibles de la pharmacie, premier arrivé premier servi (ou choix du client parmi les offres)
    offerMode = 'open'; standard = fee; q = { distance_m: km === null ? null : Math.round(km * 1000), eta_min: null, eta_max: null };
  }
  const number = nextNumber(order.pharmacy_id, 'delivery', 'LIV');
  const id = insert('INSERT INTO deliveries(pharmacy_id,order_id,customer_id,number,address,phone,notes,fee,dest_lat,dest_lng,driver_id,driver_response,distance_m,eta_min,eta_max,offer_mode,standard_fee,mode,scheduled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', order.pharmacy_id, order.id, order.customer_id, number, address, phone, notes, fee, lat, lng, driverId, driverId ? 'pending' : 'none', q?.distance_m ?? null, cfg.eta[mode][0] || null, cfg.eta[mode][1] || null, offerMode, standard, mode, scheduledAt);
  run('UPDATE customer_orders SET wants_delivery=1 WHERE id=?', order.id); // le client a demandé la livraison : la question « Souhaitez-vous être livré ? » ne se repose plus
  let d = get('SELECT * FROM deliveries WHERE id=?', id); addEvent(d, 'issued', null, userId);
  if (order.status === 'ready') { readyForDelivery(d, userId); d = get('SELECT * FROM deliveries WHERE id=?', id); } // commande déjà prête : le chauffeur part directement
  if (driverId) { const du = get('SELECT user_id FROM drivers WHERE id=?', driverId)?.user_id; if (du) notify({ pharmacyId: order.pharmacy_id, userId: du, kind: 'delivery', title: `Nouvelle course ${number}`, body: address, link: '#/driver' }); }
  else for (const dr of all("SELECT d.user_id, d.accepted_modes FROM drivers d WHERE " + AFF + " AND d.status='active' AND d.availability='available' AND d.user_id IS NOT NULL", order.pharmacy_id, order.pharmacy_id).filter((q) => acceptsMode(q, mode))) notify({ pharmacyId: order.pharmacy_id, userId: dr.user_id, kind: 'delivery', title: `Nouvelle course proposée ${number}`, body: address, link: '#/driver' });
  return d;
}

// ----- client -----
router.post('/portal/orders/:id/delivery', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => tx(() => {
  const c = myCustomer(ctx); const o = get('SELECT * FROM customer_orders WHERE id=? AND customer_id IN (SELECT id FROM customers WHERE user_id=?)', ctx.params.id, ctx.user.id); if (!o) throw notFound('Commande');
  const d = create(ctx, o, ctx.body, ctx.user.id); audit(ctx, 'delivery.request', 'delivery', d.id);
  notify({ pharmacyId: o.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Demande de livraison ${d.number} (${o.number})`, link: `#/deliveries?id=${d.id}` }); push(d, `Livraison ${d.number} enregistrée`); return view(d, true);
}));
router.get('/portal/deliveries', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => { const c = myCustomer(ctx); return all(`SELECT * FROM deliveries WHERE customer_id IN (SELECT id FROM customers WHERE user_id=?) ${ctx.user.role === 'guest' ? "AND status IN ('issued','received','in_progress')" : ''} ORDER BY id DESC LIMIT 50`, ctx.user.id).map((d) => view(d, true)); });
router.get('/portal/deliveries/:id', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => { const c = myCustomer(ctx); const d = get('SELECT * FROM deliveries WHERE id=? AND customer_id IN (SELECT id FROM customers WHERE user_id=?)', ctx.params.id, ctx.user.id); if (!d) throw notFound('Livraison'); return view(d, true); });
router.post('/portal/deliveries/:id/cancel', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const c = myCustomer(ctx); const d = get('SELECT * FROM deliveries WHERE id=? AND customer_id IN (SELECT id FROM customers WHERE user_id=?)', ctx.params.id, ctx.user.id); if (!d) throw notFound('Livraison');
  if (!['issued', 'received'].includes(d.status)) throw conflict('BAD_STATE', 'Trop tard pour annuler : la livraison est déjà en cours');
  run("UPDATE deliveries SET status='cancelled', cancelled_by='customer', cancel_reason=?, updated_at=datetime('now') WHERE id=?", str(ctx.body.reason, 'motif', { max: 200 }), d.id); addEvent(d, 'cancelled', 'Annulée par le client' + (ctx.body.reason ? ' : ' + ctx.body.reason : ''), ctx.user.id); audit(ctx, 'delivery.cancel', 'delivery', d.id);
  push({ ...d, status: 'cancelled' }); notify({ pharmacyId: d.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Livraison ${d.number} annulée par le client`, link: `#/deliveries?id=${d.id}` }); return { ok: true };
}));

router.post('/portal/deliveries/:id/relaunch', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  myCustomer(ctx); const d = get('SELECT * FROM deliveries WHERE id=? AND customer_id IN (SELECT id FROM customers WHERE user_id=?)', ctx.params.id, ctx.user.id); if (!d) throw notFound('Livraison');
  const o = get('SELECT * FROM customer_orders WHERE id=?', d.order_id); if (!o || ['cancelled', 'expired', 'picked_up'].includes(o.status)) throw conflict('BAD_STATE', 'Cette commande ne peut plus être livrée');
  const reopen = (note) => { run("UPDATE deliveries SET status='issued', driver_id=NULL, driver_response='none', offer_mode='open', cancelled_by=NULL, relaunch_status=CASE WHEN relaunch_status IS NULL THEN NULL ELSE 'used' END, picked_up_at=NULL, updated_at=datetime('now') WHERE id=?", d.id); run("DELETE FROM delivery_offers WHERE delivery_id=? AND status IN ('pending','chosen','rejected')", d.id); const n = get('SELECT * FROM deliveries WHERE id=?', d.id); addEvent(n, 'issued', note, ctx.user.id); audit(ctx, 'delivery.relaunch', 'delivery', d.id); notify({ pharmacyId: d.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Livraison ${d.number} relancée`, body: note, link: `#/deliveries?id=${d.id}` }); push(n, `Livraison ${d.number} relancée`); return { ok: true, relaunched: true }; };
  if (d.status === 'cancelled' && d.cancelled_by === 'driver') return reopen('Relancée par le client (annulation du chauffeur)');
  if (d.status !== 'cancelled') { if (d.cancelled_by === 'driver' && !d.driver_id && ['issued', 'received'].includes(d.status)) return reopen('Relancée par le client après le retrait du chauffeur'); throw conflict('BAD_STATE', 'Cette livraison est toujours active'); }
  if (d.relaunch_status === 'approved') return reopen('Relancée par le client avec l\'accord de la pharmacie');
  if (d.relaunch_status === 'requested') throw conflict('PENDING', 'Votre demande est en attente de validation par la pharmacie : appelez-la pour confirmer');
  const reason = str(ctx.body.reason, 'motif', { required: true, min: 5, max: 300 });
  run("UPDATE deliveries SET relaunch_status='requested', relaunch_reason=?, relaunch_requested_at=datetime('now') WHERE id=?", reason, d.id); addEvent(d, 'cancelled', 'Demande de relance : ' + reason, ctx.user.id); audit(ctx, 'delivery.relaunch_request', 'delivery', d.id);
  notify({ pharmacyId: d.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Demande de relance — ${d.number}`, body: `Le client doit vous appeler pour confirmer. Motif : ${reason}`, link: `#/deliveries?id=${d.id}` }); publish(d.pharmacy_id, 'delivery', { id: d.id, status: d.status }); return { ok: true, requested: true };
}));
router.post('/deliveries/:id/relaunch/:decision', { perm: 'deliveries.manage', ok200: true }, (ctx) => tx(() => {
  const d = get('SELECT * FROM deliveries WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!d) throw notFound('Livraison'); const ok = ctx.params.decision === 'approve';
  if (!['approve', 'reject'].includes(ctx.params.decision)) throw notFound('Action'); if (d.status !== 'cancelled' || d.relaunch_status !== 'requested') throw conflict('BAD_STATE', 'Aucune demande de relance en attente');
  run('UPDATE deliveries SET relaunch_status=? WHERE id=?', ok ? 'approved' : 'rejected', d.id); addEvent(d, 'cancelled', ok ? 'Relance autorisée par la pharmacie' : 'Relance refusée par la pharmacie', ctx.user.id); audit(ctx, 'delivery.relaunch_' + ctx.params.decision, 'delivery', d.id);
  const cu = customerUser(d.customer_id); if (cu) notify({ pharmacyId: d.pharmacy_id, userId: cu, kind: 'delivery', title: ok ? `Livraison ${d.number} : vous pouvez relancer la demande` : `Livraison ${d.number} : relance refusée`, body: ok ? 'La pharmacie a validé : appuyez sur « Relancer la demande de livraison ».' : 'Contactez la pharmacie.', link: `#/portal?tab=deliveries&id=${d.id}` });
  publish(d.pharmacy_id, 'delivery', { id: d.id, status: d.status }, cu); return { ok: true };
}));
router.post('/portal/orders/:id/cancel', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  myCustomer(ctx); const o = get('SELECT * FROM customer_orders WHERE id=? AND customer_id IN (SELECT id FROM customers WHERE user_id=?)', ctx.params.id, ctx.user.id); if (!o) throw notFound('Commande');
  if (!['pending', 'confirmed', 'preparing', 'ready'].includes(o.status)) throw conflict('BAD_STATE', 'Cette commande ne peut plus être annulée');
  const d = get('SELECT * FROM deliveries WHERE order_id=?', o.id); if (d && ['in_progress', 'delivered', 'failed'].includes(d.status)) throw conflict('BAD_STATE', 'Trop tard : la livraison est déjà en cours');
  const reason = str(ctx.body.reason, 'motif', { max: 200 });
  releaseOrder(o.id); run("UPDATE customer_orders SET status='cancelled', updated_at=datetime('now') WHERE id=?", o.id); insert('INSERT INTO order_status_history(order_id,from_status,to_status,user_id) VALUES (?,?,?,?)', o.id, o.status, 'cancelled', ctx.user.id);
  if (d && ['issued', 'received'].includes(d.status)) { run("UPDATE deliveries SET status='cancelled', cancelled_by='customer', cancel_reason=?, updated_at=datetime('now') WHERE id=?", reason || 'Commande annulée', d.id); addEvent(d, 'cancelled', 'Commande annulée par le client', ctx.user.id); push({ ...d, status: 'cancelled' }); }
  audit({ ...ctx, ph: o.pharmacy_id }, 'order.cancel_customer', 'order', o.id, { status: o.status }, { status: 'cancelled' });
  notify({ pharmacyId: o.pharmacy_id, audience: 'staff', kind: 'order', title: `Commande ${o.number} annulée par le client`, body: reason || '', link: `#/orders?id=${o.id}` }); publish(o.pharmacy_id, 'order', { id: o.id }, null); return { ok: true };
}));

// ----- personnel -----
router.get('/deliveries', { perm: 'deliveries.view' }, (ctx) => {
  const st = ctx.query.status, every = ctx.user.role === 'super_admin' && ctx.query.all === '1'; const rows = all(`SELECT * FROM deliveries WHERE ${every ? '1=1' : 'pharmacy_id=?'} ${st ? 'AND status=?' : ''} ORDER BY CASE status WHEN 'issued' THEN 0 WHEN 'received' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END, id DESC LIMIT 500`, ...(every ? [] : [ctx.ph]), ...(st ? [st] : []));
  return { statuses: DSTATUS, data: rows.map((d) => ({ ...view(d, false), pharmacy_name: every ? get('SELECT name FROM pharmacies WHERE id=?', d.pharmacy_id)?.name : undefined })) };
});
router.get('/deliveries/:id', { perm: 'deliveries.view' }, (ctx) => { const d = ctx.user.role === 'super_admin' ? get('SELECT * FROM deliveries WHERE id=?', ctx.params.id) : get('SELECT * FROM deliveries WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!d) throw notFound('Livraison'); return view(d, false); });
router.post('/orders/:id/delivery', { perm: 'deliveries.manage' }, (ctx) => tx(() => {
  const o = get('SELECT * FROM customer_orders WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!o) throw notFound('Commande');
  const d = create(ctx, o, ctx.body, ctx.user.id); audit(ctx, 'delivery.create', 'delivery', d.id); push(d, `Livraison ${d.number} enregistrée`); return view(d, false);
}));
router.post('/deliveries/:id/status', { perm: 'deliveries.manage', ok200: true }, (ctx) => tx(() => {
  const d = get('SELECT * FROM deliveries WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!d) throw notFound('Livraison');
  const to = oneOf(ctx.body.status, 'statut', Object.keys(DSTATUS), { required: true }); if (!NEXT[d.status].includes(to)) throw conflict('BAD_TRANSITION', `Passage impossible : ${DSTATUS[d.status]} → ${DSTATUS[to]}`);
  if (d.status === 'issued' && to === 'in_progress' && d.driver_response !== 'accepted') throw conflict('BAD_TRANSITION', 'Passage impossible : le chauffeur doit d\'abord accepter la course');
  let driverId = d.driver_id;
  if (ctx.body.driver_id !== undefined && ctx.body.driver_id !== null && ctx.body.driver_id !== '') { const dr = get("SELECT d.id FROM drivers d WHERE d.id=? AND " + AFF + " AND d.status='active'", int(ctx.body.driver_id, 'chauffeur'), ctx.ph, ctx.ph); if (!dr) throw bad('VALIDATION', 'Chauffeur introuvable ou inactif'); driverId = dr.id; }
  if (to === 'in_progress' && !driverId) throw bad('DRIVER_REQUIRED', 'Affectez un chauffeur avant de lancer la livraison');
  if (to === 'in_progress' && get('SELECT 1 FROM drivers WHERE id=? AND user_id IS NOT NULL', driverId) && d.driver_response !== 'accepted' && !(ctx.body.driver_id && Number(ctx.body.driver_id) !== d.driver_id)) throw conflict('DRIVER_NOT_ACCEPTED', 'Le chauffeur n\'a pas encore accepté la course');
  if (to === 'in_progress') { const miss = []; if (!d.address) miss.push('adresse de livraison'); if (!d.phone) miss.push('téléphone du client'); if (!(d.dest_lat != null || d.address)) miss.push('destination'); if (miss.length) throw bad('INCOMPLETE', 'Informations manquantes pour lancer : ' + miss.join(', ')); }
  const note = str(ctx.body.note, 'note', { max: 300 }); if (to === 'failed' && !note) throw bad('VALIDATION', 'Indiquez le motif de l\'échec');
  run(`UPDATE deliveries SET status=?, driver_id=?, failure_reason=?, updated_at=datetime('now'), delivered_at=${to === 'delivered' ? "datetime('now')" : 'delivered_at'} WHERE id=?`, to, driverId, to === 'failed' ? note : null, d.id);
  if (driverId && driverId !== d.driver_id) run("UPDATE deliveries SET driver_response='none' WHERE id=?", d.id);
  if (driverId && to === 'in_progress') setAvailability(driverId, 'busy'); else if (driverId && ['delivered', 'failed', 'cancelled'].includes(to)) setAvailability(driverId, 'available', true);
  const drv = driverId ? get('SELECT name,matricule FROM drivers WHERE id=?', driverId) : null; const nd = { ...d, status: to, driver_id: driverId };
  addEvent(nd, to, note, ctx.user.id, ['in_progress', 'delivered', 'failed'].includes(to) ? drv : null); audit(ctx, 'delivery.status', 'delivery', d.id, { status: d.status }, { status: to, driver: drv?.matricule });
  const title = { received: `Commande reçue — livraison ${d.number}`, in_progress: `Votre livraison ${d.number} est en route${drv ? ` (chauffeur ${drv.name}, matricule ${drv.matricule})` : ''}`, delivered: `Livraison ${d.number} effectuée`, failed: `Livraison ${d.number} : échec`, cancelled: `Livraison ${d.number} annulée` }[to];
  push(nd, title); return view(get('SELECT * FROM deliveries WHERE id=?', d.id), false);
}));
router.post('/deliveries/:id/assign', { perm: 'deliveries.manage', ok200: true }, (ctx) => tx(() => {
  const d = get('SELECT * FROM deliveries WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!d) throw notFound('Livraison'); if (['delivered', 'cancelled'].includes(d.status)) throw conflict('BAD_STATE', 'Livraison terminée');
  const dr = get("SELECT d.* FROM drivers d WHERE d.id=? AND " + AFF + " AND d.status='active'", int(ctx.body.driver_id, 'chauffeur', { required: true }), ctx.ph, ctx.ph); if (!dr) throw bad('VALIDATION', 'Chauffeur introuvable ou inactif');
  run("UPDATE deliveries SET driver_id=?, updated_at=datetime('now') WHERE id=?", dr.id, d.id); audit(ctx, 'delivery.assign', 'delivery', d.id, { driver_id: d.driver_id }, { driver_id: dr.id }); push({ ...d, driver_id: dr.id }); return view(get('SELECT * FROM deliveries WHERE id=?', d.id), false);
}));

// ----- chauffeurs -----
const money = (v, n) => { const x = Number(v ?? 0); if (!Number.isInteger(x) || x < 0 || x > 1e9) throw bad('VALIDATION', n + ' invalide'); return x; };
const geo = (v, lo, hi) => { if (v === undefined || v === null || v === '') return null; const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw bad('VALIDATION', 'Coordonnées invalides'); return x; };
const drvInput = (b, ctx) => ({ name: str(b.name, 'nom', { required: true, min: 2, max: 80 }), matricule: str(b.matricule, 'matricule', { required: true, min: 2, max: 30 }), phone: ctx ? phoneFor(ctx, b.phone, 'téléphone') : b.phone, vehicle: str(b.vehicle, 'véhicule', { max: 60 }),
  vehicle_type: oneOf(b.vehicle_type || 'moto', 'type de véhicule', ['moto', 'scooter', 'velo', 'voiture', 'camionnette', 'taxi']), plate: str(b.plate, 'plaque', { max: 20 }), base_fee: money(b.base_fee, 'frais de base'), per_km: money(b.per_km, 'prix au km'),
  speed_kmh: Math.min(120, Math.max(5, Number(b.speed_kmh) || 25)), wait_min: Math.min(480, Math.max(0, Number(b.wait_min ?? 15) || 0)), lat: geo(b.lat, -90, 90), lng: geo(b.lng, -180, 180) });
router.get('/drivers', { perm: 'deliveries.view' }, (ctx) => all("SELECT d.*, (SELECT COUNT(*) FROM deliveries x WHERE x.driver_id=d.id AND x.status='in_progress') active_deliveries FROM drivers d WHERE " + AFF + " AND d.id NOT IN (SELECT entity_id FROM trash WHERE entity='driver') ORDER BY d.status, d.name", ctx.ph, ctx.ph).map(({ id_doc_file, photo_file, user_id, ...d }) => ({ ...d, photo_url: photoUrl({ photo_file }), has_id_doc: !!id_doc_file, has_account: !!user_id, pharmacies: driverPharmacies({ ...d, id: d.id }) })));
router.post('/drivers', { perm: 'drivers.admin' }, (ctx) => {
  const v = drvInput(ctx.body, ctx); if (get('SELECT 1 FROM drivers WHERE pharmacy_id=? AND matricule=?', ctx.ph, v.matricule)) throw conflict('DUPLICATE', 'Ce matricule existe déjà');
  return tx(() => {
    let uid = null, pw;
    const acc = ctx.body.account;
    if (acc && acc.email) {
      if (get('SELECT 1 FROM users WHERE email=?', String(acc.email).toLowerCase())) throw conflict('DUPLICATE', 'Un compte existe déjà avec cet e-mail');
      pw = acc.password || randomToken(9) + 'aA1';
      uid = insert("INSERT INTO users(email,password_hash,name,role_code,pharmacy_id,phone,must_change_password) VALUES (?,?,?,'driver',?,?,1)", String(acc.email).toLowerCase(), hashPassword(pw), v.name, ctx.ph, v.phone);
      sendWelcome({ email: String(acc.email).toLowerCase(), name: v.name, role_label: 'Chauffeur', pharmacyId: ctx.ph, password: acc.password ? null : pw });
    } else if (ctx.body.user_id) { const u = get("SELECT id FROM users WHERE id=? AND role_code='driver' AND pharmacy_id=?", Number(ctx.body.user_id), ctx.ph); if (!u) throw bad('VALIDATION', 'Compte chauffeur introuvable'); uid = u.id; }
    const id = insert('INSERT INTO drivers(pharmacy_id,name,matricule,phone,vehicle,vehicle_type,plate,base_fee,per_km,speed_kmh,wait_min,lat,lng,loc_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ctx.ph, v.name, v.matricule, v.phone, v.vehicle, v.vehicle_type, v.plate, v.base_fee, v.per_km, v.speed_kmh, v.wait_min, v.lat, v.lng, v.lat === null ? null : nowSql(), uid);
    applyAffiliations(ctx, id, ctx.body.pharmacies?.length ? ctx.body.pharmacies : [{ pharmacy_id: ctx.ph, depart_lat: ctx.body.depart_lat, depart_lng: ctx.body.depart_lng, depart_label: ctx.body.depart_label }]);
    audit(ctx, 'driver.create', 'driver', id, undefined, v); return { id, user_id: uid, temporary_password: acc?.password ? undefined : pw };
  });
});
router.put('/drivers/:id', { perm: 'drivers.admin', ok200: true }, (ctx) => {
  const d = ctx.user.role === 'super_admin' ? get('SELECT * FROM drivers WHERE id=?', ctx.params.id) : get('SELECT d.* FROM drivers d WHERE d.id=? AND ' + AFF, ctx.params.id, ctx.ph, ctx.ph); if (!d) throw notFound('Chauffeur');
  const v = drvInput({ ...d, ...ctx.body }, ctx.body.phone !== undefined ? ctx : null); const status = ctx.body.status === undefined ? d.status : oneOf(ctx.body.status, 'statut', ['active', 'inactive']);
  if (v.matricule !== d.matricule && get('SELECT 1 FROM drivers WHERE pharmacy_id=? AND matricule=?', ctx.ph, v.matricule)) throw conflict('DUPLICATE', 'Ce matricule existe déjà');
  if (status === 'inactive' && get("SELECT 1 FROM deliveries WHERE driver_id=? AND status='in_progress'", d.id)) throw conflict('IN_USE', 'Ce chauffeur a une livraison en cours');
  run("UPDATE drivers SET name=?, matricule=?, phone=?, vehicle=?, vehicle_type=?, plate=?, base_fee=?, per_km=?, speed_kmh=?, wait_min=?, lat=?, lng=?, loc_at=?, status=? WHERE id=?", v.name, v.matricule, v.phone, v.vehicle, v.vehicle_type, v.plate, v.base_fee, v.per_km, v.speed_kmh, v.wait_min, v.lat, v.lng, v.lat !== null && (v.lat !== d.lat || v.lng !== d.lng) ? nowSql() : d.loc_at, status, d.id); audit(ctx, 'driver.update', 'driver', d.id, d, { ...v, status }); return { ok: true };
});
router.delete('/drivers/:id', { perm: 'drivers.admin', ok200: true }, (ctx) => {
  const d = ctx.user.role === 'super_admin' ? get('SELECT * FROM drivers WHERE id=?', ctx.params.id) : get('SELECT d.* FROM drivers d WHERE d.id=? AND ' + AFF, ctx.params.id, ctx.ph, ctx.ph); if (!d) throw notFound('Chauffeur');
  
  return moveToTrash(ctx, 'driver', d);
});
