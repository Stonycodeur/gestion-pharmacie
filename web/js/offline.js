// Mode hors connexion : cache IndexedDB des lectures (par utilisateur), file d'attente des ventes (idempotentes),
// déverrouillage hors ligne par vérificateur PBKDF2 (le mot de passe n'est jamais stocké).
const DB = 'gp_offline', V = 1;
let dbp;
const open = () => (dbp ||= new Promise((res, rej) => {
  if (!('indexedDB' in globalThis)) return rej(new Error('no idb'));
  const r = indexedDB.open(DB, V);
  r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('cache'); d.createObjectStore('meta'); d.createObjectStore('outbox', { keyPath: 'key' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode), s = t.objectStore(store); let out; Promise.resolve(fn(s)).then((r) => { out = r; }); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); }); };
const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const safe = async (f, d) => { try { return await f(); } catch { return d; } };

export const net = { online: typeof navigator === 'undefined' ? true : navigator.onLine, syncing: false, pending: 0, conflicts: 0 };
const subs = new Set();
export const onNet = (f) => { subs.add(f); return () => subs.delete(f); };
const emit = () => subs.forEach((f) => f({ ...net }));
export function setOnline(v) { if (net.online !== v) { net.online = v; emit(); if (v) sync().catch(() => {}); } }
addEventListener?.('online', () => setOnline(true)); addEventListener?.('offline', () => setOnline(false));

// ---- cache de lecture ----
let scope = '';
export const setScope = (id) => { scope = id ? 'u' + id + ':' : ''; };
const ckey = (p) => scope + p;
export const cachePut = (path, data) => safe(() => tx('cache', 'readwrite', (s) => s.put({ at: Date.now(), data }, ckey(path))));
export const cacheGet = (path) => safe(() => tx('cache', 'readonly', (s) => rq(s.get(ckey(path)))), null);
export const cacheClear = () => safe(() => tx('cache', 'readwrite', (s) => s.clear()));
export const cacheInfo = () => safe(async () => { const d = await open(); const keys = await rq(d.transaction('cache').objectStore('cache').getAllKeys()); return keys.length; }, 0);

// ---- profil hors ligne (déverrouillage) ----
const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u))), unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(pw, salt) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']); return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, k, 256)); }
export async function saveProfile(email, pw, session, pharmacy) {
  if (!crypto?.subtle) return; const salt = crypto.getRandomValues(new Uint8Array(16));
  const rec = { email: email.toLowerCase(), salt: b64(salt), hash: await derive(pw, salt), user: session.user, permissions: session.permissions || [], pharmacy, at: Date.now() };
  await safe(() => tx('meta', 'readwrite', (s) => s.put(rec, 'profile')));
}
export const loadProfile = () => safe(() => tx('meta', 'readonly', (s) => rq(s.get('profile'))), null);
export async function unlock(email, pw) {
  const p = await loadProfile(); if (!p || p.email !== email.trim().toLowerCase()) return null;
  return (await derive(pw, unb64(p.salt))) === p.hash ? p : null;
}
export const forgetProfile = () => safe(() => tx('meta', 'readwrite', (s) => s.delete('profile')));
export const savePrefsMeta = (k, v) => safe(() => tx('meta', 'readwrite', (s) => s.put(v, k)));
export const loadMeta = (k) => safe(() => tx('meta', 'readonly', (s) => rq(s.get(k))), null);

// ---- file d'attente ----
export async function enqueue(item) { await tx('outbox', 'readwrite', (s) => s.put({ ...item, status: 'pending', queued_at: new Date().toISOString(), tries: 0 })); await count(); }
export const listOutbox = () => safe(() => tx('outbox', 'readonly', (s) => rq(s.getAll())), []);
export const removeOutbox = async (key) => { await safe(() => tx('outbox', 'readwrite', (s) => s.delete(key))); await count(); };
async function patchOutbox(key, patch) { await safe(() => tx('outbox', 'readwrite', async (s) => { const cur = await rq(s.get(key)); if (cur) s.put({ ...cur, ...patch }); })); }
export async function count() { const all = await listOutbox(); net.pending = all.filter((x) => x.status === 'pending').length; net.conflicts = all.filter((x) => x.status === 'conflict').length; emit(); return all; }

let again = false, sender = null; // injecté par api.js pour éviter la dépendance circulaire
export const setSender = (f) => { sender = f; };
export async function sync() {
  if (net.syncing) { again = true; return { sent: 0, failed: 0 }; }
  if (!net.online || !sender) return { sent: 0, failed: 0 };
  net.syncing = true; emit(); let sent = 0, failed = 0;
  try {
    for (const it of (await listOutbox()).filter((x) => x.status === 'pending').sort((a, b) => a.queued_at.localeCompare(b.queued_at))) {
      try { const r = await sender(it); await removeOutbox(it.key); sent++; const cb = hooks.sent; cb?.(it, r); }
      catch (e) {
        if (e.status === 0) break;                       // réseau coupé : on réessaiera
        if (e.status === 401) break;                      // session expirée : reprendra après reconnexion
        await patchOutbox(it.key, { status: 'conflict', error: e.message, code: e.code, tries: (it.tries || 0) + 1 }); failed++;
      }
    }
  } finally { net.syncing = false; await count(); }
  if (again) { again = false; const r = await sync(); sent += r.sent; failed += r.failed; }
  return { sent, failed };
}
const hooks = {}; export const onSent = (f) => { hooks.sent = f; };
export async function retryConflict(key) { await patchOutbox(key, { status: 'pending', error: null }); await count(); return sync(); }
export async function wipeAll() { await cacheClear(); await forgetProfile(); }
count().catch(() => {});
