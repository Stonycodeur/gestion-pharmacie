// Fuseaux horaires par pays (base IANA, zone.tab) : le fuseau d'une pharmacie se déduit du pays et de sa position, il ne se saisit plus à la main.
import { readFileSync } from 'node:fs';
const DATA = JSON.parse(readFileSync(new URL('./data/timezones.json', import.meta.url), 'utf8')); // { 'TN': [[zone, lat, lng], …] }
export const zonesOf = (iso2) => (DATA[String(iso2 || '').toUpperCase()] || []).map((z) => z[0]);
const km2 = (a, b, c, d) => (a - c) ** 2 + ((b - d) * Math.cos((a * Math.PI) / 180)) ** 2;
// Fuseau le plus proche de la position (pays à plusieurs fuseaux) ; sinon le premier du pays.
export function pickZone(iso2, lat, lng) {
  const zs = DATA[String(iso2 || '').toUpperCase()] || []; if (!zs.length) return null; if (zs.length === 1 || lat == null || lng == null || lat === '' || lng === '') return zs[0][0];
  return zs.reduce((best, z) => (km2(lat, lng, z[1], z[2]) < km2(lat, lng, best[1], best[2]) ? z : best), zs[0])[0];
}
export const validZone = (z) => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };
// Fuseau retenu : celui demandé s'il appartient au pays, sinon celui déduit du pays et de la position.
export function resolveZone(iso2, lat, lng, wanted) {
  const zs = zonesOf(iso2);
  if (wanted && zs.includes(wanted)) return wanted;
  const p = pickZone(iso2, lat, lng); if (p) return p;
  return wanted && validZone(wanted) ? wanted : 'UTC';
}
