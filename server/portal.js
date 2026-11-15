// Espace client multi-établissements : le client (ou l'invité) choisit la pharmacie active (en-tête x-pharmacy-id) ; une fiche client est créée à la demande dans chaque pharmacie.
import { get, all, insert } from './db.js';
import { HttpError } from './util.js';

export const OWN = '(SELECT id FROM customers WHERE user_id=?)'; // fiches du compte connecté, dans toutes les pharmacies
export const isGuest = (ctx) => ctx.user?.role === 'guest';
// Pays du client : il ne voit que les pharmacies de son pays, sauf autorisation du super-administrateur (« voir toutes les pharmacies »).
export function countryScope(ctx) {
  const u = ctx.user; if (!u || u.see_all_countries || !['customer', 'guest'].includes(u.role)) return null; return u.country_id || null;
}
export function activePharmacy(ctx) {
  const want = parseInt(ctx.req.headers['x-pharmacy-id']), cs = countryScope(ctx), inC = cs ? ' AND country_id=' + Number(cs) : '';
  if (want) { const p = get("SELECT id FROM pharmacies WHERE id=? AND status='active' AND public_listed=1" + inC, want); if (!p) throw new HttpError(404, 'PHARMACY_UNAVAILABLE', 'Cet établissement n\'est pas disponible' + (cs ? ' dans votre pays' : '')); return p.id; }
  const own = ctx.user.pharmacy_id && get("SELECT id FROM pharmacies WHERE id=? AND status='active'" + inC, ctx.user.pharmacy_id)?.id;
  return own || get("SELECT id FROM pharmacies WHERE status='active' AND public_listed=1" + inC + " ORDER BY id LIMIT 1")?.id;
}
export function portalCustomer(ctx) {
  const ph = activePharmacy(ctx); if (!ph) throw new HttpError(404, 'NO_PHARMACY', 'Aucun établissement disponible');
  let c = get('SELECT * FROM customers WHERE user_id=? AND pharmacy_id=?', ctx.user.id, ph);
  if (!c) { const u = get('SELECT name,email,phone FROM users WHERE id=?', ctx.user.id); const id = insert('INSERT INTO customers(pharmacy_id,user_id,name,phone,email) VALUES (?,?,?,?,?)', ph, ctx.user.id, u.name, u.phone, isGuest(ctx) ? null : u.email); c = get('SELECT * FROM customers WHERE id=?', id); }
  if (c.status !== 'active') throw new HttpError(403, 'FORBIDDEN', 'Profil client désactivé');
  ctx.ph = ph; return c;
}
// Invité : pas d'historique — seules les commandes/livraisons EN COURS restent visibles
export const ORDER_ACTIVE = "('pending','confirmed','preparing','ready')";
export const DELIVERY_ACTIVE = "('issued','received','in_progress')";
