// Espace chauffeur : disponibilité, tarifs, position GPS en temps réel, devis de livraison, acceptation de course,
// suivi du trajet par le client, messagerie, notes, signalements, annulations.
import { router, audit, notify, publish, can } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { bad, conflict, notFound, forbidden, str, int, oneOf, nowSql } from '../util.js';
import { haversineKm } from './discover.js';
import { phoneFor } from '../phone.js';
import { savePrivate, readPrivate, mimeOfName } from '../files.js';
import { dlvConfig, saveConfig, modesView, MODES, MODE_CODES } from '../delivery_config.js';

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
// Un chauffeur peut être affecté à plusieurs pharmacies (livraisons uniquement) : sa pharmacie d'origine + driver_pharmacies.
export const AFF = '(d.pharmacy_id=? OR d.id IN (SELECT driver_id FROM driver_pharmacies WHERE pharmacy_id=?))';
export const isAffiliated = (d, phId) => d.pharmacy_id === phId || !!get('SELECT 1 FROM driver_pharmacies WHERE driver_id=? AND pharmacy_id=?', d.id, phId);
export function driverPharmacies(d) {
  const rows = all('SELECT p.id,p.name,p.address,p.lat,p.lng,dp.depart_lat,dp.depart_lng,dp.depart_label FROM pharmacies p LEFT JOIN driver_pharmacies dp ON dp.pharmacy_id=p.id AND dp.driver_id=? WHERE p.id=? OR dp.id IS NOT NULL ORDER BY p.name', d.id, d.pharmacy_id);
  return rows.map((p) => ({ id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, depart_lat: p.depart_lat ?? p.lat, depart_lng: p.depart_lng ?? p.lng, depart_label: p.depart_label || p.name, home: p.id === d.pharmacy_id }));
}
export function notifySupers({ pharmacyId, title, body, link = '#/deliveries' }) {
  for (const u of all("SELECT id FROM users WHERE role_code='super_admin' AND status='active'")) notify({ pharmacyId, userId: u.id, kind: 'delivery', title, body, link });
}
// Prix « standard » d'une course pour un chauffeur : frais de base + prix au km × distance (pharmacie → client, facteur routier inclus).
export function standardFee(dr, ph, lat, lng) {
  if (lat == null || lng == null || ph?.lat == null || ph?.lng == null) return { fee: dr.base_fee, distance_m: null };
  const km = haversineKm(ph.lat, ph.lng, lat, lng) * ROAD; return { fee: Math.round(dr.base_fee + dr.per_km * km), distance_m: Math.round(km * 1000) };
}
// Affectations d'un chauffeur à des pharmacies (avec point de départ). Super-administrateur : toutes ; administrateur : sa propre pharmacie.
export function applyAffiliations(ctx, driverId, list, { replace = false } = {}) {
  const isSuper = ctx.user.role === 'super_admin'; const items = Array.isArray(list) ? list : [];
  const num = (v, lo, hi) => { if (v === undefined || v === null || v === '') return null; const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw bad('VALIDATION', 'Coordonnées de départ invalides'); return x; };
  for (const it of items) {
    const pid = Number(it.pharmacy_id); if (!isSuper && pid !== ctx.ph) throw forbidden('Vous ne pouvez affecter un chauffeur qu\'à votre pharmacie'); if (!get('SELECT 1 FROM pharmacies WHERE id=?', pid)) throw notFound('Pharmacie');
    const la = num(it.depart_lat, -90, 90), ln = num(it.depart_lng, -180, 180); if ((la === null) !== (ln === null)) throw bad('VALIDATION', 'Latitude et longitude du départ requises ensemble');
    const label = str(it.depart_label, 'lieu de départ', { max: 160 }) || null;
    if (it.remove) { run('DELETE FROM driver_pharmacies WHERE driver_id=? AND pharmacy_id=?', driverId, pid); continue; }
    run('INSERT INTO driver_pharmacies(driver_id,pharmacy_id,depart_lat,depart_lng,depart_label) VALUES (?,?,?,?,?) ON CONFLICT(driver_id,pharmacy_id) DO UPDATE SET depart_lat=excluded.depart_lat, depart_lng=excluded.depart_lng, depart_label=excluded.depart_label', driverId, pid, la, ln, label);
  }
  if (replace && isSuper) { const keep = items.filter((i) => !i.remove).map((i) => Number(i.pharmacy_id)); if (keep.length) { const home = get('SELECT pharmacy_id FROM drivers WHERE id=?', driverId).pharmacy_id; for (const r of all('SELECT pharmacy_id FROM driver_pharmacies WHERE driver_id=?', driverId)) if (!keep.includes(r.pharmacy_id)) run('DELETE FROM driver_pharmacies WHERE driver_id=? AND pharmacy_id=?', driverId, r.pharmacy_id); if (!keep.includes(home)) run('UPDATE drivers SET pharmacy_id=? WHERE id=?', keep[0], driverId); } }
}
export const photoUrl = (d) => (d.photo_file ? `/api/v1/public/file/${d.photo_file}` : null);
const me = (ctx) => { const d = get("SELECT * FROM drivers WHERE user_id=? AND status='active'", ctx.user.id); if (!d) throw notFound('Profil chauffeur'); return d; };
const rating = (d) => (d.rating_count ? Math.round((d.rating_sum / d.rating_count) * 10) / 10 : null);
const pubDriver = (d) => ({ id: d.id, photo_url: photoUrl(d), name: d.name, vehicle_type: d.vehicle_type, vehicle: d.vehicle, plate: d.plate, rating: rating(d), rating_count: d.rating_count });

// ---- devis (client) : les 4 modes (prix + délai), chauffeurs disponibles autour de la pharmacie (temps d'arrivée, distances), éligibilité de la demande ----
router.get('/portal/orders/:id/delivery-quote', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => {
  const o = get(`SELECT * FROM customer_orders WHERE id=? AND customer_id IN ${OWNC}`, ctx.params.id, ctx.user.id); if (!o) throw notFound('Commande');
  const lat = ctx.query.lat === undefined ? null : Number(ctx.query.lat), lng = ctx.query.lng === undefined ? null : Number(ctx.query.lng);
  if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lng !== null && !(lng >= -180 && lng <= 180))) throw bad('VALIDATION', 'Coordonnées invalides');
  const ph = get('SELECT id,name,lat,lng,currency,currency_decimals FROM pharmacies WHERE id=?', o.pharmacy_id), cfg = dlvConfig(o.pharmacy_id);
  const drivers = all("SELECT d.* FROM drivers d WHERE " + AFF + " AND d.status='active' AND d.availability='available' AND d.id NOT IN (SELECT entity_id FROM trash WHERE entity='driver')", o.pharmacy_id, o.pharmacy_id);
  const km = lat !== null && ph.lat != null ? haversineKm(ph.lat, ph.lng, lat, lng) * ROAD : null;
  const list = drivers.map((d) => { const toPh = d.lat != null && ph.lat != null ? haversineKm(d.lat, d.lng, ph.lat, ph.lng) * ROAD : null, toCl = d.lat != null && lat !== null ? haversineKm(d.lat, d.lng, lat, lng) * ROAD : null;
    return { ...pubDriver(d), status: 'Disponible', lat: d.lat, lng: d.lng, to_pharmacy_m: toPh === null ? null : Math.round(toPh * 1000), to_pharmacy_min: toPh === null ? null : Math.max(1, Math.round((toPh / d.speed_kmh) * 60)), to_client_m: toCl === null ? null : Math.round(toCl * 1000) }; });
  list.sort((a, b) => (a.to_pharmacy_m ?? 1e9) - (b.to_pharmacy_m ?? 1e9));
  const stageOk = ['preparing', 'ready'].includes(o.status), hasDriver = list.length > 0, tooFar = km !== null && cfg.max_km > 0 && km > cfg.max_km;
  const eligible = stageOk && hasDriver && !['cancelled', 'expired', 'picked_up'].includes(o.status) && !get('SELECT 1 FROM deliveries WHERE order_id=?', o.id);
  return { pharmacy: ph, drivers: list, modes: modesView(cfg, km), distance_m: km === null ? null : Math.round(km * 1000), max_km: cfg.max_km, too_far: tooFar, eligible, reason: !stageOk ? 'La commande doit être au minimum « En préparation »' : !hasDriver ? 'Aucun chauffeur disponible actuellement dans le secteur' : tooFar ? `Adresse au-delà de la distance maximale (${cfg.max_km} km)` : null, currency: ph.currency, decimals: ph.currency_decimals };
});
// Réglage des tarifs de livraison (administrateur de la pharmacie ; le super-administrateur choisit la pharmacie active).
router.get('/delivery-config', { perm: 'settings.manage' }, (ctx) => ({ ...dlvConfig(ctx.ph), modes: Object.fromEntries(MODE_CODES.map((m) => [m, MODES[m].label])), ...get('SELECT currency,currency_decimals decimals FROM pharmacies WHERE id=?', ctx.ph) }));
router.put('/delivery-config', { perm: 'settings.manage' }, (ctx) => { const before = dlvConfig(ctx.ph), after = saveConfig(ctx.ph, ctx.body || {}); audit(ctx, 'delivery_config.update', 'pharmacy', ctx.ph, before, after); return after; });

// ---- espace chauffeur ----
router.get('/driver/me', { perm: 'driver.use', needsPharmacy: false }, (ctx) => {
  const d = me(ctx); const { user_id, ...rest } = d;
  return { ...rest, rating: rating(d), pharmacy: get('SELECT id,name,lat,lng FROM pharmacies WHERE id=?', d.pharmacy_id), pharmacies: driverPharmacies(d), photo_url: photoUrl(d), has_id_doc: !!d.id_doc_file, id_doc_file: undefined, photo_file: undefined, active: all("SELECT id FROM deliveries WHERE driver_id=? AND status IN ('issued','received','in_progress')", d.id).length };
});
router.put('/driver/me', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => {
  const d = me(ctx), b = ctx.body, u = {};
  if (b.availability !== undefined) {
    u.availability = oneOf(b.availability, 'disponibilité', ['offline', 'available', 'busy']);
    if (u.availability === 'offline' && get("SELECT 1 FROM deliveries WHERE driver_id=? AND status='in_progress'", d.id)) throw conflict('IN_USE', 'Course en cours : terminez-la avant de vous mettre hors ligne');
    if (u.availability === 'available' && get("SELECT 1 FROM deliveries WHERE driver_id=? AND status='in_progress'", d.id)) throw conflict('IN_USE', 'Course en cours');
  }
  if (b.base_fee !== undefined || b.per_km !== undefined) throw forbidden('Le prix de base et le prix au kilomètre sont fixés par l\'administrateur');
  if (b.home_address !== undefined) u.home_address = str(b.home_address, 'adresse', { max: 200 });
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
  const rows = all("SELECT x.id,x.number,x.status,x.address,x.notes,x.fee,x.standard_fee,x.distance_m,x.eta_min,x.eta_max,x.dest_lat,x.dest_lng,x.driver_response,x.picked_up_at,x.created_at,x.pharmacy_id,p.name pharmacy_name,p.address pharmacy_address,p.lat pharmacy_lat,p.lng pharmacy_lng,p.phone pharmacy_phone,c.name customer_name,(SELECT 1 FROM delivery_ratings q WHERE q.delivery_id=x.id AND q.target='customer') rated,x.phone FROM deliveries x JOIN pharmacies p ON p.id=x.pharmacy_id JOIN customers c ON c.id=x.customer_id WHERE x.driver_id=? ORDER BY x.id DESC LIMIT 60", d.id);
  return { pharmacy: ph, data: rows.map(({ phone, ...x }) => ({ ...x, customer_phone: ['received', 'in_progress', 'issued'].includes(x.status) && x.driver_response === 'accepted' || x.status === 'in_progress' ? phone : null, depart: (driverPharmacies(d).find((q) => q.id === x.pharmacy_id) || {}) })) };
});
const myDelivery = (ctx, id) => { const d = me(ctx); const x = get('SELECT * FROM deliveries WHERE id=? AND driver_id=?', id, d.id); if (!x) throw notFound('Course'); return { d, x }; };
const custUser = (x) => get('SELECT user_id FROM customers WHERE id=?', x.customer_id)?.user_id;
const evt = (x, status, note, uid, d) => insert('INSERT INTO delivery_events(delivery_id,status,note,user_id,driver_name,driver_matricule) VALUES (?,?,?,?,?,?)', x.id, status, note, uid, d?.name ?? null, d?.matricule ?? null);
router.post('/driver/deliveries/:id/respond', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const { d, x } = myDelivery(ctx, ctx.params.id); if (!['issued', 'received'].includes(x.status) || (x.driver_response === 'accepted' && ctx.body.accept)) throw conflict('BAD_STATE', 'Cette course ne peut plus être acceptée');
  const accept = ctx.body.accept === true, shown = x.fee, cu = custUser(x);
  if (accept && ctx.body.price !== undefined && ctx.body.price !== null && ctx.body.price !== '' && Number(ctx.body.price) !== shown) { // contre-proposition de prix : alertes pharmacie, administrateur et super-administrateurs
    const price = int(ctx.body.price, 'prix', { required: true, min: 0, max: Math.max(shown * 10, 100000) }); const dec = get('SELECT currency,currency_decimals FROM pharmacies WHERE id=?', x.pharmacy_id), fmt = (n) => `${(n / 10 ** dec.currency_decimals).toFixed(dec.currency_decimals)} ${dec.currency}`;
    run("INSERT INTO delivery_offers(delivery_id,driver_id,kind,price,standard_price,distance_m,status) VALUES (?,?,'counter',?,?,?,'pending') ON CONFLICT(delivery_id,driver_id) DO UPDATE SET kind='counter', price=excluded.price, standard_price=excluded.standard_price, status='pending', updated_at=datetime('now')", x.id, d.id, price, x.standard_fee ?? shown, x.distance_m);
    run("UPDATE deliveries SET driver_response='counter', updated_at=datetime('now') WHERE id=?", x.id); evt(x, x.status, `${d.name} propose ${fmt(price)} au lieu de ${fmt(shown)}`, ctx.user.id, d);
    const t = `⚠ Prix modifié par ${d.name} : ${fmt(price)} au lieu de ${fmt(shown)} — ${x.number}`;
    notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: t, link: `#/deliveries?id=${x.id}` }); notifySupers({ pharmacyId: x.pharmacy_id, title: t, body: `Chauffeur ${d.name} (${d.matricule})` });
    if (cu) notify({ pharmacyId: x.pharmacy_id, userId: cu, kind: 'delivery', title: `${d.name} propose ${fmt(price)} pour votre livraison ${x.number}`, body: `Prix initial : ${fmt(shown)}. Confirmez ou choisissez un autre chauffeur.`, link: `#/portal?tab=deliveries&id=${x.id}` });
    audit({ ...ctx, ph: x.pharmacy_id }, 'driver.price_counter', 'delivery', x.id, { fee: shown }, { price }); publish(x.pharmacy_id, 'delivery', { id: x.id, status: x.status }, cu); publish(x.pharmacy_id, 'delivery', { id: x.id, status: x.status }); return { ok: true, counter: true };
  }
  if (accept) { run("UPDATE deliveries SET driver_response='accepted', accepted_at=datetime('now'), updated_at=datetime('now') WHERE id=?", x.id); evt(x, x.status, `Course acceptée par ${d.name}`, ctx.user.id, d); }
  else { run("UPDATE deliveries SET driver_id=NULL, driver_response='declined', updated_at=datetime('now') WHERE id=?", x.id); evt(x, x.status, `Course refusée par ${d.name}`, ctx.user.id, d); }
  notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `${accept ? 'Course acceptée' : 'Course refusée'} par ${d.name} — ${x.number}`, link: `#/deliveries?id=${x.id}` });
  if (cu && accept) notify({ pharmacyId: x.pharmacy_id, userId: cu, kind: 'delivery', title: `${d.name} a accepté votre livraison ${x.number}`, link: `#/portal?tab=deliveries&id=${x.id}` });
  publish(x.pharmacy_id, 'delivery', { id: x.id, status: x.status }, cu); publish(x.pharmacy_id, 'delivery', { id: x.id, status: x.status }); audit({ ...ctx, ph: x.pharmacy_id }, 'driver.respond', 'delivery', x.id, undefined, { accept }); return { ok: true };
}));
router.post('/driver/deliveries/:id/finish', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const { d, x } = myDelivery(ctx, ctx.params.id); if (x.status !== 'in_progress') throw conflict('BAD_STATE', 'La course n\'est pas en cours');
  const ok = oneOf(ctx.body.result, 'résultat', ['delivered', 'failed'], { required: true }); const note = str(ctx.body.note, 'note', { max: 300 }); if (ok === 'failed' && !note) throw bad('VALIDATION', 'Indiquez le motif');
  run(`UPDATE deliveries SET status=?, failure_reason=?, updated_at=datetime('now'), delivered_at=${ok === 'delivered' ? "datetime('now')" : 'delivered_at'} WHERE id=?`, ok, ok === 'failed' ? note : null, x.id); evt(x, ok, note, ctx.user.id, d); setAvailability(d.id, 'available', true);
  const cu = custUser(x); if (cu) notify({ pharmacyId: x.pharmacy_id, userId: cu, kind: 'delivery', title: ok === 'delivered' ? `Livraison ${x.number} effectuée` : `Livraison ${x.number} : échec`, body: note, link: `#/portal?tab=deliveries&id=${x.id}` });
  notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Livraison ${x.number} : ${ok === 'delivered' ? 'effectuée' : 'échec'} (${d.name})`, link: `#/deliveries?id=${x.id}` });
  publish(x.pharmacy_id, 'delivery', { id: x.id, status: ok }, cu); publish(x.pharmacy_id, 'delivery', { id: x.id, status: ok }); audit({ ...ctx, ph: x.pharmacy_id }, 'driver.finish', 'delivery', x.id, undefined, { ok }); return { ok: true };
}));
router.post('/driver/deliveries/:id/cancel', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const { d, x } = myDelivery(ctx, ctx.params.id); if (!['issued', 'received'].includes(x.status)) throw conflict('BAD_STATE', 'Course déjà en route : contactez la pharmacie');
  const reason = str(ctx.body.reason, 'motif', { required: true, max: 200 });
  run("UPDATE deliveries SET driver_id=NULL, driver_response='declined', cancel_reason=?, cancelled_by='driver', updated_at=datetime('now') WHERE id=?", reason, x.id); evt(x, x.status, `Annulée par le chauffeur : ${reason}`, ctx.user.id, d);
  notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Chauffeur ${d.name} se retire de ${x.number}`, body: reason, link: `#/deliveries?id=${x.id}` }); publish(x.pharmacy_id, 'delivery', { id: x.id, status: x.status }); return { ok: true };
}));

// ---- suivi du trajet : client et personnel ----
function track(x, forCustomer = false) {
  const drv = x.driver_id ? get('SELECT * FROM drivers WHERE id=?', x.driver_id) : null; const ph = get('SELECT name,address,lat,lng FROM pharmacies WHERE id=?', x.pharmacy_id);
  const live = x.status === 'in_progress'; const approaching = !forCustomer && x.driver_response === 'accepted' && ['issued', 'received'].includes(x.status);
  const out = { tracking: live, approaching, status: x.status, pharmacy: ph, destination: x.dest_lat != null ? { lat: x.dest_lat, lng: x.dest_lng, label: x.address } : null, eta_min: x.eta_min, eta_max: x.eta_max, distance_m: x.distance_m, picked_up_at: x.picked_up_at };
  if ((live || approaching) && drv) {
    out.driver = { id: drv.id, photo_url: photoUrl(drv), name: drv.name, matricule: drv.matricule, vehicle_type: drv.vehicle_type, vehicle: drv.vehicle, plate: drv.plate, phone: drv.phone, rating: rating(drv), rating_count: drv.rating_count, lat: drv.lat, lng: drv.lng, updated_at: drv.loc_at };
    if (live) out.path = all('SELECT lat,lng,created_at FROM driver_locations WHERE delivery_id=? ORDER BY id DESC LIMIT 300', x.id).reverse();
    if (live && drv.lat != null && x.dest_lat != null) { const km = haversineKm(drv.lat, drv.lng, x.dest_lat, x.dest_lng) * ROAD; out.remaining_m = Math.round(km * 1000); out.remaining_min = Math.max(1, Math.round((km / drv.speed_kmh) * 60)); }
  }
  return out;
}
// Profils partagés : le client sait qui arrive avec son produit, le chauffeur sait à qui le remettre, la pharmacie voit les deux (lecture seule).
const CLOSED = ['delivered', 'failed', 'cancelled'];
function parties(x, viewer) {
  const drv = x.driver_id ? get('SELECT * FROM drivers WHERE id=?', x.driver_id) : null, cu = get('SELECT c.name,c.user_id,u.avatar_path FROM customers c LEFT JOIN users u ON u.id=c.user_id WHERE c.id=?', x.customer_id), ph = get('SELECT id,name,address,phone,lat,lng FROM pharmacies WHERE id=?', x.pharmacy_id);
  const started = ['in_progress', 'delivered', 'failed'].includes(x.status), showDriver = !!drv && (viewer !== 'customer' || started || x.offer_mode === 'driver');
  const closed = CLOSED.includes(x.status), showPhone = !closed && (started || x.driver_response === 'accepted'); // plus aucun contact une fois la livraison terminée
  return { delivery: { id: x.id, number: x.number, status: x.status, fee: x.fee, address: x.address, started, closed },
    driver: showDriver ? { name: drv.name, matricule: drv.matricule, photo_url: photoUrl(drv), vehicle: drv.vehicle, vehicle_type: drv.vehicle_type, plate: drv.plate, rating: rating(drv), rating_count: drv.rating_count, phone: showPhone || viewer === 'staff' ? drv.phone : null } : null,
    customer: { name: cu?.name, photo_url: cu?.avatar_path ? `/api/v1/public/file/${cu.avatar_path}` : null, phone: viewer === 'staff' || (!closed && (viewer === 'customer' || started || x.driver_response === 'accepted')) ? x.phone : null, address: x.address }, pharmacy: ph };
}
const ownDelivery = (ctx, id) => { const x = get(`SELECT * FROM deliveries WHERE id=? AND customer_id IN ${OWNC}`, id, ctx.user.id); if (!x) throw notFound('Livraison'); return x; };
const staffDelivery = (ctx, id) => { const x = ctx.user.role === 'super_admin' ? get('SELECT * FROM deliveries WHERE id=?', id) : get('SELECT * FROM deliveries WHERE id=? AND pharmacy_id=?', id, ctx.ph); if (!x) throw notFound('Livraison'); return x; };
router.get('/portal/deliveries/:id/track', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => track(ownDelivery(ctx, ctx.params.id), true));
router.get('/portal/deliveries/:id/parties', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => parties(ownDelivery(ctx, ctx.params.id), 'customer'));
router.get('/driver/deliveries/:id/parties', { perm: 'driver.use', needsPharmacy: false }, (ctx) => parties(myDelivery(ctx, ctx.params.id).x, 'driver'));
router.get('/deliveries/:id/parties', { perm: 'deliveries.view' }, (ctx) => parties(staffDelivery(ctx, ctx.params.id), 'staff'));
router.get('/deliveries/:id/track', { perm: 'deliveries.view' }, (ctx) => track(staffDelivery(ctx, ctx.params.id)));
router.get('/drivers/live', { perm: 'deliveries.view' }, (ctx) => ({ pharmacy: get('SELECT name,lat,lng FROM pharmacies WHERE id=?', ctx.ph), drivers: all("SELECT d.id,d.name,d.matricule,d.vehicle_type,d.availability,d.lat,d.lng,d.loc_at FROM drivers d WHERE " + AFF + " AND d.status='active' AND d.lat IS NOT NULL AND d.id NOT IN (SELECT entity_id FROM trash WHERE entity='driver')", ctx.ph, ctx.ph) }));
router.get('/driver/deliveries/:id/track', { perm: 'driver.use', needsPharmacy: false }, (ctx) => track(myDelivery(ctx, ctx.params.id).x));

// ---- messagerie client ↔ chauffeur (+ pharmacie) ----
const msgs = (id) => all('SELECT m.id, m.sender_role, m.body, m.created_at, m.file_name, u.name sender_name FROM delivery_messages m JOIN users u ON u.id=m.sender_user_id WHERE m.delivery_id=? ORDER BY m.id', id).map((m) => ({ ...m, has_file: !!m.file_name }));
const attach = (f) => (f ? savePrivate(f, 3 * 1024 * 1024) : null); // pièce jointe : analysée par l'antivirus avant stockage
function postMsg(ctx, x, role) {
  if (CLOSED.includes(x.status)) throw conflict('CLOSED', 'Livraison terminée : la conversation est fermée, seul l\'historique reste consultable');
  if (x.status !== 'in_progress') throw conflict('NOT_STARTED', 'La messagerie est ouverte dès que le chauffeur a quitté la pharmacie avec le produit');
  const file = attach(ctx.body.file), body = str(ctx.body.body, 'message', { required: !file, max: 500 }) || '📎';
  const id = insert('INSERT INTO delivery_messages(delivery_id,sender_user_id,sender_role,body,file,file_name) VALUES (?,?,?,?,?,?)', x.id, ctx.user.id, role, body, file?.path ?? null, file?.name ?? null);
  const du = x.driver_id ? get('SELECT user_id FROM drivers WHERE id=?', x.driver_id)?.user_id : null; const cu = custUser(x);
  const title = `Message — livraison ${x.number}`;
  if (role !== 'customer' && cu) notify({ pharmacyId: x.pharmacy_id, userId: cu, kind: 'delivery', title, body: body.slice(0, 120), link: `#/portal?tab=deliveries&id=${x.id}` });
  if (role !== 'driver' && du) notify({ pharmacyId: x.pharmacy_id, userId: du, kind: 'delivery', title, body: body.slice(0, 120), link: `#/driver?id=${x.id}` });
  publish(x.pharmacy_id, 'delivery_message', { delivery_id: x.id }, cu); publish(x.pharmacy_id, 'delivery_message', { delivery_id: x.id }, du); publish(x.pharmacy_id, 'delivery_message', { delivery_id: x.id }); return { id };
}
const sendFile = (ctx, path, name) => { const buf = readPrivate(path); if (!buf) throw notFound('Fichier'); ctx.res.writeHead(200, { 'Content-Type': mimeOfName(path), 'Content-Disposition': `inline; filename="${String(name || 'piece').replace(/[^\w.\- ]/g, '_')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); ctx.res.end(buf); };
// Téléchargement d'une pièce jointe : seulement les participants de la livraison (client, chauffeur) et le personnel de la pharmacie.
router.get('/delivery-files/message/:id', { needsPharmacy: false }, (ctx) => {
  const m = get('SELECT m.file,m.file_name,d.* FROM delivery_messages m JOIN deliveries d ON d.id=m.delivery_id WHERE m.id=? AND m.file IS NOT NULL', ctx.params.id); if (!m) throw notFound('Fichier');
  const ok = ctx.user.role === 'super_admin' || (isStaff(ctx) && ctx.ph === m.pharmacy_id) || custUser(m) === ctx.user.id || (m.driver_id && get('SELECT user_id FROM drivers WHERE id=?', m.driver_id)?.user_id === ctx.user.id); if (!ok) throw notFound('Fichier'); sendFile(ctx, m.file, m.file_name);
});
router.get('/delivery-files/report/:id', { needsPharmacy: false }, (ctx) => {
  const r = get('SELECT r.file,r.file_name,r.reporter_user_id,d.pharmacy_id FROM delivery_reports r JOIN deliveries d ON d.id=r.delivery_id WHERE r.id=? AND r.file IS NOT NULL', ctx.params.id); if (!r) throw notFound('Fichier');
  if (!(ctx.user.role === 'super_admin' || r.reporter_user_id === ctx.user.id || (isStaff(ctx) && ctx.ph === r.pharmacy_id))) throw notFound('Fichier'); sendFile(ctx, r.file, r.file_name);
});
router.get('/portal/deliveries/:id/messages', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => msgs(ownDelivery(ctx, ctx.params.id).id));
router.post('/portal/deliveries/:id/messages', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => postMsg(ctx, ownDelivery(ctx, ctx.params.id), 'customer'));
router.get('/driver/deliveries/:id/messages', { perm: 'driver.use', needsPharmacy: false }, (ctx) => msgs(myDelivery(ctx, ctx.params.id).x.id));
router.post('/driver/deliveries/:id/messages', { perm: 'driver.use', needsPharmacy: false }, (ctx) => postMsg(ctx, myDelivery(ctx, ctx.params.id).x, 'driver'));
router.get('/deliveries/:id/messages', { perm: 'deliveries.view' }, (ctx) => msgs(staffDelivery(ctx, ctx.params.id).id));
// Pharmacie : lecture seule de la conversation client ↔ chauffeur (aucune écriture).

// ---- notes et signalements (dans les deux sens) ----
function rate(ctx, x, target) {
  if (x.status !== 'delivered') throw conflict('BAD_STATE', 'Notation possible après la livraison');
  const stars = int(ctx.body.stars, 'note', { required: true, min: 1, max: 5 }); const comment = str(ctx.body.comment, 'commentaire', { max: 300 });
  if (get('SELECT 1 FROM delivery_ratings WHERE delivery_id=? AND target=?', x.id, target)) throw conflict('DUPLICATE', 'Déjà noté');
  tx(() => { insert("INSERT INTO delivery_ratings(delivery_id,rater_user_id,target,stars,comment,status) VALUES (?,?,?,?,?,'pending')", x.id, ctx.user.id, target, stars, comment); });
  const t = `Nouvelle note ${stars}/5 à valider — ${x.number}`; notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: t, body: comment || '', link: `#/deliveries?id=${x.id}` }); notifySupers({ pharmacyId: x.pharmacy_id, title: t, body: comment || '' });
  return { ok: true, pending: true };
}
function report(ctx, x, target) {
  const reason = str(ctx.body.reason, 'motif', { required: true, max: 120 }), details = str(ctx.body.details, 'détails', { max: 600 });
  const file = attach(ctx.body.file); const id = insert('INSERT INTO delivery_reports(delivery_id,reporter_user_id,target,reason,details,file,file_name) VALUES (?,?,?,?,?,?,?)', x.id, ctx.user.id, target, reason, details, file?.path ?? null, file?.name ?? null);
  const rt = `Signalement ${target === 'driver' ? 'chauffeur' : 'client'} — ${x.number}`; notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: rt, body: reason, link: `#/deliveries?id=${x.id}` }); notifySupers({ pharmacyId: x.pharmacy_id, title: rt, body: reason }); audit({ ...ctx, ph: x.pharmacy_id }, 'delivery.report', 'delivery', x.id, undefined, { target, reason }); return { id };
}
router.post('/portal/deliveries/:id/rate', { perm: 'portal.use', needsPharmacy: false, ok200: true }, (ctx) => rate(ctx, ownDelivery(ctx, ctx.params.id), 'driver'));
router.post('/portal/deliveries/:id/report', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => report(ctx, ownDelivery(ctx, ctx.params.id), 'driver'));
router.post('/driver/deliveries/:id/rate', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => rate(ctx, myDelivery(ctx, ctx.params.id).x, 'customer'));
router.post('/driver/deliveries/:id/report', { perm: 'driver.use', needsPharmacy: false }, (ctx) => report(ctx, myDelivery(ctx, ctx.params.id).x, 'customer'));
// Notes : visibles par la pharmacie et le super-administrateur (les notes données aux clients n'apparaissent jamais sur le profil client) ; validation par un administrateur.
const ratingScope = (ctx) => (ctx.user.role === 'super_admin' ? '' : ' AND d.pharmacy_id=' + Number(ctx.ph));
router.get('/delivery-ratings', { perm: 'deliveries.view', needsPharmacy: false }, (ctx) => { if (ctx.user.role !== 'super_admin' && !ctx.ph) throw forbidden('Permission requise'); return all(`SELECT r.id,r.delivery_id,r.target,r.stars,r.comment,r.status,r.created_at,d.number,(SELECT name FROM drivers WHERE id=d.driver_id) driver_name,(SELECT name FROM customers WHERE id=d.customer_id) customer_name FROM delivery_ratings r JOIN deliveries d ON d.id=r.delivery_id WHERE 1=1${ratingScope(ctx)} ORDER BY r.id DESC LIMIT 300`); });
router.put('/delivery-ratings/:id', { perm: 'drivers.admin', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const r = get(`SELECT r.*, d.driver_id FROM delivery_ratings r JOIN deliveries d ON d.id=r.delivery_id WHERE r.id=?${ratingScope(ctx)}`, ctx.params.id); if (!r) throw notFound('Note');
  const st = oneOf(ctx.body.status, 'statut', ['approved', 'rejected'], { required: true }); if (r.status === st) return { ok: true };
  if (r.target === 'driver' && r.driver_id) { if (r.status === 'approved') run('UPDATE drivers SET rating_sum=rating_sum-?, rating_count=rating_count-1 WHERE id=?', r.stars, r.driver_id); if (st === 'approved') run('UPDATE drivers SET rating_sum=rating_sum+?, rating_count=rating_count+1 WHERE id=?', r.stars, r.driver_id); }
  run("UPDATE delivery_ratings SET status=?, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?", st, ctx.user.id, r.id); audit(ctx, 'delivery.rating_' + st, 'delivery', r.delivery_id, undefined, { rating: r.id }); return { ok: true };
}));
router.get('/delivery-reports', { perm: 'deliveries.manage', needsPharmacy: false }, (ctx) => { if (ctx.user.role !== 'super_admin' && !ctx.ph) throw forbidden('Permission requise'); return all("SELECT r.id,r.delivery_id,r.reporter_user_id,r.target,r.reason,r.details,r.status,r.created_at,r.file_name,(r.file IS NOT NULL) has_file,d.number FROM delivery_reports r JOIN deliveries d ON d.id=r.delivery_id WHERE 1=1" + ratingScope(ctx) + " ORDER BY r.id DESC LIMIT 200"); });
router.put('/delivery-reports/:id', { perm: 'deliveries.manage', needsPharmacy: false, ok200: true }, (ctx) => {
  const r = get('SELECT r.id FROM delivery_reports r JOIN deliveries d ON d.id=r.delivery_id WHERE r.id=?' + ratingScope(ctx), ctx.params.id); if (!r) throw notFound('Signalement');
  run('UPDATE delivery_reports SET status=? WHERE id=?', oneOf(ctx.body.status, 'statut', ['open', 'reviewed', 'dismissed'], { required: true }), r.id); return { ok: true };
});
