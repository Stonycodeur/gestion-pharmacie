// Client / invité : pharmacies du réseau (les plus proches grâce à la géolocalisation), recherche d'un médicament, choix de la pharmacie.
import { get, state } from '../api.js';
import { h, clear, fail, toast, badge, icon, money, debounce } from '../ui.js';
import { flagImg, locate, fmtKm, stars, directionsLink } from '../net.js';

export const CHOSEN_KEY = 'gp.portal.pharmacy';
export function choosePharmacy(p) { state.phOverride = p?.id || null; try { p ? localStorage.setItem(CHOSEN_KEY, JSON.stringify({ id: p.id, name: p.name })) : localStorage.removeItem(CHOSEN_KEY); } catch {} }
export function chosenPharmacy() { try { return JSON.parse(localStorage.getItem(CHOSEN_KEY) || 'null'); } catch { return null; } }
let here = null;

export function pharmacyCard(p, onChoose, chosenId) {
  return h('div', { class: 'pcard' }, h('img', { class: 'logo', src: p.logo_url || '/assets/icon-192.png', alt: '' }),
    h('div', { class: 'grow' }, h('div', { class: 'row between', style: { flexWrap: 'nowrap' } }, h('strong', {}, p.name), p.distance_km != null ? badge(fmtKm(p.distance_km), 'info') : null),
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap', margin: '2px 0' } }, flagImg(p.country, 20), h('span', { class: 'muted' }, [p.city, p.country?.name].filter(Boolean).join(' · '))),
      p.address ? h('div', { class: 'muted' }, p.address) : null, p.opening_hours ? h('div', { class: 'muted' }, icon('history', { size: 13 }), ' ', p.opening_hours) : null, p.phone ? h('div', {}, h('a', { href: 'tel:' + p.phone }, p.phone)) : null,
      h('div', { class: 'row', style: { marginTop: '8px' } }, p.appointments_enabled ? badge('Rendez-vous médecin', 'ok') : null,
        h('button', { class: 'btn sm primary', onclick: () => onChoose(p) }, icon('check', { size: 14 }), chosenId === p.id ? 'Pharmacie choisie' : 'Choisir cette pharmacie'),
        p.lat != null ? directionsLink(p.lat, p.lng, 'Itinéraire') : null)));
}

export default async function (box, { embedded = false, onChosen } = {}) {
  const out = embedded ? box : h('div'); const status = h('div', { class: 'muted' }), list = h('div', { class: 'pgrid' }), results = h('div');
  const q = h('input', { type: 'search', placeholder: 'Rechercher un médicament (ex. paracétamol)…', 'aria-label': 'Rechercher un médicament', style: { flex: '1 1 240px' } });
  const choose = (p) => { choosePharmacy(p); toast(`Pharmacie choisie : ${p.name}`); if (onChosen) onChosen(p); else location.hash = '#/portal'; };
  const geo = h('button', { class: 'btn primary', type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; status.textContent = 'Recherche de votre position…'; try { here = await locate(); status.textContent = ''; await loadPh(); if (q.value.trim().length >= 2) await search(); } catch (er) { status.textContent = ''; fail(er); } finally { b.disabled = false; } } }, icon('pin', { size: 16 }), 'Pharmacies près de moi');
  async function loadPh() {
    const qs = here ? `?lat=${here.lat}&lng=${here.lng}` : ''; const l = await get('/portal/pharmacies' + qs);
    status.textContent = here ? 'Triées de la plus proche à la plus éloignée, d\'après votre position.' : 'Activez « Pharmacies près de moi » pour les trier par distance.';
    clear(list).append(...(l.length ? l.map((p) => pharmacyCard(p, choose, chosenPharmacy()?.id)) : [h('div', { class: 'empty' }, 'Aucune pharmacie pour le moment')]));
  }
  async function search() {
    const term = q.value.trim(); if (term.length < 2) { clear(results); return; }
    const qs = `?q=${encodeURIComponent(term)}${here ? `&lat=${here.lat}&lng=${here.lng}` : ''}`; const r = await get('/portal/search' + qs);
    clear(results).append(h('h2', {}, `Disponible pour « ${term} »`), ...(r.length ? r.map((e) => h('div', { class: 'card', style: { marginBottom: '10px' } }, h('div', { class: 'row between' }, h('strong', {}, `${e.name} ${e.dosage || ''}`), e.rx_status !== 'free' ? badge('Sur ordonnance', 'warn') : badge('Vente libre', 'ok')), h('div', { class: 'muted' }, [e.dci, e.form].filter(Boolean).join(' · ')),
      h('div', { class: 'pgrid', style: { marginTop: '8px' } }, e.pharmacies.map((p) => h('div', {}, pharmacyCard(p, choose, chosenPharmacy()?.id), h('div', { class: 'muted', style: { padding: '4px 12px' } }, 'Prix : ', h('strong', {}, money(p.sale_price)), ' · ', badge('Disponible', 'ok'))))))) : [h('div', { class: 'empty' }, 'Ce médicament n\'est disponible dans aucune pharmacie du réseau pour le moment.')]));
  }
  q.addEventListener('input', debounce(() => search().catch(fail), 350));
  out.append(h('div', { class: 'card', style: { marginBottom: '14px' } }, h('div', { class: 'row' }, geo, q), status), results, h('h2', { style: { marginTop: '16px' } }, 'Pharmacies du réseau'), list);
  if (!embedded) box.append(h('h1', {}, 'Pharmacies'), out);
  await loadPh().catch(fail);
}
