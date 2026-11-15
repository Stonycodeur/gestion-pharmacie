// Carte OpenStreetMap sans dépendance ni clé (moteur de tuiles « slippy map » maison) : déplacement, zoom, repères nommés, traits de trajet.
// Les tuiles viennent de OSM_TILE_URL (par défaut tile.openstreetmap.org, voir /maps/config) ; l'attribution © OpenStreetMap est affichée.
import { h } from './ui.js';
const T = 256, COL = { pharmacy: '#0f766e', dest: '#dc2626', driver: '#2563eb', me: '#7c3aed' };
const NS = 'http://www.w3.org/2000/svg';
const wx = (lng, z) => ((lng + 180) / 360) * T * 2 ** z;
const wy = (lat, z) => { const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * T * 2 ** z; };
const lng_ = (x, z) => (x / (T * 2 ** z)) * 360 - 180;
const lat_ = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / (T * 2 ** z); return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
export function osmMap(el, { center = { lat: 4.05, lng: 9.7 }, zoom = 14, tiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', onClick } = {}) {
  let c = { ...center }, z = zoom, W = el.clientWidth || 300, H = el.clientHeight || 240; const markers = new Set(), lines = new Set(), imgs = new Map();
  el.classList.add('osm'); el.style.touchAction = 'none';
  const tl = h('div', { class: 'osm-tiles' }), svg = document.createElementNS(NS, 'svg'), ml = h('div', { class: 'osm-markers' });
  svg.setAttribute('class', 'osm-lines');
  const zin = h('button', { type: 'button', class: 'osm-z', 'aria-label': 'Zoom avant' }, '+'), zout = h('button', { type: 'button', class: 'osm-z', 'aria-label': 'Zoom arrière' }, '−');
  el.append(tl, svg, ml, h('div', { class: 'osm-ctl' }, zin, zout), h('a', { class: 'osm-attr', href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer' }, '© OpenStreetMap'));
  const px = (p) => [wx(p.lng, z) - wx(c.lng, z) + W / 2, wy(p.lat, z) - wy(c.lat, z) + H / 2];
  function draw() {
    W = el.clientWidth || W; H = el.clientHeight || H; const cx = wx(c.lng, z) - W / 2, cy = wy(c.lat, z) - H / 2, n = 2 ** z, want = new Set();
    for (let x = Math.floor(cx / T); x <= Math.floor((cx + W) / T); x++) for (let y = Math.floor(cy / T); y <= Math.floor((cy + H) / T); y++) {
      if (y < 0 || y >= n) continue; const tx = ((x % n) + n) % n, key = `${z}/${tx}/${y}@${x}`; want.add(key); let im = imgs.get(key);
      if (!im) { im = h('img', { alt: '', draggable: false, loading: 'eager', decoding: 'async', referrerpolicy: 'strict-origin-when-cross-origin', src: tiles.replace('{z}', z).replace('{x}', tx).replace('{y}', y) }); im.onerror = () => { im.style.visibility = 'hidden'; }; tl.append(im); imgs.set(key, im); }
      im.style.transform = `translate(${x * T - cx}px,${y * T - cy}px)`;
    }
    for (const [k, im] of imgs) if (!want.has(k)) { im.remove(); imgs.delete(k); }
    for (const m of markers) { const [x, y] = px(m.pos); m.el.style.transform = `translate(${x}px,${y}px)`; }
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const l of lines) l.el.setAttribute('points', l.pts.map((p) => px(p).map((v) => v.toFixed(1)).join(',')).join(' '));
  }
  let raf = 0; const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  const setZoom = (nz, at) => { nz = Math.max(2, Math.min(19, nz)); if (nz === z) return; if (at) { const ax = at.x - W / 2, ay = at.y - H / 2, p = { lat: lat_(wy(c.lat, z) + ay, z), lng: lng_(wx(c.lng, z) + ax, z) }; z = nz; c = { lat: lat_(wy(p.lat, z) - ay, z), lng: lng_(wx(p.lng, z) - ax, z) }; } else z = nz; draw(); };
  zin.onclick = () => setZoom(z + 1); zout.onclick = () => setZoom(z - 1);
  // interactions : glisser, molette, double-clic, pincement, clic
  const ptrs = new Map(); let start = null, moved = false, pinch = 0;
  el.addEventListener('pointerdown', (e) => { if (e.target.closest('.osm-ctl,.osm-attr')) return; el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 1) { start = { x: e.clientX, y: e.clientY, wx: wx(c.lng, z), wy: wy(c.lat, z) }; moved = false; } if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
  el.addEventListener('pointermove', (e) => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch && d / pinch > 1.6) { setZoom(z + 1); pinch = d; } else if (pinch && d / pinch < 0.6) { setZoom(z - 1); pinch = d; } moved = true; return; }
    if (!start) return; const dx = e.clientX - start.x, dy = e.clientY - start.y; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true; if (!moved) return; c = { lat: lat_(start.wy - dy, z), lng: lng_(start.wx - dx, z) }; redraw(); });
  const up = (e) => { const had = ptrs.delete(e.pointerId); if (!had) return; if (ptrs.size === 0 && start && !moved && onClick && !e.target.closest('.osm-ctl,.osm-attr')) { const r = el.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; onClick({ lat: lat_(wy(c.lat, z) + y - H / 2, z), lng: lng_(wx(c.lng, z) + x - W / 2, z) }); } if (ptrs.size === 0) start = null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); setZoom(z + (e.deltaY < 0 ? 1 : -1), { x: e.clientX - r.left, y: e.clientY - r.top }); }, { passive: false });
  el.addEventListener('dblclick', (e) => { const r = el.getBoundingClientRect(); setZoom(z + 1, { x: e.clientX - r.left, y: e.clientY - r.top }); });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => redraw()) : null; ro?.observe(el);
  const api = {
    get center() { return { ...c }; }, get zoom() { return z; },
    setView(p, zz) { c = { lat: p.lat, lng: p.lng }; if (zz) z = zz; draw(); },
    fitBounds(pts, pad = 48) { pts = pts.filter((p) => p && p.lat != null); if (!pts.length) return; if (pts.length === 1) return api.setView(pts[0], 16); W = el.clientWidth || W; H = el.clientHeight || H;
      const la = pts.map((p) => p.lat), ln = pts.map((p) => p.lng), mid = { lat: (Math.min(...la) + Math.max(...la)) / 2, lng: (Math.min(...ln) + Math.max(...ln)) / 2 }; let zz = 18;
      for (; zz > 2; zz--) { const w = Math.abs(wx(Math.max(...ln), zz) - wx(Math.min(...ln), zz)), hh = Math.abs(wy(Math.min(...la), zz) - wy(Math.max(...la), zz)); if (w <= W - 2 * pad && hh <= H - 2 * pad) break; } api.setView(mid, zz); },
    addMarker({ lat, lng, kind = 'pharmacy', label = '', draggable = false, onDrag }) {
      const color = COL[kind] || '#444', round = kind === 'driver' || kind === 'me';
      const e = h('div', { class: 'osm-marker', title: label }, h('span', { class: 'osm-dot' + (round ? ' round' : ''), style: { background: color } }), label ? h('span', { class: 'osm-label' }, label) : null);
      const m = { pos: { lat, lng }, el: e, setPosition(p) { m.pos = { lat: p.lat ?? p.lat(), lng: p.lng ?? p.lng() }; redraw(); }, setVisible(v) { e.style.display = v ? '' : 'none'; }, remove() { markers.delete(m); e.remove(); } };
      if (draggable) { let d = false; e.style.pointerEvents = 'auto'; e.style.cursor = 'grab'; e.addEventListener('pointerdown', (ev) => { d = true; e.setPointerCapture(ev.pointerId); ev.stopPropagation(); }); e.addEventListener('pointermove', (ev) => { if (!d) return; const r = el.getBoundingClientRect(); m.pos = { lat: lat_(wy(c.lat, z) + ev.clientY - r.top - H / 2, z), lng: lng_(wx(c.lng, z) + ev.clientX - r.left - W / 2, z) }; redraw(); }); e.addEventListener('pointerup', () => { if (d) { d = false; onDrag?.({ ...m.pos }); } }); }
      markers.add(m); ml.append(e); redraw(); return m; },
    addLine(pts, { color = '#2563eb', width = 5, dashed = false, opacity = .9 } = {}) {
      const p = document.createElementNS(NS, 'polyline'); for (const [k, v] of Object.entries({ fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity })) p.setAttribute(k, v); if (dashed) p.setAttribute('stroke-dasharray', '8 8');
      const l = { el: p, pts, remove() { lines.delete(l); p.remove(); } }; lines.add(l); svg.append(p); redraw(); return l; },
    destroy() { ro?.disconnect(); markers.clear(); lines.clear(); }
  };
  draw(); return api;
}
