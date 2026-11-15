// Pays, indicatifs et drapeaux — gérés par le super-administrateur ; liste publique pour les champs téléphone.
import { router, audit } from '../http.js';
import { get, all, run, insert } from '../db.js';
import { bad, conflict, notFound, str, int } from '../util.js';
import { flagSrc } from '../phone.js';

const view = (c) => ({ id: c.id, iso2: c.iso2, name_fr: c.name_fr, name_en: c.name_en, name_ar: c.name_ar, dial_code: c.dial_code, phone_min: c.phone_min, phone_max: c.phone_max, currencies: String(c.currencies || '').split(',').filter(Boolean), active: c.active, flag: flagSrc(c.iso2, c.flag_svg), custom_flag: !!c.flag_svg });
// Un drapeau est une image inerte (affichée via <img>) : SVG assaini ou PNG/JPEG/WebP en data URI, taille bornée.
export function cleanFlag(v) {
  if (v === null || v === '') return null; const s = String(v).trim();
  if (/^data:image\/svg\+xml;base64,/.test(s)) return cleanFlag(Buffer.from(s.split(',')[1], 'base64').toString('utf8'));
  if (s.startsWith('data:image/')) { if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s) || s.length > 60000) throw bad('VALIDATION', 'Image de drapeau invalide (PNG/JPEG/WebP, 40 Ko max)'); return s; }
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s) || s.length > 30000) throw bad('VALIDATION', 'Drapeau SVG invalide (30 Ko max)');
  if (/<script|<foreignObject|<iframe|<object|<embed|<style|\son\w+\s*=|javascript:|data:text|(?:xlink:)?href\s*=\s*["']?(?!#)/i.test(s)) throw bad('VALIDATION', 'Ce SVG contient des éléments interdits (scripts, liens externes…)');
  return s;
}
router.get('/countries', { public: true }, (ctx) => { const all_ = ctx.query.all === '1'; const wp = ctx.query.with_pharmacy === '1' ? " AND EXISTS (SELECT 1 FROM pharmacies p WHERE p.country_id=countries.id AND p.status='active' AND p.public_listed=1)" : ''; return all(`SELECT * FROM countries WHERE ${all_ ? '1=1' : 'active=1'}${wp} ORDER BY name_fr`).map(view); });
const input = (b, old = {}) => ({
  iso2: old.iso2 || String(b.iso2 || '').toUpperCase().trim(), name_fr: str(b.name_fr ?? old.name_fr, 'nom', { required: true, max: 80 }), name_en: str(b.name_en || old.name_en || b.name_fr, 'nom anglais', { required: true, max: 80 }), name_ar: str(b.name_ar ?? old.name_ar ?? '', 'nom arabe', { max: 80 }),
  dial_code: String(b.dial_code ?? old.dial_code ?? '').replace(/^\+/, '').trim(), phone_min: int(b.phone_min ?? old.phone_min ?? 6, 'longueur min', { min: 3, max: 15 }), phone_max: int(b.phone_max ?? old.phone_max ?? 12, 'longueur max', { min: 3, max: 15 }),
  currencies: (b.currencies === undefined ? String(old.currencies || '') : (Array.isArray(b.currencies) ? b.currencies.join(',') : String(b.currencies))).toUpperCase().split(/[\s,;]+/).filter((x) => /^[A-Z]{3}$/.test(x)).join(',') || null,
  active: b.active === undefined ? old.active ?? 1 : b.active ? 1 : 0, flag: b.flag === undefined ? old.flag_svg ?? null : cleanFlag(b.flag), // null/'' = revenir au drapeau fourni
});
const check = (v) => { if (!/^[A-Z]{2}$/.test(v.iso2)) throw bad('VALIDATION', 'Code ISO : 2 lettres'); if (!/^[0-9]{1,4}$/.test(v.dial_code)) throw bad('VALIDATION', 'Indicatif : 1 à 4 chiffres'); if (v.phone_min > v.phone_max) throw bad('VALIDATION', 'Longueur minimale > maximale'); };
router.post('/countries', { perm: 'pharmacies.manage', needsPharmacy: false }, (ctx) => { const v = input(ctx.body); check(v); if (get('SELECT 1 FROM countries WHERE iso2=?', v.iso2)) throw conflict('DUPLICATE', 'Ce pays existe déjà'); const id = insert('INSERT INTO countries(iso2,name_fr,name_en,name_ar,dial_code,phone_min,phone_max,active,flag_svg,currencies) VALUES (?,?,?,?,?,?,?,?,?,?)', v.iso2, v.name_fr, v.name_en, v.name_ar, v.dial_code, v.phone_min, v.phone_max, v.active, v.flag, v.currencies); audit(ctx, 'country.create', 'country', id, undefined, { iso2: v.iso2 }); return { id }; });
router.put('/countries/:id', { perm: 'pharmacies.manage', needsPharmacy: false, ok200: true }, (ctx) => { const c = get('SELECT * FROM countries WHERE id=?', ctx.params.id); if (!c) throw notFound('Pays'); const v = input(ctx.body, c); check(v); run('UPDATE countries SET name_fr=?,name_en=?,name_ar=?,dial_code=?,phone_min=?,phone_max=?,active=?,flag_svg=?,currencies=? WHERE id=?', v.name_fr, v.name_en, v.name_ar, v.dial_code, v.phone_min, v.phone_max, v.active, v.flag, v.currencies, c.id); audit(ctx, 'country.update', 'country', c.id, { dial: c.dial_code, active: c.active }, { dial: v.dial_code, active: v.active }); return { ok: true }; });
router.delete('/countries/:id', { perm: 'pharmacies.manage', needsPharmacy: false, ok200: true }, (ctx) => { const c = get('SELECT * FROM countries WHERE id=?', ctx.params.id); if (!c) throw notFound('Pays'); if (get('SELECT 1 FROM pharmacies WHERE country_id=? LIMIT 1', c.id)) throw conflict('IN_USE', 'Des établissements utilisent ce pays : désactivez-le'); run('DELETE FROM countries WHERE id=?', c.id); audit(ctx, 'country.delete', 'country', c.id, { iso2: c.iso2 }); return { ok: true }; });

// ---- Villes ----
router.get('/countries/:id/cities', { public: true }, (ctx) => all('SELECT id,name FROM cities WHERE country_id=? ORDER BY name', ctx.params.id));
router.post('/countries/:id/cities', { perm: 'pharmacies.manage', needsPharmacy: false }, (ctx) => {
  if (!get('SELECT 1 FROM countries WHERE id=?', ctx.params.id)) throw notFound('Pays');
  const name = str(ctx.body.name, 'ville', { required: true, max: 80 }); if (get('SELECT 1 FROM cities WHERE country_id=? AND name=?', ctx.params.id, name)) throw conflict('DUPLICATE', 'Cette ville existe déjà');
  const id = insert('INSERT INTO cities(country_id,name) VALUES (?,?)', ctx.params.id, name); audit(ctx, 'city.create', 'city', id, null, { name }); return { id, name };
});
router.delete('/cities/:id', { perm: 'pharmacies.manage', needsPharmacy: false, ok200: true }, (ctx) => { const c = get('SELECT * FROM cities WHERE id=?', ctx.params.id); if (!c) throw notFound('Ville'); run('DELETE FROM cities WHERE id=?', c.id); audit(ctx, 'city.delete', 'city', c.id, { name: c.name }, null); return { ok: true }; });
