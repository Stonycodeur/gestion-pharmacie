// Découverte côté client : liste des pharmacies (avec drapeau et distance), recherche d'un médicament dans les pharmacies qui l'ont en stock,
// message de réservation modifiable.
import { flagSrc } from '../phone.js';
import { router, audit, notify, publish } from '../http.js';
import { get, all, run } from '../db.js';
import { bad, notFound, forbidden, conflict, str } from '../util.js';
import { fileUrl } from './network.js';
import { isGuest, OWN } from '../portal.js';

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

const AVAIL = "COALESCE((SELECT SUM(s.qty_available - s.qty_reserved) FROM stock_levels s JOIN batches b ON b.id=s.batch_id WHERE s.pharmacy_id=ph.id AND b.product_id=pr.id AND b.status='ok' AND b.exp_date >= date('now')),0)";
// Recherche d'un médicament : uniquement les pharmacies qui l'ont réellement disponible (quantité jamais exposée, seulement le booléen).
router.get('/portal/search', { anyPerm: ['portal.use', 'portal.guest', 'portal.browse'], needsPharmacy: false }, (ctx) => {
  const q = String(ctx.query.q || '').trim(); if (q.length < 2) throw bad('VALIDATION', 'Saisissez au moins 2 caractères');
  const me = here(ctx.query);
  const rows = all(`SELECT pr.id product_id, pr.name, pr.dci, pr.dosage, pr.form, pr.sale_price, pr.rx_status, ph.id pharmacy_id
    FROM products pr JOIN pharmacy_catalog pc ON pc.product_id=pr.id JOIN pharmacies ph ON ph.id=pc.pharmacy_id
    WHERE pr.status='active' AND ph.status='active' AND ph.public_listed=1 AND (pr.name LIKE ? OR pr.dci LIKE ?) AND ${AVAIL} > 0 ORDER BY pr.name LIMIT 600`, `%${q}%`, `%${q}%`);
  const phs = new Map(all(BASE).map((x) => [x.id, phView(x, me)])); const byProd = new Map();
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
  notify({ pharmacyId: o.pharmacy_id, audience: 'staff', kind: 'order', title: `Message client — ${o.number}`, body: notes || '(message supprimé)', link: '#/orders' });
  publish(o.pharmacy_id, 'order', { id: o.id }, null); return { ok: true, notes };
});
router.get('/portal/orders/:id/history', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => {
  if (isGuest(ctx)) throw forbidden('Réservé aux clients avec un compte');
  const o = get(`SELECT id FROM customer_orders WHERE id=? AND customer_id IN ${OWN}`, ctx.params.id, ctx.user.id); if (!o) throw notFound('Réservation');
  return all("SELECT created_at, new_json FROM audit_logs WHERE entity='order' AND entity_id=? AND action='order.message' ORDER BY id", String(o.id)).map((r) => ({ at: r.created_at, notes: JSON.parse(r.new_json || '{}').notes }));
});
