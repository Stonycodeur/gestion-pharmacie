// Dispatch des courses : courses proposées aux chauffeurs, acceptation au prix du tarif ou contre-proposition, choix du chauffeur par le client,
// « produit récupéré » (départ), affectations multi-pharmacies, profil du chauffeur (photo, pièce d'identité), configuration de la carte.
import { router, audit, notify, publish, can } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { bad, conflict, notFound, forbidden, str, int, oneOf } from '../util.js';
import { haversineKm } from './discover.js';
import { dlvConfig, negotiationRange, MODES } from '../delivery_config.js';
import { AFF, isAffiliated, driverPharmacies, standardFee, photoUrl, notifySupers, applyAffiliations, setAvailability } from './drivers.js';
import { savePublicImage, dropPublic, savePrivate, readPrivate, mimeOfName } from '../files.js';

const OWNC = '(SELECT id FROM customers WHERE user_id=?)';
const meDriver = (ctx) => { const d = get("SELECT * FROM drivers WHERE user_id=? AND status='active'", ctx.user.id); if (!d) throw notFound('Profil chauffeur'); return d; };
const fmtMoney = (ph, n) => `${(n / 10 ** ph.currency_decimals).toFixed(ph.currency_decimals)} ${ph.currency}`;
const custUser = (x) => get('SELECT user_id FROM customers WHERE id=?', x.customer_id)?.user_id;
const evt = (x, status, note, uid, d) => insert('INSERT INTO delivery_events(delivery_id,status,note,user_id,driver_name,driver_matricule) VALUES (?,?,?,?,?,?)', x.id, status, note, uid, d?.name ?? null, d?.matricule ?? null);
const push = (x) => { const cu = custUser(x); publish(x.pharmacy_id, 'delivery', { id: x.id, status: x.status }, cu); publish(x.pharmacy_id, 'delivery', { id: x.id, status: x.status }); };

// ---------- configuration de la carte (clé Google Maps : publique par nature, à restreindre par domaine côté Google) ----------
const TILES = process.env.OSM_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
router.get('/maps/config', { public: true, needsPharmacy: false }, () => ({ key: process.env.GOOGLE_MAPS_API_KEY || null, provider: process.env.GOOGLE_MAPS_API_KEY ? 'google' : 'osm', tiles: TILES }));
// Proxys OpenStreetMap (recherche d'adresse Nominatim, itinéraire OSRM) : en-tête d'identification exigé par leurs conditions d'usage, cache et limitation de débit.
const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org', OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const UA = `GestionPharmacie/1.0 (${process.env.APP_URL || 'pharmacie'}${process.env.MAPS_CONTACT_EMAIL ? '; ' + process.env.MAPS_CONTACT_EMAIL : ''})`;
const mcache = new Map(); let lastNom = 0; const lastUser = new Map();
const ratelimit = (uid, ms) => { const n = Date.now(); if (n - (lastUser.get(uid) || 0) < ms) throw conflict('RATE', 'Trop de recherches, patientez un instant'); lastUser.set(uid, n); if (lastUser.size > 2000) lastUser.clear(); };
async function cached(key, ttl, fn) { const c = mcache.get(key); if (c && c.t > Date.now()) return c.v; const v = await fn(); mcache.set(key, { v, t: Date.now() + ttl }); if (mcache.size > 500) mcache.delete(mcache.keys().next().value); return v; }
async function upstream(url) { const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'fr', accept: 'application/json' }, signal: AbortSignal.timeout(9000) }); if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: 502 }); return r.json(); }
const nominatim = async (path) => { const wait = 1100 - (Date.now() - lastNom); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); lastNom = Date.now(); return upstream(NOMINATIM + path); };
const coord = (v, name, lim) => { const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > lim) throw bad('VALIDATION', name + ' invalide'); return n; };
router.get('/maps/search', { needsPharmacy: false }, async (ctx) => {
  const q = str(ctx.query.q, 'recherche', { required: true, max: 120 }); if (q.length < 3) return { data: [] }; ratelimit('s' + ctx.user.id, 700);
  try { const near = ctx.query.lat && ctx.query.lng ? `&viewbox=${coord(ctx.query.lng, 'lng', 180) - 0.6},${coord(ctx.query.lat, 'lat', 90) + 0.6},${Number(ctx.query.lng) + 0.6},${Number(ctx.query.lat) - 0.6}` : '';
    const r = await cached('s:' + q.toLowerCase() + near, 6 * 3600e3, () => nominatim(`/search?format=jsonv2&limit=6&addressdetails=0&q=${encodeURIComponent(q)}${near}`));
    return { data: r.map((x) => ({ lat: Number(x.lat), lng: Number(x.lon), label: String(x.display_name).slice(0, 200) })) }; } catch { throw bad('MAPS_UNAVAILABLE', 'Recherche d\'adresse indisponible pour le moment'); }
});
router.get('/maps/reverse', { needsPharmacy: false }, async (ctx) => {
  const la = coord(ctx.query.lat, 'lat', 90), ln = coord(ctx.query.lng, 'lng', 180); ratelimit('r' + ctx.user.id, 700);
  try { const r = await cached(`r:${la.toFixed(4)},${ln.toFixed(4)}`, 24 * 3600e3, () => nominatim(`/reverse?format=jsonv2&zoom=18&lat=${la}&lon=${ln}`)); return { label: r.display_name ? String(r.display_name).slice(0, 200) : null }; } catch { return { label: null }; }
});
router.get('/maps/route', { needsPharmacy: false }, async (ctx) => { // itinéraire routier réel (suite de points « lat,lng » séparés par « ; », 2 à 4 points)
  const pts = String(ctx.query.pts || '').split(';').map((s) => s.split(',').map(Number)); if (pts.length < 2 || pts.length > 4 || pts.some((p) => p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180)) throw bad('VALIDATION', 'Points invalides');
  ratelimit('o' + ctx.user.id, 400); const key = 'o:' + pts.map((p) => p.map((v) => v.toFixed(4)).join(',')).join(';');
  try { const r = await cached(key, 60e3, () => upstream(`${OSRM}/route/v1/driving/${pts.map((p) => `${p[1]},${p[0]}`).join(';')}?overview=full&geometries=geojson&steps=false`)); const rt = r.routes?.[0]; if (!rt) throw new Error('none');
    const g = rt.geometry.coordinates, step = Math.max(1, Math.floor(g.length / 600)); return { coords: g.filter((_, i) => i % step === 0 || i === g.length - 1).map(([lng, lat]) => ({ lat, lng })), distance_m: Math.round(rt.distance), duration_s: Math.round(rt.duration) }; } catch { throw bad('MAPS_UNAVAILABLE', 'Itinéraire indisponible pour le moment'); }
});

// ---------- courses proposées (chauffeur) ----------
router.get('/driver/offers', { perm: 'driver.use', needsPharmacy: false }, (ctx) => {
  const d = meDriver(ctx), hidden = ctx.query.hidden === '1'; if (d.availability === 'offline' && !hidden) return { available: false, data: [] };
  const rows = all(`SELECT x.*, p.name pharmacy_name, p.address pharmacy_address, p.lat pharmacy_lat, p.lng pharmacy_lng, p.currency, p.currency_decimals
    FROM deliveries x JOIN pharmacies p ON p.id=x.pharmacy_id
    WHERE x.driver_id IS NULL AND x.offer_mode='open' AND x.status IN ('issued','received')
      AND (x.pharmacy_id=? OR x.pharmacy_id IN (SELECT pharmacy_id FROM driver_pharmacies WHERE driver_id=?))
      AND ${hidden ? '' : 'NOT '}EXISTS (SELECT 1 FROM delivery_offers o WHERE o.delivery_id=x.id AND o.driver_id=? AND o.status='withdrawn')
    ORDER BY x.id DESC LIMIT 50`, d.pharmacy_id, d.id, d.id);
  const deps = driverPharmacies(d);
  return { available: true, data: rows.map((x) => {
    const std = modeStd(x, d, { lat: x.pharmacy_lat, lng: x.pharmacy_lng }), dep = deps.find((q) => q.id === x.pharmacy_id), from = d.lat != null ? { lat: d.lat, lng: d.lng } : dep?.depart_lat != null ? { lat: dep.depart_lat, lng: dep.depart_lng } : null;
    const toPh = from && x.pharmacy_lat != null ? Math.round(haversineKm(from.lat, from.lng, x.pharmacy_lat, x.pharmacy_lng) * 1300) : null;
    const mine = get('SELECT kind,price,status FROM delivery_offers WHERE delivery_id=? AND driver_id=?', x.id, d.id);
    return { id: x.id, number: x.number, address: x.address, notes: x.notes, created_at: x.created_at, pharmacy_id: x.pharmacy_id, pharmacy_name: x.pharmacy_name, pharmacy_address: x.pharmacy_address, pharmacy_lat: x.pharmacy_lat, pharmacy_lng: x.pharmacy_lng,
      mode: x.mode, mode_label: MODES[x.mode]?.label, scheduled_at: x.scheduled_at, customer_name: get('SELECT name FROM customers WHERE id=?', x.customer_id)?.name, dest_lat: x.dest_lat, dest_lng: x.dest_lng, distance_m: std.distance_m, pickup_distance_m: toPh, price: std.fee, currency: x.currency, decimals: x.currency_decimals, my_offer: mine || null };
  }) };
});
// Tarif de la course : celui du mode choisi par le client (réglé par l'administration) ; à défaut, ancien tarif du chauffeur.
const modeStd = (x, d, ph) => (x.standard_fee > 0 ? { fee: x.standard_fee, distance_m: x.distance_m } : standardFee(d, ph, x.dest_lat, x.dest_lng));
// Accepter au prix du tarif (affectation immédiate, premier arrivé premier servi) ou proposer un autre prix (alertes).
router.post('/driver/offers/:id/accept', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const d = meDriver(ctx); const x = get("SELECT * FROM deliveries WHERE id=? AND offer_mode='open' AND status IN ('issued','received')", ctx.params.id); if (!x) throw notFound('Course');
  if (!isAffiliated(d, x.pharmacy_id)) throw forbidden('Vous n\'êtes pas affecté à cette pharmacie'); if (d.availability !== 'available' && !(d.availability === 'busy' && x.mode === 'economy')) throw conflict('NOT_AVAILABLE', x.mode === 'economy' ? 'Passez en « Disponible » ou « Occupé » pour accepter cette course économique' : 'Passez en « Disponible » pour accepter une course');
  if (x.driver_id) throw conflict('TAKEN', 'Cette course vient d\'être prise par un autre chauffeur');
  if (get("SELECT 1 FROM delivery_offers WHERE delivery_id=? AND driver_id=? AND status='rejected'", x.id, d.id)) throw conflict('REFUSED', 'Le client a refusé votre proposition pour cette course');
  const ph = get('SELECT id,name,lat,lng,currency,currency_decimals FROM pharmacies WHERE id=?', x.pharmacy_id), std = modeStd(x, d, ph), cu = custUser(x);
  let asked = std.fee; if (!(ctx.body.price === undefined || ctx.body.price === null || ctx.body.price === '')) { asked = int(ctx.body.price, 'prix', { required: true, min: 0, max: 1e12 }); if (asked !== std.fee) { const cfg = dlvConfig(x.pharmacy_id); if (!cfg.negotiation) throw forbidden('La négociation du prix est désactivée : acceptez le tarif affiché'); const r = negotiationRange(cfg, std.fee); if (asked < r.min || asked > r.max) throw bad('PRICE_RANGE', `Le prix proposé doit rester entre ${fmtMoney(ph, r.min)} et ${fmtMoney(ph, r.max)} (marge autorisée : ${cfg.margin_pct} %)`); } }
  if (asked !== std.fee) { // contre-proposition : le client (ou la pharmacie) choisit ; alertes pharmacie, administrateur et super-administrateurs
    run("INSERT INTO delivery_offers(delivery_id,driver_id,kind,price,standard_price,distance_m,status) VALUES (?,?,'counter',?,?,?,'pending') ON CONFLICT(delivery_id,driver_id) DO UPDATE SET kind='counter', price=excluded.price, standard_price=excluded.standard_price, status='pending', updated_at=datetime('now')", x.id, d.id, asked, std.fee, std.distance_m);
    const t = `⚠ Prix modifié par ${d.name} : ${fmtMoney(ph, asked)} au lieu de ${fmtMoney(ph, std.fee)} — ${x.number}`;
    notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: t, link: `#/deliveries?id=${x.id}` }); notifySupers({ pharmacyId: x.pharmacy_id, title: t, body: `Chauffeur ${d.name} (${d.matricule})` });
    if (cu) notify({ pharmacyId: x.pharmacy_id, userId: cu, kind: 'delivery', title: `${d.name} propose ${fmtMoney(ph, asked)} pour votre livraison ${x.number}`, body: `Tarif standard : ${fmtMoney(ph, std.fee)}. Choisissez un chauffeur dans « Livraisons ».`, link: `#/portal?tab=deliveries&id=${x.id}` });
    audit({ ...ctx, ph: x.pharmacy_id }, 'driver.price_counter', 'delivery', x.id, { price: std.fee }, { price: asked }); push(x); return { ok: true, counter: true, price: asked };
  }
  const n = run("UPDATE deliveries SET driver_id=?, driver_response='accepted', accepted_at=datetime('now'), fee=?, standard_fee=?, distance_m=COALESCE(?,distance_m), updated_at=datetime('now') WHERE id=? AND driver_id IS NULL", d.id, std.fee, std.fee, std.distance_m, x.id);
  if (!n.changes) throw conflict('TAKEN', 'Cette course vient d\'être prise par un autre chauffeur');
  run("INSERT INTO delivery_offers(delivery_id,driver_id,kind,price,standard_price,distance_m,status) VALUES (?,?,'standard',?,?,?,'chosen') ON CONFLICT(delivery_id,driver_id) DO UPDATE SET kind='standard', price=excluded.price, status='chosen', updated_at=datetime('now')", x.id, d.id, std.fee, std.fee, std.distance_m);
  run("UPDATE delivery_offers SET status='rejected' WHERE delivery_id=? AND driver_id<>? AND status='pending'", x.id, d.id); evt(x, x.status, `Course acceptée par ${d.name} — ${fmtMoney(ph, std.fee)}`, ctx.user.id, d);
  notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Course ${x.number} acceptée par ${d.name} (${fmtMoney(ph, std.fee)})`, body: 'Vous pouvez lancer la livraison.', link: `#/deliveries?id=${x.id}` });
  if (cu) notify({ pharmacyId: x.pharmacy_id, userId: cu, kind: 'delivery', title: `${d.name} a accepté votre livraison ${x.number}`, body: `Prix : ${fmtMoney(ph, std.fee)}`, link: `#/portal?tab=deliveries&id=${x.id}` });
  audit({ ...ctx, ph: x.pharmacy_id }, 'driver.accept', 'delivery', x.id, undefined, { price: std.fee }); push(x); return { ok: true, assigned: true, price: std.fee };
}));
router.post('/driver/offers/:id/decline', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => { // masque la course pour ce chauffeur
  const d = meDriver(ctx); const x = get("SELECT * FROM deliveries WHERE id=? AND offer_mode='open' AND driver_id IS NULL", ctx.params.id); if (!x || !isAffiliated(d, x.pharmacy_id)) throw notFound('Course');
  run("INSERT INTO delivery_offers(delivery_id,driver_id,kind,price,standard_price,status) VALUES (?,?,'standard',0,0,'withdrawn') ON CONFLICT(delivery_id,driver_id) DO UPDATE SET status='withdrawn', updated_at=datetime('now')", x.id, d.id); return { ok: true };
});

router.post('/driver/offers/:id/unhide', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => { // le chauffeur ré-affiche une course qu'il avait masquée
  const d = meDriver(ctx); const x = get("SELECT * FROM deliveries WHERE id=? AND offer_mode='open' AND driver_id IS NULL", ctx.params.id); if (!x || !isAffiliated(d, x.pharmacy_id)) throw notFound('Course');
  const o = get("SELECT * FROM delivery_offers WHERE delivery_id=? AND driver_id=? AND status='withdrawn'", x.id, d.id); if (!o) throw notFound('Course masquée');
  if (Number(o.price) > 0) run("UPDATE delivery_offers SET status='pending', updated_at=datetime('now') WHERE id=?", o.id); else run('DELETE FROM delivery_offers WHERE id=?', o.id); return { ok: true };
});

// ---------- « produit récupéré » : le chauffeur enclenche le départ si la pharmacie ne l'a pas encore fait ----------
router.post('/driver/deliveries/:id/pickup', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const d = meDriver(ctx); const x = get('SELECT * FROM deliveries WHERE id=? AND driver_id=?', ctx.params.id, d.id); if (!x) throw notFound('Course');
  if (x.driver_response !== 'accepted') throw conflict('BAD_STATE', 'Acceptez d\'abord la course (et son prix)'); if (!['issued', 'received', 'in_progress'].includes(x.status)) throw conflict('BAD_STATE', 'Course terminée ou annulée'); if (x.picked_up_at) return { ok: true, already: true };
  const wasLaunched = x.status === 'in_progress', cu = custUser(x);
  run("UPDATE deliveries SET picked_up_at=datetime('now'), status='in_progress', updated_at=datetime('now') WHERE id=?", x.id); setAvailability(d.id, 'busy');
  evt(x, 'in_progress', wasLaunched ? 'Produit récupéré par le chauffeur' : 'Produit récupéré — départ enclenché par le chauffeur', ctx.user.id, d);
  const title = `Votre livraison ${x.number} est en route — chauffeur ${d.name} (matricule ${d.matricule}${d.plate ? ', ' + d.plate : ''})`;
  if (cu) notify({ pharmacyId: x.pharmacy_id, userId: cu, kind: 'delivery', title, body: 'Suivez le trajet en direct, écrivez ou appelez le chauffeur.', link: `#/portal?tab=deliveries&id=${x.id}` });
  if (!wasLaunched) notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `${d.name} a récupéré le produit — départ ${x.number}`, link: `#/deliveries?id=${x.id}` });
  audit({ ...ctx, ph: x.pharmacy_id }, 'driver.pickup', 'delivery', x.id, undefined, { launched_by_driver: !wasLaunched }); push({ ...x, status: 'in_progress' }); return { ok: true, started: true };
}));

// ---------- offres et choix du chauffeur (client) ----------
const ownDelivery = (ctx, id) => { const x = get(`SELECT * FROM deliveries WHERE id=? AND customer_id IN ${OWNC}`, id, ctx.user.id); if (!x) throw notFound('Livraison'); return x; };
const pubOffer = (o, d, ph) => ({ id: o.id, driver_id: d.id, driver: { name: d.name, photo_url: photoUrl(d), vehicle_type: d.vehicle_type, vehicle: d.vehicle, plate: d.plate, rating: d.rating_count ? Math.round((d.rating_sum / d.rating_count) * 10) / 10 : null, rating_count: d.rating_count }, kind: o.kind, price: o.price, standard_price: o.standard_price, status: o.status, currency: ph.currency, decimals: ph.currency_decimals });
router.get('/portal/deliveries/:id/offers', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => {
  const x = ownDelivery(ctx, ctx.params.id), ph = get('SELECT id,name,lat,lng,currency,currency_decimals FROM pharmacies WHERE id=?', x.pharmacy_id);
  const offers = all("SELECT o.*, d.name,d.photo_file,d.vehicle_type,d.vehicle,d.plate,d.rating_sum,d.rating_count,d.id did FROM delivery_offers o JOIN drivers d ON d.id=o.driver_id WHERE o.delivery_id=? AND o.status IN ('pending','chosen') ORDER BY o.price", x.id).map((o) => pubOffer(o, { ...o, id: o.did }, ph));
  const free = all("SELECT d.* FROM drivers d WHERE " + AFF + " AND d.status='active' AND d.availability='available'", x.pharmacy_id, x.pharmacy_id).filter((d) => !offers.some((o) => o.driver_id === d.id) && !get("SELECT 1 FROM delivery_offers WHERE delivery_id=? AND driver_id=? AND status IN ('withdrawn','rejected')", x.id, d.id)).map((d) => ({ driver_id: d.id, driver: { name: d.name, photo_url: photoUrl(d), vehicle_type: d.vehicle_type, plate: d.plate, rating: d.rating_count ? Math.round((d.rating_sum / d.rating_count) * 10) / 10 : null, rating_count: d.rating_count }, price: standardFee(d, ph, x.dest_lat, x.dest_lng).fee, currency: ph.currency, decimals: ph.currency_decimals }));
  return { delivery: { id: x.id, status: x.status, offer_mode: x.offer_mode, fee: x.fee, driver_id: x.driver_id, driver_response: x.driver_response }, offers, available: free };
});
router.post('/portal/deliveries/:id/choose', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const x = ownDelivery(ctx, ctx.params.id); if (!['issued', 'received'].includes(x.status)) throw conflict('BAD_STATE', 'Le chauffeur ne peut plus être changé');
  const d = get("SELECT d.* FROM drivers d WHERE d.id=? AND d.status='active' AND (d.pharmacy_id=? OR d.id IN (SELECT driver_id FROM driver_pharmacies WHERE pharmacy_id=?))", int(ctx.body.driver_id, 'chauffeur', { required: true }), x.pharmacy_id, x.pharmacy_id); if (!d) throw bad('VALIDATION', 'Chauffeur introuvable');
  const ph = get('SELECT id,name,lat,lng,currency,currency_decimals FROM pharmacies WHERE id=?', x.pharmacy_id), offer = get("SELECT * FROM delivery_offers WHERE delivery_id=? AND driver_id=? AND status IN ('pending','chosen')", x.id, d.id);
  if (!offer && d.availability !== 'available') throw conflict('NOT_AVAILABLE', 'Ce chauffeur n\'est plus disponible');
  const price = offer ? offer.price : modeStd(x, d, ph).fee, agreed = !!offer; // une offre = le chauffeur a déjà donné son accord à ce prix
  run("UPDATE deliveries SET driver_id=?, fee=?, standard_fee=?, driver_response=?, accepted_at=CASE WHEN ? THEN datetime('now') ELSE NULL END, updated_at=datetime('now') WHERE id=?", d.id, price, offer ? offer.standard_price : price, agreed ? 'accepted' : 'pending', agreed ? 1 : 0, x.id);
  if (offer) { run("UPDATE delivery_offers SET status='chosen', updated_at=datetime('now') WHERE id=?", offer.id); run("UPDATE delivery_offers SET status='rejected' WHERE delivery_id=? AND id<>? AND status='pending'", x.id, offer.id); }
  evt(x, x.status, `Le client a choisi ${d.name} (${fmtMoney(ph, price)})`, ctx.user.id, d);
  if (d.user_id) notify({ pharmacyId: x.pharmacy_id, userId: d.user_id, kind: 'delivery', title: agreed ? `Le client a retenu votre offre — ${x.number}` : `Nouvelle course ${x.number}`, body: `${x.address} — ${fmtMoney(ph, price)}`, link: `#/driver?id=${x.id}` });
  notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Chauffeur ${d.name} choisi pour ${x.number} (${fmtMoney(ph, price)})`, link: `#/deliveries?id=${x.id}` });
  audit({ ...ctx, ph: x.pharmacy_id }, 'delivery.choose_driver', 'delivery', x.id, undefined, { driver: d.id, price }); push({ ...x, driver_id: d.id }); return { ok: true, price, agreed };
}));
router.post('/portal/deliveries/:id/offers/:oid/refuse', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const x = ownDelivery(ctx, ctx.params.id); const o = get("SELECT o.*, d.user_id duid, d.name dname FROM delivery_offers o JOIN drivers d ON d.id=o.driver_id WHERE o.id=? AND o.delivery_id=? AND o.status='pending'", ctx.params.oid, x.id); if (!o) throw notFound('Offre');
  const ph = get('SELECT currency,currency_decimals FROM pharmacies WHERE id=?', x.pharmacy_id); run("UPDATE delivery_offers SET status='rejected', updated_at=datetime('now') WHERE id=?", o.id); evt(x, x.status, `Le client a refusé le prix proposé par ${o.dname} (${fmtMoney(ph, o.price)})`, ctx.user.id);
  if (o.duid) notify({ pharmacyId: x.pharmacy_id, userId: o.duid, kind: 'delivery', title: `Prix refusé — ${x.number}`, body: `Le client a refusé ${fmtMoney(ph, o.price)}.`, link: `#/driver?id=${x.id}` });
  notify({ pharmacyId: x.pharmacy_id, audience: 'staff', kind: 'delivery', title: `Le client a refusé le prix de ${o.dname} — ${x.number}`, link: `#/deliveries?id=${x.id}` }); audit({ ...ctx, ph: x.pharmacy_id }, 'delivery.offer_refused', 'delivery', x.id, undefined, { offer: o.id }); return { ok: true };
}));
router.get('/deliveries/:id/offers', { perm: 'deliveries.view' }, (ctx) => { // vue pharmacie (lecture seule)
  const x = get('SELECT * FROM deliveries WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!x) throw notFound('Livraison'); const ph = get('SELECT currency,currency_decimals FROM pharmacies WHERE id=?', x.pharmacy_id);
  return all("SELECT o.*, d.name,d.photo_file,d.vehicle_type,d.vehicle,d.plate,d.rating_sum,d.rating_count,d.id did FROM delivery_offers o JOIN drivers d ON d.id=o.driver_id WHERE o.delivery_id=? ORDER BY o.id", x.id).map((o) => pubOffer(o, { ...o, id: o.did }, ph));
});

// ---------- affectations multi-pharmacies ----------
router.put('/drivers/:id/pharmacies', { perm: 'drivers.admin', ok200: true }, (ctx) => tx(() => {
  const d = ctx.user.role === 'super_admin' ? get('SELECT * FROM drivers WHERE id=?', ctx.params.id) : get('SELECT d.* FROM drivers d WHERE d.id=? AND ' + AFF, ctx.params.id, ctx.ph, ctx.ph); if (!d) throw notFound('Chauffeur');
  applyAffiliations(ctx, d.id, ctx.body.pharmacies, { replace: true }); audit(ctx, 'driver.affiliations', 'driver', d.id, undefined, { pharmacies: (ctx.body.pharmacies || []).map((p) => p.pharmacy_id) }); return { ok: true, pharmacies: driverPharmacies(get('SELECT * FROM drivers WHERE id=?', d.id)) };
}));

// ---------- photo de profil et pièce d'identité ----------
function saveProfile(d, ctx, kind) {
  if (kind === 'photo') { const name = savePublicImage(ctx.body.file, 1024 * 1024); const old = d.photo_file; run('UPDATE drivers SET photo_file=? WHERE id=?', name, d.id); if (old) dropPublic(old); return { photo_url: photoUrl({ photo_file: name }) }; }
  const f = savePrivate(ctx.body.file, 5 * 1024 * 1024); run('UPDATE drivers SET id_doc_file=?, id_doc_type=?, id_doc_number=? WHERE id=?', f.path, oneOf(ctx.body.type || 'cni', 'type de pièce', ['cni', 'passport', 'permis', 'autre']), str(ctx.body.number, 'numéro', { max: 40 }) || null, d.id); return { ok: true };
}
router.put('/driver/me/photo', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => { const d = meDriver(ctx); audit({ ...ctx, ph: d.pharmacy_id }, 'driver.photo', 'driver', d.id); return saveProfile(d, ctx, 'photo'); });
router.put('/driver/me/id-doc', { perm: 'driver.use', needsPharmacy: false, ok200: true }, (ctx) => { const d = meDriver(ctx); audit({ ...ctx, ph: d.pharmacy_id }, 'driver.id_doc', 'driver', d.id); return saveProfile(d, ctx, 'id'); });
const adminDriver = (ctx) => { const d = ctx.user.role === 'super_admin' ? get('SELECT * FROM drivers WHERE id=?', ctx.params.id) : get('SELECT d.* FROM drivers d WHERE d.id=? AND ' + AFF, ctx.params.id, ctx.ph, ctx.ph); if (!d) throw notFound('Chauffeur'); return d; };
router.put('/drivers/:id/photo', { perm: 'drivers.admin', ok200: true }, (ctx) => { const d = adminDriver(ctx); audit(ctx, 'driver.photo', 'driver', d.id); return saveProfile(d, ctx, 'photo'); });
router.put('/drivers/:id/id-doc', { perm: 'drivers.admin', ok200: true }, (ctx) => { const d = adminDriver(ctx); audit(ctx, 'driver.id_doc', 'driver', d.id); return saveProfile(d, ctx, 'id'); });
router.get('/drivers/:id/id-doc', { perm: 'drivers.admin' }, (ctx) => { // pièce d'identité : administrateur et super-administrateur uniquement, consultation journalisée
  const d = adminDriver(ctx); if (!d.id_doc_file) throw notFound('Pièce d\'identité'); const buf = readPrivate(d.id_doc_file); if (!buf) throw notFound('Pièce d\'identité'); audit(ctx, 'driver.id_doc_view', 'driver', d.id);
  ctx.res.writeHead(200, { 'Content-Type': mimeOfName(d.id_doc_file), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); ctx.res.end(buf);
});
router.get('/driver/me/id-doc', { perm: 'driver.use', needsPharmacy: false }, (ctx) => { const d = meDriver(ctx); if (!d.id_doc_file) throw notFound('Pièce d\'identité'); const buf = readPrivate(d.id_doc_file); if (!buf) throw notFound('Pièce d\'identité'); ctx.res.writeHead(200, { 'Content-Type': mimeOfName(d.id_doc_file), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); ctx.res.end(buf); });
