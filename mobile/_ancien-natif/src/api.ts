// Client API : jeton d'accès en mémoire, jeton de rafraîchissement dans le coffre sécurisé du téléphone (Keychain / Keystore).
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

// Émulateur Android : 10.0.2.2 = la machine hôte. Téléphone réel : EXPO_PUBLIC_API_URL=https://pharmacie.example.com (HTTPS obligatoire en production).
export const BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000').replace(/\/$/, '');
const API = BASE + '/api/v1';
const KEY = 'gp_refresh_token';

export type Session = { user: any; perms: Set<string>; pharmacy: any };
export const session: Session = { user: null, perms: new Set(), pharmacy: null };
export const can = (p: string) => session.perms.has(p);
let access: string | null = null;

// ---- hors connexion : état réseau + cache de lecture (par utilisateur) ----
export let online = true; const subs = new Set<(o: boolean) => void>();
export const onNet = (f: (o: boolean) => void) => { subs.add(f); return () => { subs.delete(f); }; };
const setOnline = (o: boolean) => { if (o !== online) { online = o; subs.forEach((f) => f(o)); } };
NetInfo.addEventListener((st) => setOnline(st.isConnected !== false && st.isInternetReachable !== false));
const ck = (p: string) => `gp_cache:${session.user?.id ?? 0}:${p}`;
const cacheable = (p: string) => !/^\/(auth|events|notifications)/.test(p);
export async function clearCache() { const ks = await AsyncStorage.getAllKeys(); await AsyncStorage.multiRemove(ks.filter((k) => k.startsWith('gp_cache:'))); }

export class ApiError extends Error { constructor(public status: number, public code?: string, msg?: string, public details?: any) { super(msg || `Erreur ${status}`); } }

async function raw(method: string, path: string, body?: unknown, auth = true) {
  const headers: Record<string, string> = { 'x-client': 'mobile' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && access) headers.authorization = 'Bearer ' + access;
  try { const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); setOnline(true); return r; }
  catch { setOnline(false); throw new ApiError(0, 'OFFLINE', 'Hors connexion'); }
}
async function apply(d: any) {
  access = d.access_token; session.user = d.user; session.perms = new Set(d.permissions ?? []);
  if (d.refresh_token) await SecureStore.setItemAsync(KEY, d.refresh_token); // rotation : l'ancien jeton devient invalide
}
async function loadMe() { const me = await call('GET', '/auth/me'); session.pharmacy = me.pharmacy; session.user = me.user; AsyncStorage.setItem('gp_profile', JSON.stringify({ user: me.user, perms: [...session.perms], pharmacy: me.pharmacy })).catch(() => {}); }

export async function login(email: string, password: string, otp?: string) {
  const r = await raw('POST', '/auth/login', { email, password, otp }, false); const d = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, d?.error?.code, d?.error?.message);
  await apply(d); await loadMe();
}
let refreshing: Promise<boolean> | null = null;
export function restore(): Promise<boolean> {
  refreshing ??= (async () => {
    const tok = await SecureStore.getItemAsync(KEY); if (!tok) return false;
    const r = await raw('POST', '/auth/refresh', { refresh_token: tok }, false); if (!r.ok) { await SecureStore.deleteItemAsync(KEY); return false; }
    await apply(await r.json()); await loadMe(); return true;
  })().catch(async (e) => {
    // Réseau absent : on rouvre la dernière session connue (lecture seule sur le cache) ; le jeton reste dans le coffre pour la reconnexion
    if (e instanceof ApiError && e.status === 0) { const p = await AsyncStorage.getItem('gp_profile'); if (p) { const d = JSON.parse(p); session.user = d.user; session.perms = new Set(d.perms); session.pharmacy = d.pharmacy; return true; } }
    return false;
  }).finally(() => { refreshing = null; });
  return refreshing;
}
export async function logout() {
  await clearCache().catch(() => {});
  const tok = await SecureStore.getItemAsync(KEY);
  try { await raw('POST', '/auth/logout', { refresh_token: tok }, false); } catch {}
  await SecureStore.deleteItemAsync(KEY); await AsyncStorage.removeItem('gp_profile'); access = null; session.user = null; session.perms = new Set(); session.pharmacy = null;
}
export async function call(method: string, path: string, body?: unknown): Promise<any> {
  let r: Response;
  try { r = await raw(method, path, body); }
  catch (e: any) { if (e.status === 0 && method === 'GET' && cacheable(path)) { const c = await AsyncStorage.getItem(ck(path)); if (c) return JSON.parse(c).data; } throw e; }
  if (r.status === 401 && (await restore())) r = await raw(method, path, body);
  const d = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, d?.error?.code, d?.error?.message, d?.error?.details);
  if (method === 'GET' && cacheable(path) && d) AsyncStorage.setItem(ck(path), JSON.stringify({ at: Date.now(), data: d })).catch(() => {});
  return d;
}
export const get = (p: string) => call('GET', p);
export const post = (p: string, b: unknown = {}) => call('POST', p, b);

export function money(n: number) {
  const d = session.pharmacy?.currency_decimals ?? 3;
  return `${(n / 10 ** d).toFixed(d)} ${session.pharmacy?.currency ?? ''}`.trim();
}
