import { cachePut, cacheGet, setOnline, setSender, setScope, net, enqueue } from './offline.js';
// Client API : jeton d'accès en mémoire (jamais en localStorage), refresh par cookie HttpOnly.
export const state = { token: null, user: null, perms: new Set(), pharmacy: null, phOverride: null };
let refreshing = null;
export const can = (p) => state.perms.has(p);

export class ApiError extends Error { constructor(status, body) { super(body?.error?.message || `Erreur ${status}`); this.status = status; this.code = body?.error?.code; this.details = body?.error?.details; } }

async function raw(method, path, body, opts = {}) {
  const headers = { 'x-requested-with': 'XMLHttpRequest' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (state.token && !opts.noAuth) headers.authorization = 'Bearer ' + state.token;
  if (state.phOverride) headers['x-pharmacy-id'] = String(state.phOverride);
  try { const r = await fetch('/api/v1' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' }); if (!net.online) setOnline(true); return r; }
  catch (e) { setOnline(false); throw new ApiError(0, { error: { code: 'OFFLINE', message: 'Hors connexion' } }); }
}
const CACHEABLE = (p) => !/^\/(auth|events|notifications)/.test(p) && !/\.(pdf|csv|xlsx)/.test(p) && !p.includes('format=');
// Jeton toujours frais : renouvelé AVANT son expiration (minuterie + retour d'onglet/réseau + vérification avant chaque requête),
// pour qu'aucune requête ne parte avec un jeton expiré (plus de 401 dans la console, flux temps réel jamais coupé).
const jwtExp = (t) => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch { return 0; } };
let renewTimer = null;
function scheduleRenew() { clearTimeout(renewTimer); if (!state.token) return; const exp = jwtExp(state.token); if (!exp) return; renewTimer = setTimeout(() => ensureFresh(true).catch(() => {}), Math.max(5000, exp - Date.now() - 90000)); }
export async function ensureFresh(force = false) { if (!state.token) return; const exp = jwtExp(state.token); if (force || (exp && exp - Date.now() < 45000)) await refresh(); }
export function setSession(d) { state.impersonating = !!d.impersonating; setScope(d.user?.id); state.token = d.access_token; state.user = d.user; state.perms = new Set(d.permissions || []); scheduleRenew(); }
for (const ev of ['visibilitychange', 'online', 'focus']) addEventListener(ev, () => { if (document.visibilityState !== 'hidden') ensureFresh().catch(() => {}); });
export async function refresh() {
  refreshing ||= (async () => { const r = await raw('POST', '/auth/refresh', {}, { noAuth: true }); if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => null)); const d = await r.json(); setSession(d); return d; })().finally(() => { refreshing = null; });
  return refreshing;
}
export async function api(method, path, body) {
  let r; if (state.token && !/^\/auth\//.test(path)) await ensureFresh().catch(() => {}); // jamais de requête avec un jeton expiré
  try { r = await raw(method, path, body); }
  catch (e) { if (e.status === 0 && method === 'GET' && CACHEABLE(path)) { const c = await cacheGet(path); if (c) { const d = c.data; if (d && typeof d === 'object') try { Object.defineProperty(d, '__cachedAt', { value: c.at, enumerable: false }); } catch {} return d; } } throw e; }
  if (r.status === 401 && state.token) { try { await refresh(); r = await raw(method, path, body); } catch { state.token = null; location.hash = '#/login'; location.reload(); throw new ApiError(401, null); } }
  if (r.status === 204) return null;
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.blob();
  if (!r.ok) throw new ApiError(r.status, data);
  if (method === 'GET' && CACHEABLE(path) && ct.includes('json')) cachePut(path, data);
  return data;
}
export const get = (p) => api('GET', p); export const post = (p, b = {}) => api('POST', p, b); export const put = (p, b = {}) => api('PUT', p, b); export const del = (p) => api('DELETE', p);
export const qs = (o) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString(); return s ? '?' + s : ''; };

// Téléchargement authentifié (CSV, fichiers)
export async function download(path, filename) {
  const r = await raw('GET', path); if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => null));
  const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function blobUrl(path) { const r = await raw('GET', path); if (!r.ok) throw new ApiError(r.status, null); return URL.createObjectURL(await r.blob()); }

// Temps réel (SSE via fetch pour pouvoir envoyer l'en-tête Authorization)
export async function listen(onEvent, signal) {
  for (;;) {
    try {
      await ensureFresh().catch(() => {}); let r = await raw('GET', '/events');
      if (r.status === 401) { await refresh(); r = await raw('GET', '/events'); } // jeton expiré : on le renouvelle et on se reconnecte tout de suite
      if (!r.ok || !r.body) throw new Error('sse');
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /event: (.+)/.exec(chunk)?.[1], data = /data: (.+)/.exec(chunk)?.[1]; if (ev && data) try { onEvent(ev, JSON.parse(data)); } catch {} }
      }
    } catch {}
    if (signal?.aborted || !state.token) return; await new Promise((r) => setTimeout(r, 5000));
  }
}

// Envoi d'un élément de la file d'attente (vente hors ligne) : clé d'idempotence → aucun doublon possible
setSender(async (it) => { const r = await raw(it.method || 'POST', it.path, it.body); const d = await r.json().catch(() => null); if (!r.ok) throw new ApiError(r.status, d); return d; });

// Action à mettre en file d'attente si le réseau est coupé (chauffeur : accepter, produit récupéré, message, fin de course…). Rejouée automatiquement au retour du réseau.
export async function postQueued(path, body = {}, label = '', method = 'POST') {
  try { return await api(method, path, body); }
  catch (e) { if (e.status !== 0) throw e; await enqueue({ key: 'q' + Date.now() + Math.random().toString(36).slice(2, 7), method, path, body, label: label || path }); return { queued: true }; }
}
