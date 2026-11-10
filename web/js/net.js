// Composants partagés du réseau d'établissements : pays/drapeaux, champ téléphone, œil du mot de passe, sons de notification, géolocalisation, carte SVG.
import { h, icon } from './ui.js';
import { get, state } from './api.js';

// ---------- pays & drapeaux ----------
let countries = null, loading = null;
export async function getCountries(force = false) {
  if (countries && !force) return countries;
  loading ||= get('/countries').then((l) => (countries = l.map((c) => ({ ...c, name: c.name || c.name_fr })))).finally(() => (loading = null)); return loading;
}
const citiesCache = new Map();
export async function getCities(countryId) { if (!countryId) return []; if (!citiesCache.has(String(countryId))) citiesCache.set(String(countryId), get(`/countries/${countryId}/cities`).then((r) => r.map((x) => x.name))); return citiesCache.get(String(countryId)); }
export const flagImg = (c, size = 22) => h('img', { class: 'flag', src: c?.flag || (c?.iso2 ? `/assets/flags/${c.iso2.toLowerCase()}.png` : ''), alt: c?.iso2 || '', onerror: (e) => { e.target.replaceWith(h('span', { class: 'flag-code' }, c?.iso2 || '')); }, width: size, height: Math.round(size * 0.75), loading: 'lazy', style: { width: size + 'px', height: Math.round(size * 0.75) + 'px', objectFit: 'cover', borderRadius: '3px', boxShadow: '0 0 0 1px rgba(0,0,0,.15)', flex: 'none' } });

// Champ téléphone : on choisit l'indicatif (drapeau + nom du pays affichés), puis on ne saisit que le numéro local.
// L'élément expose .value (format international « +24106123456 », ou '' si vide) et .valid.
export function phoneField({ value = '', dial = null, required = false, name = 'phone' } = {}) {
  const wrap = h('div', { class: 'phonefield' });
  const flag = h('span', { class: 'pf-flag' }), country = h('small', { class: 'pf-country muted' });
  const sel = h('select', { 'aria-label': 'Indicatif du pays', class: 'pf-dial' });
  const num = h('input', { type: 'tel', inputMode: 'tel', autocomplete: 'tel-national', placeholder: 'Numéro', required, name, maxLength: 20 });
  wrap.append(h('div', { class: 'pf-row' }, flag, sel, num), country);
  const paint = () => { const c = (countries || []).find((x) => x.dial_code === sel.value); flag.replaceChildren(c ? flagImg(c, 24) : ''); country.textContent = c ? c.name : ''; };
  const fill = () => {
    const list = (countries || []).filter((c) => c.active !== 0);
    const dialsSeen = new Set(); sel.replaceChildren();
    for (const c of list) { sel.append(h('option', { value: c.dial_code, 'data-iso': c.iso2 }, `${c.name} (+${c.dial_code})`)); dialsSeen.add(c.dial_code); }
    let d = dial || state.pharmacy?.dial_code || '216', n = '';
    if (value) { const digits = String(value).replace(/\D/g, ''); const m = [...dialsSeen].sort((a, b) => b.length - a.length).find((x) => digits.startsWith(x)); if (m) { d = m; n = digits.slice(m.length); } else n = digits; }
    sel.value = d; num.value = n; paint();
  };
  getCountries().then(fill).catch(() => { sel.append(h('option', { value: '216' }, '+216')); num.value = String(value || '').replace(/^\+?216/, ''); });
  sel.addEventListener('change', paint);
  Object.defineProperty(wrap, 'value', { get: () => { const d = num.value.replace(/\D/g, '').replace(/^0+(?=\d{6})/, (z) => z); return d ? '+' + sel.value + d : ''; }, set: () => {} });
  Object.defineProperty(wrap, 'required', { get: () => required });
  wrap.setDial = (d) => { dial = d; const apply = () => { if ([...sel.options].some((o) => o.value === String(d))) { sel.value = String(d); paint(); } }; apply(); getCountries().then(apply).catch(() => {}); };
  wrap.focus = () => num.focus(); return wrap;
}

// ---------- œil : afficher / masquer tout champ mot de passe ----------
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A10.7 10.7 0 0 1 12 4c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/></svg>';
export function enhancePasswords(root = document) {
  for (const inp of root.querySelectorAll('input[type=password]:not([data-eye])')) {
    inp.dataset.eye = '1'; const box = h('span', { class: 'pw-wrap' }); inp.replaceWith(box);
    const btn = h('button', { type: 'button', class: 'pw-eye', 'aria-label': 'Afficher le mot de passe', 'aria-pressed': 'false', tabIndex: 0 }); btn.innerHTML = EYE;
    btn.addEventListener('click', () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; btn.innerHTML = show ? EYE_OFF : EYE; btn.setAttribute('aria-pressed', String(show)); btn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'); inp.focus(); });
    box.append(inp, btn);
  }
}
new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) enhancePasswords(n.matches?.('input[type=password]') ? n.parentNode : n); }).observe(document.documentElement, { childList: true, subtree: true });

// ---------- sons de notification (WebAudio : aucun fichier, fonctionne hors ligne) ----------
export const SOUNDS = {
  aurora: { label: 'Aurore (par défaut)', notes: [[659.25, 0, .12], [880, .1, .12], [1318.5, .2, .28]], type: 'sine' },
  crystal: { label: 'Cristal', notes: [[1046.5, 0, .1], [1568, .09, .1], [2093, .18, .3]], type: 'triangle' },
  pulse: { label: 'Pulsation', notes: [[523.25, 0, .09], [523.25, .14, .09], [783.99, .28, .2]], type: 'square', gain: .05 },
  bell: { label: 'Clochette', notes: [[1318.5, 0, .5], [1975.5, 0, .5]], type: 'sine' },
  soft: { label: 'Douceur', notes: [[392, 0, .18], [523.25, .15, .3]], type: 'sine' },
  none: { label: 'Silencieux', notes: [] },
};
let ctxA = null;
// Sonnerie choisie sur l'appareil : fichier audio (≤ 1,5 Mo) conservé dans ce navigateur/cette application pour ce compte et cet établissement.
const RING = () => KEY() + '.ring';
export const customRing = () => { try { return JSON.parse(localStorage.getItem(RING()) || 'null'); } catch { return null; } };
export function setCustomRing(file) {
  return new Promise((res, rej) => {
    if (!file || !/^audio\//.test(file.type || '') && !/\.(mp3|wav|ogg|m4a|aac|opus|webm)$/i.test(file.name)) return rej(new Error('Choisissez un fichier audio (MP3, WAV, OGG, M4A…)'));
    if (file.size > 1.5 * 1024 * 1024) return rej(new Error('Fichier trop volumineux (1,5 Mo maximum) : choisissez une sonnerie courte'));
    const r = new FileReader(); r.onerror = () => rej(new Error('Lecture du fichier impossible'));
    r.onload = () => { try { localStorage.setItem(RING(), JSON.stringify({ name: file.name, url: String(r.result) })); setSoundPrefs({ sound: 'custom' }); res(file.name); } catch { rej(new Error('Espace de stockage plein : choisissez un fichier plus petit')); } };
    r.readAsDataURL(file);
  });
}
export const clearCustomRing = () => { try { localStorage.removeItem(RING()); if (soundPrefs().sound === 'custom') setSoundPrefs({ sound: 'aurora' }); } catch { /* ignoré */ } };
let ringAudio = null;
function playCustom(volume) {
  const c = customRing(); if (!c) return false;
  try { ringAudio?.pause(); ringAudio = new Audio(c.url); ringAudio.volume = Math.min(1, Math.max(0, volume)); ringAudio.play().catch(() => {}); setTimeout(() => ringAudio?.pause(), 8000); return true; } catch { return false; }
}
export function playSound(id = 'aurora', volume = 0.6) {
  if (id === 'custom') { if (playCustom(volume)) return; id = 'aurora'; }
  const s = SOUNDS[id] || SOUNDS.aurora; if (!s.notes.length) return;
  try {
    ctxA ||= new (window.AudioContext || window.webkitAudioContext)(); if (ctxA.state === 'suspended') ctxA.resume();
    const t0 = ctxA.currentTime;
    for (const [f, at, dur] of s.notes) {
      const o = ctxA.createOscillator(), g = ctxA.createGain(); o.type = s.type; o.frequency.value = f;
      const peak = (s.gain ?? 0.16) * volume; g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur + 0.25);
      o.connect(g).connect(ctxA.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.3);
    }
  } catch { /* son impossible : sans gravité */ }
}
const KEY = () => 'gp.notif.' + (state.pharmacy?.id || 'x') + '.' + (state.user?.id || 'x');
export const soundPrefs = () => { try { return { sound: 'aurora', volume: 0.6, muted: false, ...(JSON.parse(localStorage.getItem(KEY()) || '{}')) }; } catch { return { sound: 'aurora', volume: 0.6, muted: false }; } };
export const setSoundPrefs = (p) => { try { localStorage.setItem(KEY(), JSON.stringify({ ...soundPrefs(), ...p })); } catch {} };
export const notifyBeep = () => { const p = soundPrefs(); if (!p.muted) playSound(p.sound, p.volume); };
// débloque l'audio au premier geste (politique des navigateurs)
addEventListener('pointerdown', () => { try { ctxA ||= new (window.AudioContext || window.webkitAudioContext)(); ctxA.resume(); } catch {} }, { once: true });

// ---------- géolocalisation ----------
export function locate({ timeout = 10000 } = {}) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('La géolocalisation n\'est pas disponible sur cet appareil'));
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), (e) => rej(new Error(e.code === 1 ? 'Autorisez la localisation dans votre navigateur pour trouver les pharmacies proches' : 'Position introuvable, réessayez')), { enableHighAccuracy: true, timeout, maximumAge: 15000 });
  });
}
export const fmtKm = (km) => (km == null ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
export const fmtM = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

// ---------- carte SVG (sans fonds de carte externes : fonctionne hors ligne et sans clé API) ----------
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids.filter(Boolean)); return e; };
// points : [{ lat, lng, kind: 'pharmacy'|'dest'|'driver'|'me', label }] ; path : [{lat,lng}]
// Itinéraire guidé : Google Maps (ou l'application Maps de l'appareil) depuis la position de l'utilisateur ; dans l'application mobile le lien s'ouvre dans Maps.
export const directionsUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
export const directionsLink = (lat, lng, label = 'Itinéraire', cls = 'btn sm') => h('a', { class: cls, href: directionsUrl(lat, lng), target: '_blank', rel: 'noopener noreferrer', 'aria-label': label + ' (Google Maps)' }, icon('navigate', { size: 14 }), label);
export function mapView({ points = [], path = [], height = 280 } = {}) {
  const all = [...points, ...path].filter((p) => p.lat != null && p.lng != null);
  const box = h('div', { class: 'svgmap', style: { height: height + 'px' }, role: 'img', 'aria-label': 'Carte du trajet' });
  if (!all.length) { box.append(h('div', { class: 'empty' }, 'Position indisponible')); return box; }
  const W = 600, H = 400, pad = 46;
  let minLa = Math.min(...all.map((p) => p.lat)), maxLa = Math.max(...all.map((p) => p.lat)), minLn = Math.min(...all.map((p) => p.lng)), maxLn = Math.max(...all.map((p) => p.lng));
  const dLa = Math.max(maxLa - minLa, 0.004), dLn = Math.max(maxLn - minLn, 0.004); const cLa = (maxLa + minLa) / 2, cLn = (maxLn + minLn) / 2; const kx = Math.cos((cLa * Math.PI) / 180);
  const scale = Math.min((W - 2 * pad) / (dLn * kx), (H - 2 * pad) / dLa);
  const X = (lng) => W / 2 + (lng - cLn) * kx * scale, Y = (lat) => H / 2 - (lat - cLa) * scale;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', width: '100%', height: '100%' });
  svg.append(sv('rect', { width: W, height: H, fill: 'var(--bg2)', rx: 12 }));
  for (let i = 1; i < 8; i++) { svg.append(sv('line', { x1: (W / 8) * i, y1: 0, x2: (W / 8) * i, y2: H, stroke: 'var(--line)', 'stroke-width': 1 }), sv('line', { x1: 0, y1: (H / 8) * i, x2: W, y2: (H / 8) * i, stroke: 'var(--line)', 'stroke-width': 1 })); }
  const col = { pharmacy: '#0f766e', dest: '#dc2626', driver: '#2563eb', me: '#7c3aed' };
  const ph = points.find((p) => p.kind === 'pharmacy' && p.lat != null), de = points.find((p) => p.kind === 'dest' && p.lat != null);
  if (ph && de) svg.append(sv('line', { x1: X(ph.lng), y1: Y(ph.lat), x2: X(de.lng), y2: Y(de.lat), stroke: 'var(--muted)', 'stroke-width': 2, 'stroke-dasharray': '6 6', opacity: .6 }));
  if (path.length > 1) svg.append(sv('polyline', { points: path.map((p) => `${X(p.lng).toFixed(1)},${Y(p.lat).toFixed(1)}`).join(' '), fill: 'none', stroke: col.driver, 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: .85 }));
  for (const p of points) {
    if (p.lat == null) continue; const x = X(p.lng), y = Y(p.lat), c = col[p.kind] || '#444';
    const g = sv('g', { transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` });
    if (p.kind === 'driver' || p.kind === 'me') g.append(sv('circle', { r: 18, fill: c, opacity: .18 }, p.kind === 'driver' ? sv('animate', { attributeName: 'r', values: '12;22;12', dur: '2s', repeatCount: 'indefinite' }) : null), sv('circle', { r: 9, fill: c, stroke: '#fff', 'stroke-width': 3 }));
    else g.append(sv('path', { d: 'M0,0 C-14,-18 -14,-38 0,-38 C14,-38 14,-18 0,0Z', fill: c, stroke: '#fff', 'stroke-width': 2 }), sv('circle', { cx: 0, cy: -27, r: 5, fill: '#fff' }));
    if (p.label) { const ty = p.kind === 'driver' || p.kind === 'me' ? 30 : 16; g.append(sv('text', { y: ty, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: 'var(--ink)', stroke: 'var(--panel)', 'stroke-width': 4, 'paint-order': 'stroke' }, document.createTextNode(p.label))); }
    svg.append(g);
  }
  const dest = points.filter((p) => (p.kind === 'pharmacy' || p.kind === 'dest') && p.lat != null);
  box.append(svg, h('div', { class: 'map-actions' }, dest.map((p) => directionsLink(p.lat, p.lng, 'Itinéraire · ' + (p.label || (p.kind === 'pharmacy' ? 'Pharmacie' : 'Destination'))))), h('small', { class: 'muted map-note' }, 'Schéma des positions réelles. « Itinéraire » ouvre Google Maps pour être guidé.')); return box;
}

// ---------- fichiers : sélection avec aperçu avant envoi, aperçu après envoi (fichier privé servi avec le jeton) ----------
import { modal, toast, fail } from './ui.js';
import { blobUrl, download } from './api.js';
export const b64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
export function filePicker({ accept = 'image/jpeg,image/png,application/pdf', max = 3 * 1024 * 1024, label = 'Joindre un fichier' } = {}) {
  const inp = h('input', { type: 'file', accept }), prev = h('div', { class: 'muted' }); let file = null;
  inp.addEventListener('change', () => {
    file = inp.files[0] || null; prev.replaceChildren(); if (!file) return;
    if (file.size > max) { toast(`Fichier trop volumineux (${Math.round(max / 1048576)} Mo max)`, true); inp.value = ''; file = null; return; }
    const url = URL.createObjectURL(file);
    prev.append(file.type === 'application/pdf' ? h('div', {}, h('a', { href: url, target: '_blank', rel: 'noopener' }, `Aperçu du PDF : ${file.name}`), h('iframe', { src: url, title: 'Aperçu', style: { width: '100%', height: '260px', border: '1px solid var(--line)', borderRadius: '8px', marginTop: '6px' } })) : h('img', { src: url, alt: 'Aperçu avant envoi', style: { maxWidth: '100%', maxHeight: '240px', borderRadius: '8px', border: '1px solid var(--line)' } }), h('div', { class: 'muted' }, `${file.name} · ${(file.size / 1024).toFixed(0)} Ko`));
  });
  return { el: h('label', { class: 'f' }, label, inp, prev), get file() { return file; }, payload: async () => (file ? { mime: file.type, name: file.name, data_base64: await b64(file) } : undefined) };
}
export async function previewFile(f, path) {
  try {
    const url = await blobUrl(path || `/files/${f.id}/content`);
    modal(f.name || 'Fichier', h('div', {}, f.mime === 'application/pdf' ? h('iframe', { src: url, title: f.name, style: { width: '100%', height: '60vh', border: 0 } }) : h('img', { src: url, alt: f.name, style: { maxWidth: '100%', maxHeight: '64vh', display: 'block', margin: 'auto' } }),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, h('a', { class: 'btn', href: url, download: f.name || 'fichier' }, 'Télécharger'))), { wide: true });
  } catch (e) { fail(e); }
}
export const stars = (n) => h('span', { class: 'stars', 'aria-label': n ? `${n} sur 5` : 'Pas encore noté' }, n ? '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n)) : '☆☆☆☆☆', n ? h('small', { class: 'muted' }, ` ${n}`) : null);
