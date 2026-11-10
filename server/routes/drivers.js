// Espace chauffeur : disponibilité, tarifs, position GPS en temps réel, devis de livraison, acceptation de course,
// suivi du trajet par le client, messagerie, notes, signalements, annulations.
import { router, audit, notify, publish, can } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { bad, conflict, notFound, forbidden, str, int, oneOf, nowSql } from '../util.js';
import { haversineKm } from './discover.js';
import { phoneFor } from '../phone.js';

const ROAD = 1.3; // facteur routier appliqué à la distance à vol d'oiseau
const OWNC = '(SELECT id FROM customers WHERE user_id=?)';
const isStaff = (ctx) => !['customer', 'guest', 'driver'].includes(ctx.user.role);

export function quoteFor(dr, ph, lat, lng) {
  if (lat == null || lng == null || ph?.lat == null || ph?.lng == null) return null;
  const km = haversineKm(ph.lat, ph.lng, lat, lng) * ROAD;
  const pickup = dr.lat != null && dr.lng != null ? (haversineKm(dr.lat, dr.lng, ph.lat, ph.lng) * ROAD / dr.speed_kmh) * 60 : 0;
  const base = pickup + (km / dr.speed_kmh) * 60;
  return { distance_m: Math.round(km * 1000), fee: Math.round(dr.base_fee + dr.per_km * km), eta_min: Math.max(1, Math.round(base * 0.85 + dr.wait_min * 0.5)), eta_max: Math.max(2, Math.round(base * 1.25 + dr.wait_min * 1.5)) };
}
export function setAvailability(driverId, value, onlyIfBusy = false) {
  run(`UPDATE drivers SET availability=? WHERE id=?${onlyIfBusy ? " AND availability='busy'" : ''}`, value, driverId);
}
const me = (ctx) => { const d = get("SELECT * FROM drivers WHERE user_id=? AND status='active'", ctx.user.id); if (!d) throw notFound('Profil chauffeur'); return d; };
const rating = (d) => (d.rating_count ? Math.round((d.rating_sum / d.rating_count) * 10) / 10 : null);
const pubDriver = (d) => ({ id: d.id, name: d.name, vehicle_type: d.vehicle_type, vehicle: d.vehicle, plate: d.plate, rating: rating(d), rating_count: d.rating_count });

// ---- devis (client) : chauffeurs disponibles de la pharmacie, avec prix, distance et délai ----
router.get('/portal/orders/:id/delivery-quote', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => {
  const o = get(`SELECT * FROM customer_orders WHERE id=? AND customer_id IN ${OWNC}`, ctx.params.id, ctx.user.id); if (!o) throw notFound('Commande');
  const lat = ctx.query.lat === undefined ? null : Number(ctx.query.lat), lng = ctx.query.lng === undefined ? null : Number(ctx.query.lng);
  if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lng !== null && !(lng >= -180 && lng <= 180))) throw bad('VALIDATION', 'Coordonnées invalides');
  const ph = get('SELECT id,name,lat,lng FROM pharmacies WHERE id=?', o.pharmacy_id);
  const drivers = all("SELECT * FROM drivers WHERE pharmacy_id=? AND status='active' AND availability='available' AND id NOT IN (SELECT entity_id FROM trash WHERE entity='driver')", o.pharmacy_id);
  const list = drivers.map((d) => ({ ...pubDriver(d), wait_min: d.wait_min, quote: quoteFor(d, ph, lat, lng) || { distance_m: null, fee: d.base_fee, eta_min: Math.max(1, Math.round(d.wait_min * 0.5)), eta_max: Math.round(d.wait_min * 1.5) + 30 } }));
  list.sort((a, b) => a.quote.fee - b.quote.fee);
  return { pharmacy: ph, drivers: list };
});

// ---- espace chauffeur ----
router.get('/driver/me', { perm: 'driver.use', needsPharmacy: false }, (ctx) => {
  const d = me(ctx); const { user_id, ...rest } = d;
  return { ...rest, rating: rating(d), pharmacy: get('SELECT id,name,lat,lng FROM pharmacies WHERE id=?', d.pharmacy_id), active: all("SELECT id FROM deliveries WHERE driver_id=? AND status IN ('issued','received','in_progress')", d.id).length };
});
router.put('/driver/me', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => {
  const d = me(ctx), b = ctx.body, u = {};
  if (b.availability !== undefined) {
    u.availability = oneOf(b.availability, 'disponibilité', ['offline', 'available', 'busy']);
    if (u.availability === 'offline' && get("SELECT 1 FROM deliveries WHERE driver_id=? AND status='in_progress'", d.id)) throw conflict('IN_USE', 'Course en cours : terminez-la avant de vous mettre hors ligne');
    if (u.availability === 'available' && get("SELECT 1 FROM deliveries WHERE driver_id=? AND status='in_progress'", d.id)) throw conflict('IN_USE', 'Course en cours');
  }
  for (const k of ['base_fee', 'per_km']) if (b[k] !== undefined) { const x = Number(b[k]); if (!Number.isInteger(x) || x < 0 || x > 1e9) throw bad('VALIDATION', k + ' invalide'); u[k] = x; }
  if (b.wait_min !== undefined) u.wait_min = Math.min(480, Math.max(0, Number(b.wait_min) || 0));
  if (b.speed_kmh !== undefined) u.speed_kmh = Math.min(120, Math.max(5, Number(b.speed_kmh) || 25));
  if (b.vehicle_type !== undefined) u.vehicle_type = oneOf(b.vehicle_type, 'véhicule', ['moto', 'scooter', 'velo', 'voiture', 'camionnette', 'taxi']);
  if (b.plate !== undefined) u.plate = str(b.plate, 'plaque', { max: 20 });
  if (b.vehicle !== undefined) u.vehicle = str(b.vehicle, 'véhicule', { max: 60 });
  if (b.phone !== undefined) u.phone = phoneFor({ ph: d.pharmacy_id, user: ctx.user }, b.phone, 'téléphone');
  if (!Object.keys(u).length) throw bad('VALIDATION', 'Aucune modification');
  run(`UPDATE drivers SET ${Object.keys(u).map((k) => k + '=?').join(',')} WHERE id=?`, ...Object.values(u), d.id); audit({ ...ctx, ph: d.pharmacy_id }, 'driver.self_update', 'driver', d.id, undefined, u); return { ok: true };
});
// Position GPS (appelée toutes les ~5 s par le navigateur / l'application du chauffeur)
router.post('/driver/location', { perm: 'driver.use', needsPharmacy: false, ok200: true, bodyLimit: 2048 }, (ctx) => {
  const d = me(ctx); const lat = Number(ctx.body.lat), lng = Number(ctx.body.lng);
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180) || ctx.body.lat === null || ctx.body.lng === null) throw bad('VALIDATION', 'Position invalide');
  run('UPDATE drivers SET lat=?, lng=?, loc_at=? WHERE id=?', lat, lng, nowSql(), d.id);
  const del = get("SELECT * FROM deliveries WHERE driver_id=? AND status='in_progress' ORDER BY id DESC LIMIT 1", d.id);
  if (del) {
    const last = get('SELECT created_at FROM driver_locations WHERE delivery_id=? ORDER BY id DESC LIMIT 1', del.id); // au plus un point par seconde stocké
    if (!last || last.created_at !== nowSql()) insert('INSERT INTO driver_locations(driver_id,delivery_id,lat,lng) VALUES (?,?,?,?)', d.id, del.id, lat, lng);
    const cu = get('SELECT user_id FROM customers WHERE id=?', del.customer_id)?.user_id; const payload = { delivery_id: del.id, lat, lng, at: nowSql() };
    publish(del.pharmacy_id, 'driver_location', payload, cu); publish(del.pharmacy_id, 'driver_location', payload);
  }
  return { ok: true, tracking: !!del };
});
router.get('/driver/deliveries', { perm: 'driver.use', needsPharmacy: false }, (ctx) => {
  const d = me(ctx); const ph = get('SELECT name,address,lat,lng,phone FROM pharmacies WHERE id=?', d.pharmacy_id);
  return { pharmacy: ph, data: all("SELECT id,number,status,address,notes,fee,distance_m,eta_min,eta_max,dest_lat,dest_lng,driver_response,created_at FROM deliveries WHERE driver_id=? ORDER BY id DESC LIMIT 60", d.id).map((x) => ({ ...x, customer_phone: ['received', 'in_progress'].includes(x.status) ? get('SELECT phone FROM deliveries WHERE id=?', x.id).phone : null })) };
});
const myDelivery = (ctx, id) => { const d = me(ctx); const x = get('SELECT * FROM deliveries WHERE id=? AND driver_id=?', id, d.id); if (!x) throw notFound('Course'); return { d, x }; };
const custUser = (x) => get('SELECT user_id FROM customers WHERE id=?', x.customer_id)?.user_id;
const evt = (x, status, note, uid, d) => insert('INSERT INTO delivery_events(delivery_id,status,note,user_id,driver_name,driver_matricule) VALUES (?,?,?,?,?,?)', x.id, status, note, uid, d?.name ?? null, d?.matricule ?? null);
router.post('/driver/deliveries/:id/respond', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const { d, x } = myDelivery(ctx, ctx.params.id); if (!['issued', 'received'].includes(x.status) || x.driver_response === 'accepted' && ctx.body.accept) throw conflict('BAD_STATE', 'Cette course ne peut plus être acceptée');
  const accept = ctx.body.accept === true;
  if (accept) { run("UPDATE deliveries SET driver_response='accepted', updated_at=datetime('now') WHERE id=?", x.id); evt(x, x.status, `Course acceptée par ${d.name}`, ctx.user.id, d); }
  else { run("UPDATE deliveries SET driver_id=NULL, driver_response='declined', updated_at=datetime('now') WHERE id=?", x.id); evt(x, x.status, `Course refusée par ${d.name}`, ctx.user.id, d); }
  notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `${accept ? 'Course acceptée' : 'Course refusée'} par ${d.name} — ${x.number}`, link: '#/deliveries' });
  const cu = custUser(x); if (cu && accept) notify({ pharmacyId: x.pharmacy_id, userId: cu, kind: 'delivery', title: `${d.name} a accepté votre livraison ${x.number}`, link: '#/portal' });
  publish(x.pharmacy_id, 'delivery', { id: x.id, status: x.status }, cu); publish(x.pharmacy_id, 'delivery', { id: x.id, status: x.status }); audit({ ...ctx, ph: x.pharmacy_id }, 'driver.respond', 'delivery', x.id, undefined, { accept }); return { ok: true };
}));
router.post('/driver/deliveries/:id/finish', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const { d, x } = myDelivery(ctx, ctx.params.id); if (x.status !== 'in_progress') throw conflict('BAD_STATE', 'La course n\'est pas en cours');
  const ok = oneOf(ctx.body.result, 'résultat', ['delivered', 'failed'], { required: true }); const note = str(ctx.body.note, 'note', { max: 300 }); if (ok === 'failed' && !note) throw bad('VALIDATION', 'Indiquez le motif');
  run(`UPDATE deliveries SET status=?, failure_reason=?, updated_at=datetime('now'), delivered_at=${ok === 'delivered' ? "datetime('now')" : 'delivered_at'} WHERE id=?`, ok, ok === 'failed' ? note : null, x.id); evt(x, ok, note, ctx.user.id, d); setAvailability(d.id, 'available', true);
  const cu = custUser(x); if (cu) notify({ pharmacyId: x.pharmacy_id, userId: cu, kind: 'delivery', title: ok === 'delivered' ? `Livraison ${x.number} effectuée` : `Livraison ${x.number} : échec`, body: note, link: '#/portal' });
  notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Livraison ${x.number} : ${ok === 'delivered' ? 'effectuée' : 'échec'} (${d.name})`, link: '#/deliveries' });
  publish(x.pharmacy_id, 'delivery', { id: x.id, status: ok }, cu); publish(x.pharmacy_id, 'delivery', { id: x.id, status: ok }); audit({ ...ctx, ph: x.pharmacy_id }, 'driver.finish', 'delivery', x.id, undefined, { ok }); return { ok: true };
}));
router.post('/driver/deliveries/:id/cancel', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const { d, x } = myDelivery(ctx, ctx.params.id); if (!['issued', 'received'].includes(x.status)) throw conflict('BAD_STATE', 'Course déjà en route : contactez la pharmacie');
  const reason = str(ctx.body.reason, 'motif', { required: true, max: 200 });
  run("UPDATE deliveries SET driver_id=NULL, driver_response='declined', cancel_reason=?, cancelled_by='driver', updated_at=datetime('now') WHERE id=?", reason, x.id); evt(x, x.status, `Annulée par le chauffeur : ${reason}`, ctx.user.id, d);
  notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Chauffeur ${d.name} se retire de ${x.number}`, body: reason, link: '#/deliveries' }); publish(x.pharmacy_id, 'delivery', { id: x.id, status: x.status }); return { ok: true };
}));

// ---- suivi du trajet : client et personnel ----
function track(x) {
  const drv = x.driver_id ? get('SELECT lat,lng,loc_at,name,matricule,vehicle_type,plate,phone FROM drivers WHERE id=?', x.driver_id) : null; const ph = get('SELECT name,lat,lng FROM pharmacies WHERE id=?', x.pharmacy_id);
  const live = x.status === 'in_progress'; const out = { tracking: live, status: x.status, pharmacy: ph, destination: x.dest_lat != null ? { lat: x.dest_lat, lng: x.dest_lng } : null, eta_min: x.eta_min, eta_max: x.eta_max, distance_m: x.distance_m };
  if (live && drv) {
    out.driver = { name: drv.name, matricule: drv.matricule, vehicle_type: drv.vehicle_type, plate: drv.plate, phone: drv.phone, lat: drv.lat, lng: drv.lng, updated_at: drv.loc_at };
    out.path = all('SELECT lat,lng,created_at FROM driver_locations WHERE delivery_id=? ORDER BY id DESC LIMIT 300', x.id).reverse();
    if (drv.lat != null && x.dest_lat != null) { const km = haversineKm(drv.lat, drv.lng, x.dest_lat, x.dest_lng) * ROAD; out.remaining_m = Math.round(km * 1000); const sp = get('SELECT speed_kmh FROM drivers WHERE id=?', x.driver_id).speed_kmh; out.remaining_min = Math.max(1, Math.round((km / sp) * 60)); }
  }
  return out;
}
const ownDelivery = (ctx, id) => { const x = get(`SELECT * FROM deliveries WHERE id=? AND customer_id IN ${OWNC}`, id, ctx.user.id); if (!x) throw notFound('Livraison'); return x; };
const staffDelivery = (ctx, id) => { const x = get('SELECT * FROM deliveries WHERE id=? AND pharmacy_id=?', id, ctx.ph); if (!x) throw notFound('Livraison'); return x; };
router.get('/portal/deliveries/:id/track', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => track(ownDelivery(ctx, ctx.params.id)));
router.get('/deliveries/:id/track', { perm: 'deliveries.view' }, (ctx) => track(staffDelivery(ctx, ctx.params.id)));
router.get('/drivers/live', { perm: 'deliveries.view' }, (ctx) => ({ pharmacy: get('SELECT name,lat,lng FROM pharmacies WHERE id=?', ctx.ph), drivers: all("SELECT id,name,matricule,vehicle_type,availability,lat,lng,loc_at FROM drivers WHERE pharmacy_id=? AND status='active' AND lat IS NOT NULL AND id NOT IN (SELECT entity_id FROM trash WHERE entity='driver')", ctx.ph) }));
router.get('/driver/deliveries/:id/track', { perm: 'driver.use', needsPharmacy: false }, (ctx) => track(myDelivery(ctx, ctx.params.id).x));

// ---- messagerie client ↔ chauffeur (+ pharmacie) ----
const msgs = (id) => all('SELECT m.id, m.sender_role, m.body, m.created_at, u.name sender_name FROM delivery_messages m JOIN users u ON u.id=m.sender_user_id WHERE m.delivery_id=? ORDER BY m.id', id);
function postMsg(ctx, x, role) {
  if (['delivered', 'cancelled', 'failed'].includes(x.status) && Date.now() - new Date(String(x.updated_at).replace(' ', 'T') + 'Z') > 24 * 3600e3) throw conflict('CLOSED', 'Conversation clôturée');
  const body = str(ctx.body.body, 'message', { required: true, max: 500 }); const id = insert('INSERT INTO delivery_messages(delivery_id,sender_user_id,sender_role,body) VALUES (?,?,?,?)', x.id, ctx.user.id, role, body);
  const du = x.driver_id ? get('SELECT user_id FROM drivers WHERE id=?', x.driver_id)?.user_id : null; const cu = custUser(x);
  const title = `Message — livraison ${x.number}`;
  if (role !== 'customer' && cu) notify({ pharmacyId: x.pharmacy_id, userId: cu, kind: 'delivery', title, body: body.slice(0, 120), link: '#/portal' });
  if (role !== 'driver' && du) notify({ pharmacyId: x.pharmacy_id, userId: du, kind: 'delivery', title, body: body.slice(0, 120), link: '#/driver' });
  if (role !== 'staff') notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title, body: body.slice(0, 120), link: '#/deliveries' });
  publish(x.pharmacy_id, 'delivery_message', { delivery_id: x.id }, cu); publish(x.pharmacy_id, 'delivery_message', { delivery_id: x.id }, du); return { id };
}
router.get('/portal/deliveries/:id/messages', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => msgs(ownDelivery(ctx, ctx.params.id).id));
router.post('/portal/deliveries/:id/messages', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => postMsg(ctx, ownDelivery(ctx, ctx.params.id), 'customer'));
router.get('/driver/deliveries/:id/messages', { perm: 'driver.use', needsPharmacy: false }, (ctx) => msgs(myDelivery(ctx, ctx.params.id).x.id));
router.post('/driver/deliveries/:id/messages', { perm: 'driver.use', needsPharmacy: false }, (ctx) => postMsg(ctx, myDelivery(ctx, ctx.params.id).x, 'driver'));
router.get('/deliveries/:id/messages', { perm: 'deliveries.view' }, (ctx) => msgs(staffDelivery(ctx, ctx.params.id).id));
router.post('/deliveries/:id/messages', { perm: 'deliveries.manage' }, (ctx) => postMsg(ctx, staffDelivery(ctx, ctx.params.id), 'staff'));

// ---- notes et signalements (dans les deux sens) ----
function rate(ctx, x, target) {
  if (x.status !== 'delivered') throw conflict('BAD_STATE', 'Notation possible après la livraison');
  const stars = int(ctx.body.stars, 'note', { required: true, min: 1, max: 5 }); const comment = str(ctx.body.comment, 'commentaire', { max: 300 });
  if (get('SELECT 1 FROM delivery_ratings WHERE delivery_id=? AND target=?', x.id, target)) throw conflict('DUPLICATE', 'Déjà noté');
  tx(() => { insert('INSERT INTO delivery_ratings(delivery_id,rater_user_id,target,stars,comment) VALUES (?,?,?,?,?)', x.id, ctx.user.id, target, stars, comment); if (target === 'driver' && x.driver_id) run('UPDATE drivers SET rating_sum=rating_sum+?, rating_count=rating_count+1 WHERE id=?', stars, x.driver_id); });
  return { ok: true };
}
function report(ctx, x, target) {
  const reason = str(ctx.body.reason, 'motif', { required: true, max: 120 }), details = str(ctx.body.details, 'détails', { max: 600 });
  const id = insert('INSERT INTO delivery_reports(delivery_id,reporter_user_id,target,reason,details) VALUES (?,?,?,?,?)', x.id, ctx.user.id, target, reason, details);
  notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Signalement ${target === 'driver' ? 'chauffeur' : 'client'} — ${x.number}`, body: reason, link: '#/deliveries' }); audit({ ...ctx, ph: x.pharmacy_id }, 'delivery.report', 'delivery', x.id, undefined, { target, reason }); return { id };
}
router.post('/portal/deliveries/:id/rate', { perm: 'portal.use', needsPharmacy: false, ok200: true }, (ctx) => rate(ctx, ownDelivery(ctx, ctx.params.id), 'driver'));
router.post('/portal/deliveries/:id/report', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => report(ctx, ownDelivery(ctx, ctx.params.id), 'driver'));
router.post('/driver/deliveries/:id/rate', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => rate(ctx, myDelivery(ctx, ctx.params.id).x, 'customer'));
router.post('/driver/deliveries/:id/report', { perm: 'driver.use', needsPharmacy: false }, (ctx) => report(ctx, myDelivery(ctx, ctx.params.id).x, 'customer'));
router.get('/delivery-reports', { perm: 'deliveries.manage' }, (ctx) => all("SELECT r.*, d.number FROM delivery_reports r JOIN deliveries d ON d.id=r.delivery_id WHERE d.pharmacy_id=? ORDER BY r.id DESC LIMIT 200", ctx.ph));
router.put('/delivery-reports/:id', { perm: 'deliveries.manage', ok200: true }, (ctx) => {
  const r = get('SELECT r.id FROM delivery_reports r JOIN deliveries d ON d.id=r.delivery_id WHERE r.id=? AND d.pharmacy_id=?', ctx.params.id, ctx.ph); if (!r) throw notFound('Signalement');
  run('UPDATE delivery_reports SET status=? WHERE id=?', oneOf(ctx.body.status, 'statut', ['open', 'reviewed', 'dismissed'], { required: true }), r.id); return { ok: true };
});
