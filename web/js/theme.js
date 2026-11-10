// Personnalisation : mode, couleur d'accent, densité, arrondis, taille du texte, animations. Stockée par appareil (localStorage) ;
// la couleur d'accent par défaut vient de l'identité de l'établissement (paramètre brand_color).
export const DEFAULTS = { mode: 'auto', accent: null, density: 'comfortable', radius: 'normal', font: 100, motion: 'on', rail: 'auto', contrast: 'normal' };
export const SWATCHES = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#475569'];
let prefs = { ...DEFAULTS }, brand = '#0f766e';
const listeners = new Set();
try { Object.assign(prefs, JSON.parse(localStorage.getItem('gp_prefs') || '{}')); } catch {}

export const getPrefs = () => ({ ...prefs });
export const brandColor = () => brand;
export const onTheme = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function setBrand(hex) { if (/^#[0-9a-f]{6}$/i.test(hex || '')) { brand = hex; apply(); } }
export function setPrefs(p) { prefs = { ...prefs, ...p }; try { localStorage.setItem('gp_prefs', JSON.stringify(prefs)); } catch {} apply(); }
export function resetPrefs() { prefs = { ...DEFAULTS }; try { localStorage.removeItem('gp_prefs'); } catch {} apply(); }

// ---- couleurs ----
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function rgb2hsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s * 100, l * 100]; }
const hsl = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(Math.max(0, Math.min(100, s)))}% ${Math.round(Math.max(0, Math.min(100, l)))}%)`;
function lum([r, g, b]) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
export const contrastInk = (hex) => (lum(hex2rgb(hex)) > 0.42 ? '#0b1b1b' : '#ffffff');
export function accentVars(hex, dark) {
  const rgb = hex2rgb(hex), [h, s, l] = rgb2hsl(rgb);
  if (!dark) return { '--brand': hex, '--brand-ink': contrastInk(hex), '--brand-soft': hsl(h, Math.min(s, 70), 94), '--brand-strong': hsl(h, s, Math.max(14, l - 9)), '--brand-2': hsl(h + 28, Math.min(95, s + 8), Math.min(62, l + 8)), '--brand-glow': `rgba(${rgb.join(',')},.35)` };
  const lb = Math.max(l, 62), b2 = hsl(h, Math.min(s, 85), lb);
  return { '--brand': b2, '--brand-ink': '#06201d', '--brand-soft': hsl(h, Math.min(s, 55) * 0.8, 17), '--brand-strong': hsl(h, s, Math.min(82, lb + 8)), '--brand-2': hsl(h + 28, Math.min(90, s), Math.min(70, lb + 4)), '--brand-glow': `rgba(${hex2rgb(hslToHex(h, Math.min(s, 85), lb)).join(',')},.35)` };
}
function hslToHex(h, s, l) { s /= 100; l /= 100; const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); }; return `#${f(0)}${f(8)}${f(4)}`; }

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
export const isDark = () => (prefs.mode === 'auto' ? !!mq?.matches : prefs.mode === 'dark');
export function apply() {
  const r = document.documentElement, dark = isDark();
  r.dataset.theme = dark ? 'dark' : 'light'; r.dataset.density = prefs.density; r.dataset.radius = prefs.radius; r.dataset.motion = prefs.motion; r.dataset.rail = prefs.rail; r.dataset.contrast = prefs.contrast;
  r.style.setProperty('--fs', String(prefs.font / 100));
  for (const [k, v] of Object.entries(accentVars(prefs.accent || brand, dark))) r.style.setProperty(k, v);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0b1517' : (prefs.accent || brand));
  listeners.forEach((f) => f(prefs));
}
mq?.addEventListener?.('change', () => prefs.mode === 'auto' && apply());
apply();
