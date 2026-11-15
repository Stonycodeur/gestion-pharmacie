// Cartes de l'application. Fournisseur choisi automatiquement :
//  • GOOGLE_MAPS_API_KEY renseignée sur le serveur → Google Maps (noms de lieux, Places, Directions) ;
//  • sinon (défaut, sans clé ni carte bancaire) → OpenStreetMap (osm.js) avec recherche Nominatim et itinéraire OSRM via le serveur ;
//  • hors connexion → le schéma SVG de net.js reste affiché.
import { get } from './api.js';
import { h } from './ui.js';
import { osmMap } from './osm.js';
let cfgP = null, loading = null;
const mapsCfg = () => (cfgP ||= get('/maps/config').catch(() => { cfgP = null; return { provider: 'osm', key: null }; }));
export function loadMaps() {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (!navigator.onLine) return Promise.reject(new Error('offline'));
  loading ||= mapsCfg().then((c) => new Promise((res, rej) => {
    if (!c?.key) return rej(new Error('nokey'));
    window.__gmReady = () => res(window.google.maps);
    const s = document.createElement('script'); s.async = true; s.onerror = () => rej(new Error('load'));
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(c.key)}&libraries=places&language=fr&callback=__gmReady&loading=async`; document.head.append(s);
    setTimeout(() => rej(new Error('timeout')), 15000);
  })).catch((e) => { loading = null; throw e; });
  return loading;
}
// 'google' | 'osm' | null (hors connexion)
async function engine() {
  if (!navigator.onLine) return null; const c = await mapsCfg();
  if (c.key) { try { return { name: 'google', g: await loadMaps(), cfg: c }; } catch { /* clé refusée / réseau : repli OpenStreetMap */ } }
  return { name: 'osm', cfg: c };
}
const COL = { pharmacy: '#0f766e', dest: '#dc2626', driver: '#2563eb', me: '#7c3aed' };
const pin = (g, kind) => ({ path: kind === 'driver' || kind === 'me' ? g.SymbolPath.CIRCLE : 'M0,0 C-8,-10 -8,-22 0,-22 C8,-22 8,-10 0,0Z', scale: kind === 'driver' || kind === 'me' ? 9 : 1.4, fillColor: COL[kind] || '#444', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, labelOrigin: new g.Point(0, kind === 'driver' || kind === 'me' ? 2.8 : -2) });
const legend = () => h('div', { class: 'map-legend', style: { display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '.8em', marginTop: '4px' } }, [['pharmacy', 'Pharmacie (départ)'], ['driver', 'Chauffeur'], ['dest', 'Client']].map(([k, t]) => h('span', {}, h('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: COL[k], marginRight: '5px' } }), t)));
// Étapes du trajet : avant la prise du produit, chauffeur → pharmacie puis pharmacie → client ; ensuite chauffeur → client.
function legsOf(pts, stage) {
  const drv = pts.find((p) => p.kind === 'driver' || p.kind === 'me'), dest = pts.find((p) => p.kind === 'dest'), ph = pts.find((p) => p.kind === 'pharmacy');
  if (stage === 'pickup' && drv && ph && dest) return [{ pts: [drv, ph], color: '#2563eb' }, { pts: [ph, dest], color: '#6b7280', dashed: true }];
  if (drv && dest) return [{ pts: [drv, dest], color: '#2563eb' }];
  if (ph && dest) return [{ pts: [ph, dest], color: '#2563eb' }];
  return [];
}
// Remplace le schéma SVG de `box` par la vraie carte ; renvoie vrai si réussi.
export async function upgrade(box, { points = [], path = [], height = 280, stage } = {}) {
  const pts = points.filter((p) => p.lat != null && p.lng != null); if (!pts.length) return false;
  const eng = await engine(); if (!eng) return false;
  const el = h('div', { class: 'gmap', style: { height: height + 'px', width: '100%' } }), svg = box.querySelector('svg'), note = box.querySelector('.map-note'), legs = legsOf(pts, stage);
  box.style.height = 'auto'; if (svg) svg.replaceWith(el); else box.prepend(el);
  if (eng.name === 'google') {
    const g = eng.g, map = new g.Map(el, { center: pts[0], zoom: 14, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, gestureHandling: 'greedy' }), bounds = new g.LatLngBounds();
    for (const p of pts) { new g.Marker({ map, position: p, icon: pin(g, p.kind), title: p.label || '', label: p.label ? { text: p.label, color: '#111', fontSize: '12px', fontWeight: '700', className: 'gm-label' } : undefined }); bounds.extend(p); }
    for (const l of legs) new g.DirectionsService().route({ origin: l.pts[0], destination: l.pts[1], travelMode: 'DRIVING' }, (r, st) => { const line = st === 'OK' ? r.routes[0].overview_path : l.pts; new g.Polyline({ map, path: line, strokeColor: l.color, strokeWeight: 5, strokeOpacity: l.dashed ? 0 : 0.9, icons: l.dashed ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '14px' }] : undefined }); });
    if (!legs.length && path.length > 1) new g.Polyline({ map, path, strokeColor: '#2563eb', strokeWeight: 4 });
    if (pts.length > 1) map.fitBounds(bounds, 48); else map.setZoom(16);
    if (note) note.textContent = 'Carte Google Maps en temps réel.';
  } else {
    const w0 = el.clientWidth, m = osmMap(el, { center: pts[0], zoom: 14, tiles: eng.cfg.tiles });
    for (const p of pts) m.addMarker({ lat: p.lat, lng: p.lng, kind: p.kind, label: p.label });
    m.fitBounds(pts); if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(() => { if (el.clientWidth !== w0 && el.clientWidth > 0) { m.fitBounds(pts); ro.disconnect(); } }); ro.observe(el); setTimeout(() => ro.disconnect(), 4000); }
    for (const l of legs) { const straight = m.addLine(l.pts, { color: l.color, dashed: true, width: 3, opacity: .7 }); // vol d'oiseau en attendant l'itinéraire routier
      get(`/maps/route?pts=${l.pts.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(';')}`).then((r) => { straight.remove(); m.addLine(r.coords, { color: l.color, dashed: !!l.dashed, width: 5 }); }).catch(() => { /* on garde la ligne droite */ }); }
    if (!legs.length && path.length > 1) m.addLine(path, { color: '#2563eb', width: 4 });
    if (note) note.textContent = 'Carte OpenStreetMap : pharmacie (départ), chauffeur et client ; la ligne montre le trajet.';
  }
  if (note) { note.style.position = 'static'; note.style.display = 'block'; note.style.padding = '4px 8px 0'; } const lg = legend(); lg.style.padding = '2px 8px 6px'; box.append(lg); return true;
}
// Sélecteur de lieu : recherche d'adresse, clic ou glissement du repère sur la carte, « ma position », saisie manuelle de repli.
// onChange({lat,lng,label}) ; renvoie { el, get value(), set }.
export function placePicker({ value = null, height = 240, onChange } = {}) {
  let cur = value && value.lat != null ? { ...value } : null, map, marker, geocode = null;
  const label = h('input', { placeholder: 'Rechercher une adresse ou un lieu…', value: cur?.label || '', 'aria-label': 'Rechercher un lieu', autocomplete: 'off', style: { flex: 1 } });
  const la = h('input', { type: 'number', step: 'any', placeholder: 'Latitude', value: cur?.lat ?? '', 'aria-label': 'Latitude' }), ln = h('input', { type: 'number', step: 'any', placeholder: 'Longitude', value: cur?.lng ?? '', 'aria-label': 'Longitude' });
  const mapBox = h('div', { class: 'gmap', style: { height: height + 'px', display: 'none', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--line)', marginTop: '6px' } });
  const status = h('small', { class: 'muted' }, cur ? 'Lieu choisi' : 'Aucun lieu choisi'), sugg = h('ul', { hidden: true });
  const set = (p, from) => { cur = { lat: +p.lat, lng: +p.lng, label: p.label ?? cur?.label ?? '' }; la.value = cur.lat.toFixed(6); ln.value = cur.lng.toFixed(6); if (p.label !== undefined && from !== 'typing') label.value = cur.label; status.textContent = 'Lieu choisi'; if (marker) { marker.setVisible(true); marker.setPosition(cur); map.panTo ? map.panTo(cur) : map.setView(cur); } onChange?.(cur); };
  const manual = () => { if (la.value !== '' && ln.value !== '' && Number.isFinite(+la.value) && Number.isFinite(+ln.value)) set({ lat: la.value, lng: ln.value, label: label.value }, 'typing'); };
  la.addEventListener('change', manual); ln.addEventListener('change', manual); label.addEventListener('change', () => { if (cur) { cur.label = label.value; onChange?.(cur); } });
  const here = h('button', { type: 'button', class: 'btn sm', onclick: () => navigator.geolocation?.getCurrentPosition((p) => set({ lat: p.coords.latitude, lng: p.coords.longitude, label: label.value || 'Ma position' }), () => (status.textContent = 'Position introuvable'), { enableHighAccuracy: true, timeout: 10000 }) }, 'Ma position');
  engine().then(async (eng) => {
    if (!eng) throw new Error('offline'); mapBox.style.display = 'block';
    if (eng.name === 'google') {
      const g = eng.g; map = new g.Map(mapBox, { center: cur || { lat: 4.05, lng: 9.7 }, zoom: cur ? 16 : 5, mapTypeControl: false, streetViewControl: false, gestureHandling: 'greedy' });
      marker = new g.Marker({ map, position: cur || undefined, draggable: true }); if (!cur) marker.setVisible(false); const geo = new g.Geocoder(); const reverse = (p) => geo.geocode({ location: p }, (r, st) => set({ ...p, label: st === 'OK' && r[0] ? r[0].formatted_address : label.value }));
      map.addListener('click', (e) => reverse({ lat: e.latLng.lat(), lng: e.latLng.lng() })); marker.addListener('dragend', (e) => reverse({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
      const ac = new g.places.Autocomplete(label, { fields: ['geometry', 'name', 'formatted_address'] });
      ac.addListener('place_changed', () => { const pl = ac.getPlace(); if (!pl?.geometry) return; map.setZoom(16); set({ lat: pl.geometry.location.lat(), lng: pl.geometry.location.lng(), label: [pl.name, pl.formatted_address].filter(Boolean).join(' — ') }); });
      label.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); }); return;
    }
    // OpenStreetMap : repère, recherche Nominatim (via le serveur), géocodage inverse
    const reverse = async (p) => { set({ ...p, label: label.value }); try { const r = await get(`/maps/reverse?lat=${p.lat}&lng=${p.lng}`); if (r.label) set({ ...p, label: r.label }); } catch { /* on garde les coordonnées */ } };
    map = osmMap(mapBox, { center: cur || { lat: 4.05, lng: 9.7 }, zoom: cur ? 16 : 5, tiles: eng.cfg.tiles, onClick: (p) => reverse(p) });
    marker = map.addMarker({ ...(cur || { lat: 0, lng: 0 }), kind: 'dest', label: '', draggable: true, onDrag: (p) => reverse(p) }); if (!cur) marker.setVisible(false);
    let t = 0; label.addEventListener('input', () => { clearTimeout(t); const q = label.value.trim(); if (q.length < 3) { sugg.hidden = true; return; } t = setTimeout(async () => { try { const r = await get(`/maps/search?q=${encodeURIComponent(q)}${cur ? `&lat=${cur.lat}&lng=${cur.lng}` : ''}`); sugg.replaceChildren(...(r.data.length ? r.data.map((x) => h('li', { tabindex: 0, onclick: () => { sugg.hidden = true; map.setView(x, 16); set(x); } }, x.label)) : [h('li', {}, 'Aucun résultat')])); sugg.hidden = false; } catch (e) { status.textContent = e.message || 'Recherche indisponible'; } }, 600); });
    label.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); }); document.addEventListener('click', (e) => { if (!sugg.contains(e.target) && e.target !== label) sugg.hidden = true; });
  }).catch(() => { status.textContent = cur ? 'Lieu choisi' : 'Carte indisponible (hors connexion) : saisissez les coordonnées ou utilisez « Ma position ».'; });
  const el = h('div', { class: 'picker' }, h('div', { class: 'row osm-sugg' }, label, here, sugg), mapBox, h('div', { class: 'row', style: { marginTop: '6px' } }, la, ln), status);
  return { el, get value() { return cur; }, set };
}
