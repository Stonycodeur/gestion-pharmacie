// Modes de paiement configurés par le super-administrateur (chargés depuis le serveur, repli local hors connexion).
import { get } from './api.js';
const DEF = [{ code: 'cash', label: 'Espèces', kind: 'cash' }, { code: 'card', label: 'Carte', kind: 'card' }, { code: 'mobile', label: 'Mobile', kind: 'mobile' }, { code: 'transfer', label: 'Virement', kind: 'transfer' }];
let cache = DEF;
export const methodsNow = () => cache;
export const kindOf = (code) => (cache.find((m) => m.code === code) || {}).kind || code;
export const kindIcon = (k) => ({ cash: 'cash', card: 'wallet', mobile: 'scan', wallet: 'wallet' }[k] || 'swap');
export async function loadMethods(channel = 'pos') {
  try { const r = await get('/payment-methods?channel=' + channel); if (r.length) cache = r; } catch { /* hors connexion : dernière liste connue */ }
  globalThis.__pmLabels = Object.fromEntries(cache.map((m) => [m.code, m.label])); return cache;
}
export const methodOptions = () => cache.map((m) => ({ value: m.code, label: m.label }));
