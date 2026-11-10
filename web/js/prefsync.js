// Synchronise les préférences d'affichage avec le compte (suivent l'utilisateur d'un appareil à l'autre).
import { get, put } from './api.js';
import { getPrefs, setPrefs, onTheme } from './theme.js';
const KEYS = ['mode', 'accent', 'density', 'radius', 'font', 'motion', 'rail', 'contrast']; let ready = false, timer;
export async function syncPrefs() {
  ready = false;
  try { const s = await get('/me/preferences'); const o = {}; for (const k of KEYS) if (k in s) o[k] = s[k]; if (Object.keys(o).length) setPrefs(o); } catch { /* hors connexion : préférences locales */ }
  ready = true;
}
export const stopSync = () => { ready = false; };
onTheme(() => { if (!ready) return; clearTimeout(timer); timer = setTimeout(() => { const p = getPrefs(); put('/me/preferences', Object.fromEntries(KEYS.map((k) => [k, p[k]]))).catch(() => {}); }, 800); });
