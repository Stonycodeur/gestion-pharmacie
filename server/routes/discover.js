// Découverte côté client : liste des pharmacies (avec drapeau et distance), recherche d'un médicament dans les pharmacies qui l'ont en stock,
// message de réservation modifiable.
import { flagSrc } from '../phone.js';
import { router, audit, notify, publish } from '../http.js';
import { get, all, run } from '../db.js';
import { bad, notFound, forbidden, conflict, str } from '../util.js';
import { fileUrl } from './network.js';
import { isGuest, OWN, countryScope } from '../portal.js';

export const haversineKm = (a, b, c, d) => {
  const R = 6371, r = (x) => (x * Math.PI) / 180, dl = r(c - a), dg = r(d - b);
  const x = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x));
};
const coord = (v, lo, hi) => { if (v === undefined || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw bad('VALIDATION', 'Coordonnées invalides'); return n; };
const here = (q) => { const lat = coord(q.lat, -90, 90), lng = coord(q.lng, -180, 180); return lat !== null && lng !== null ? { lat, lng } : null; };
const phView = (p, me) => ({
  id: p.id, name: p.name, city: p.city, address: p.address, phone: p.phone, opening_hours: p.opening_hours, lat: p.lat, lng: p.lng, appointments_enabled: !!p.appointments_enabled,
  logo_url: fileUrl(p.logo_path), country: { iso2: p.iso2, name: p.cname, dial_code: p.dial, flag: flagSrc(p.iso2, p.flag) },
  distance_km: me && p.lat != null && p.lng != null ? Math.round(haversineKm(me.lat, me.lng, p.lat, p.lng) * 10) / 10 : null,
});
const BASE = "SELECT p.*, c.iso2, c.name_fr cname, c.dial_code dial, c.flag_svg flag FROM pharmacies p LEFT JOIN countries c ON c.id=p.country_id WHERE p.status='active' AND p.public_listed=1";
const sortByDist = (a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) || a.name.localeCompare(b.name);

router.get('/public/pharmacies', { public: true, needsPharmacy: false }, (ctx) => {
  const me = here(ctx.query); const w = [], p = [];
  if (ctx.query.country) { w.push('c.iso2=?'); p.push(String(ctx.query.country).toUpperCase().slice(0, 2)); }
  if (ctx.query.q) { w.push('(p.name LIKE ? OR p.city LIKE ?)'); p.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`); }
  const rows = all(BASE + (w.length ? ' AND ' + w.join(' AND ') : '') + ' LIMIT 500', ...p).map((x) => phView(x, me));
  const max = ctx.query.radius_km ? Number(ctx.query.radius_km) : null;
  return rows.filter((r) => !max || (r.distance_km !== null && r.distance_km <= max)).sort(sortByDist);
});

// Liste des pharmacies pour un client connecté : limitée à son pays (sauf autorisation « toutes les pharmacies »).
router.get('/portal/pharmacies', { anyPerm: ['portal.use', 'portal.guest', 'portal.browse'], needsPharmacy: false }, (ctx) => {
  const me = here(ctx.query), cs = countryScope(ctx), w = [], p = [];
  if (cs) { w.push('p.country_id=?'); p.push(cs); } else if (ctx.query.country) { w.push('c.iso2=?'); p.push(String(ctx.query.country).toUpperCase().slice(0, 2)); }
  if (ctx.query.q) { w.push('(p.name LIKE ? OR p.city LIKE ?)'); p.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`); }
  return all(BASE + (w.length ? ' AND ' + w.join(' AND ') : '') + ' LIMIT 500', ...p).map((x) => phView(x, me)).sort(sortByDist);
});

const AVAIL = "COALESCE((SELECT SUM(s.qty_available - s.qty_reserved) FROM stock_levels s JOIN batches b ON b.id=s.batch_id WHERE s.pharmacy_id=ph.id AND b.product_id=pr.id AND b.status='ok' AND b.exp_date >= date('now')),0)";
// Recherche d'un médicament : uniquement les pharmacies qui l'ont réellement disponible (quantité jamais exposée, seulement le booléen).
router.get('/portal/search', { anyPerm: ['portal.use', 'portal.guest', 'portal.browse'], needsPharmacy: false }, (ctx) => {
  const q = String(ctx.query.q || '').trim(); if (q.length < 2) throw bad('VALIDATION', 'Saisissez au moins 2 caractères');
  const me = here(ctx.query);
  // Recherche tolérante : chaque mot saisi doit se retrouver (sans accents ni majuscules) dans le nom, la DCI, le dosage, la forme, le code ou le code-barres.
  // Ainsi « Amoxicilline 500 mg gélules B/12 » est trouvé même si le nom, le dosage et la forme sont enregistrés dans des champs séparés.
  const fold = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const tokens = fold(q).split(/[\s,;]+/).filter(Boolean);
  const rows = all(`SELECT pr.id product_id, pr.name, pr.dci, pr.dosage, pr.form, pr.sale_price, pr.rx_status, pr.sku, pr.barcode, ph.id pharmacy_id
    FROM products pr JOIN pharmacy_catalog pc ON pc.product_id=pr.id JOIN pharmacies ph ON ph.id=pc.pharmacy_id
    WHERE pr.status='active' AND ph.status='active' AND ph.public_listed=1 AND ${AVAIL} > 0 ORDER BY pr.name LIMIT 20000`)
    .filter((r) => { const hay = fold([r.name, r.dci, r.dosage, r.form, r.sku, r.barcode].join(' ')); return tokens.every((t) => hay.includes(t)); });
  const cs = countryScope(ctx); const phs = new Map(all(BASE + (cs ? ' AND p.country_id=' + Number(cs) : '')).map((x) => [x.id, phView(x, me)])); const byProd = new Map();
  for (const r of rows) {
    const e = byProd.get(r.product_id) || { product_id: r.product_id, name: r.name, dci: r.dci, dosage: r.dosage, form: r.form, rx_status: r.rx_status, pharmacies: [] };
    const ph = phs.get(r.pharmacy_id); if (ph) e.pharmacies.push({ ...ph, sale_price: r.sale_price, available: true }); byProd.set(r.product_id, e);
  }
  return [...byProd.values()].slice(0, 30).map((e) => ({ ...e, pharmacies: e.pharmacies.sort(sortByDist) }));
});

// Message de réservation (« Ma réservation ») : modifiable tant que la commande n'est pas prête ; chaque version est conservée au journal.
router.put('/portal/orders/:id/message', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false, ok200: true }, (ctx) => {
  const o = get(`SELECT * FROM customer_orders WHERE id=? AND customer_id IN ${OWN}`, ctx.params.id, ctx.user.id); if (!o) throw notFound('Réservation');
  if (!['pending', 'confirmed', 'preparing'].includes(o.status)) throw conflict('LOCKED', 'Cette réservation ne peut plus être modifiée');
  const notes = str(ctx.body.notes, 'message', { max: 500 }) || null;
  run('UPDATE customer_orders SET notes=? WHERE id=?', notes, o.id);
  audit({ ...ctx, ph: o.pharmacy_id }, 'order.message', 'order', o.id, { notes: o.notes }, { notes });
  notify({ pharmacyId: o.pharmacy_id, audience: 'staff', kind: 'order', title: `Message client — ${o.number}`, body: notes || '(message supprimé)', link: `#/orders?id=${o.id}` });
  publish(o.pharmacy_id, 'order', { id: o.id }, null); return { ok: true, notes };
});
router.get('/portal/orders/:id/history', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => {
  if (isGuest(ctx)) throw forbidden('Réservé aux clients avec un compte');
  const o = get(`SELECT id FROM customer_orders WHERE id=? AND customer_id IN ${OWN}`, ctx.params.id, ctx.user.id); if (!o) throw notFound('Réservation');
  return all("SELECT created_at, new_json FROM audit_logs WHERE entity='order' AND entity_id=? AND action='order.message' ORDER BY id", String(o.id)).map((r) => ({ at: r.created_at, notes: JSON.parse(r.new_json || '{}').notes }));
});

// Historique COMPLET d'une commande : statuts, messages, paiements, livraison (course et étapes), du plus ancien au plus récent.
const OST = { pending: 'En attente', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête', picked_up: 'Retirée', cancelled: 'Annulée', expired: 'Expirée' };
const DST = { issued: 'Livraison demandée', received: 'Course prise en charge', in_progress: 'Livraison en cours', delivered: 'Livrée', failed: 'Livraison échouée', cancelled: 'Livraison annulée' };
const PST = { pending: 'en attente', awaiting_manual: 'en attente de confirmation', paid: 'réussi', failed: 'échoué', cancelled: 'annulé', refunded: 'remboursé', expired: 'expiré' };
router.get('/portal/orders/:id/timeline', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => {
  const o = get(`SELECT o.id,o.number,o.created_at,o.pharmacy_id,p.currency,p.currency_decimals decimals,p.name pharmacy FROM customer_orders o JOIN pharmacies p ON p.id=o.pharmacy_id WHERE o.id=? AND o.customer_id IN ${OWN}`, ctx.params.id, ctx.user.id); if (!o) throw notFound('Commande');
  const ev = [];
  for (const r of all('SELECT from_status,to_status,created_at FROM order_status_history WHERE order_id=? ORDER BY id', o.id)) ev.push({ at: r.created_at, kind: 'status', title: r.from_status ? `Commande ${OST[r.to_status] || r.to_status}`.toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'Commande envoyée à la pharmacie', tone: r.to_status === 'cancelled' || r.to_status === 'expired' ? 'bad' : ['picked_up', 'ready'].includes(r.to_status) ? 'ok' : 'info' });
  if (!ev.length) ev.push({ at: o.created_at, kind: 'status', title: 'Commande envoyée à la pharmacie', tone: 'info' });
  for (const r of all("SELECT created_at, new_json FROM audit_logs WHERE entity='order' AND entity_id=? AND action='order.message' ORDER BY id", String(o.id))) ev.push({ at: r.created_at, kind: 'message', title: 'Message à la pharmacie', detail: JSON.parse(r.new_json || '{}').notes || '(message supprimé)', tone: '' });
  for (const r of all('SELECT amount,status,created_at FROM order_deposits WHERE order_id=? ORDER BY id', o.id)) ev.push({ at: r.created_at, kind: 'payment', title: r.status === 'refunded' ? 'Acompte remboursé' : 'Paiement enregistré', amount: r.amount, tone: r.status === 'refunded' ? 'warn' : 'ok' });
  for (const r of all('SELECT method_code,amount,status,created_at FROM online_payments WHERE order_id=? ORDER BY id', o.id)) if (r.status !== 'paid') ev.push({ at: r.created_at, kind: 'payment', title: `Paiement en ligne (${r.method_code}) ${PST[r.status] || r.status}`, amount: r.amount, tone: ['failed', 'cancelled', 'expired'].includes(r.status) ? 'bad' : 'warn' });
  for (const d of all('SELECT id,number,mode,fee,created_at FROM deliveries WHERE order_id=? ORDER BY id', o.id)) {
    ev.push({ at: d.created_at, kind: 'delivery', title: `Livraison ${d.number} demandée`, detail: d.mode, amount: d.fee, tone: 'info' });
    for (const e of all('SELECT status,note,driver_name,created_at FROM delivery_events WHERE delivery_id=? ORDER BY id', d.id)) ev.push({ at: e.created_at, kind: 'delivery', title: DST[e.status] || e.status, detail: [e.driver_name && `Chauffeur : ${e.driver_name}`, e.note].filter(Boolean).join(' — ') || null, tone: e.status === 'delivered' ? 'ok' : ['failed', 'cancelled'].includes(e.status) ? 'bad' : 'info' });
  }
  ev.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { number: o.number, pharmacy: o.pharmacy, currency: o.currency, decimals: o.decimals, events: ev };
});
