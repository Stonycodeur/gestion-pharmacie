// Téléphones : stockés au format international (+indicatif + numéro). Si l'utilisateur saisit un numéro local, l'indicatif du pays de l'établissement est ajouté.
import { get, all, run } from './db.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bad } from './util.js';
const DATA = resolve(dirname(fileURLToPath(import.meta.url)), 'data');
const json = (f) => JSON.parse(readFileSync(resolve(DATA, f), 'utf8'));
// Drapeau d'un pays : image téléversée par le super-administrateur, sinon fichier fourni avec l'application (web/assets/flags/xx.png).
export const flagSrc = (iso2, custom) => (custom ? (custom.startsWith('data:') ? custom : `data:image/svg+xml;base64,${Buffer.from(custom).toString('base64')}`) : `/assets/flags/${String(iso2).toLowerCase()}.png`);
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// Pays et villes : insertion par lots (une base distante n'aime pas 1 500 requêtes au démarrage) ; les lignes existantes ne sont jamais modifiées.
export function seedCountries() {
  const list = json('countries.json');
  if (get('SELECT COUNT(*) n FROM countries').n < list.length) {
    for (const part of chunk(list, 60)) run(`INSERT OR IGNORE INTO countries(iso2,name_fr,name_en,name_ar,dial_code,phone_min,phone_max) VALUES ${part.map(() => '(?,?,?,?,?,?,?)').join(',')}`, ...part.flatMap((c) => [c.iso, c.fr, c.en, c.ar, c.dial, c.min, c.max]));
  }
  // anciens drapeaux dessinés à la main (v1) : remplacés par les vrais fichiers de drapeau
  run("UPDATE countries SET flag_svg=NULL WHERE flag_svg LIKE '<svg%' AND LENGTH(flag_svg) < 2000 AND flag_svg LIKE '%width=\"30\" height=\"20\"%'");
  if (!get('SELECT 1 FROM cities LIMIT 1')) {
    const ids = Object.fromEntries(all('SELECT id,iso2 FROM countries').map((c) => [c.iso2, c.id])), rows = [];
    for (const [iso, names] of Object.entries(json('cities.json'))) if (ids[iso]) for (const n of names) rows.push([ids[iso], n]);
    for (const part of chunk(rows, 250)) run(`INSERT OR IGNORE INTO cities(country_id,name) VALUES ${part.map(() => '(?,?)').join(',')}`, ...part.flat());
  }
  run("UPDATE pharmacies SET country_id=(SELECT id FROM countries WHERE iso2='TN') WHERE country_id IS NULL");
}
export const dialOfPharmacy = (ph) => get('SELECT c.dial_code d FROM pharmacies p JOIN countries c ON c.id=p.country_id WHERE p.id=?', ph)?.d || '216';
export function normalizePhone(raw, defaultDial, label = 'téléphone') {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  let s = String(raw).replace(/[\s().-]/g, ''); if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!/^\+?\d+$/.test(s)) throw bad('VALIDATION', `Numéro de ${label} invalide`);
  if (!s.startsWith('+')) s = '+' + defaultDial + s.replace(/^0+/, '');
  const digits = s.slice(1); if (digits.length < 7 || digits.length > 15) throw bad('VALIDATION', `Numéro de ${label} invalide (7 à 15 chiffres avec l'indicatif)`);
  const c = all('SELECT dial_code,phone_min,phone_max FROM countries WHERE active=1').filter((x) => digits.startsWith(x.dial_code)).sort((a, b) => b.dial_code.length - a.dial_code.length)[0];
  if (c) { const n = digits.length - c.dial_code.length; if (n < c.phone_min || n > c.phone_max) throw bad('VALIDATION', `Numéro de ${label} invalide pour +${c.dial_code} (${c.phone_min === c.phone_max ? c.phone_min : c.phone_min + ' à ' + c.phone_max} chiffres après l'indicatif)`); }
  return '+' + digits;
}
export const phoneFor = (ctx, raw, label) => normalizePhone(raw, dialOfPharmacy(ctx.ph ?? ctx.user?.pharmacy_id ?? 0), label);
