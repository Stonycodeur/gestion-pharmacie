// Pont avec l'application mobile (coque Expo/WebView) et installation du raccourci (PWA).
// Hors application mobile, rien de ce qui concerne le pont ne s'exécute.
import { h, toast } from './ui.js';

export const inApp = () => !!window.ReactNativeWebView;
const send = (m) => { try { window.ReactNativeWebView?.postMessage(JSON.stringify(m)); } catch { /* hors application */ } };

// ----- Application mobile : jeton push, navigation depuis une notification, retour -----
let post = null, lastToken = null;
export function nativeReady(user, apiPost) {
  if (!inApp()) return; post = apiPost;
  window.__native = {
    push: async (token, platform) => { lastToken = token; try { await post('/me/push-token', { token, platform: platform === 'ios' ? 'ios' : 'android' }); } catch { /* le push reste facultatif */ } },
    go: (link) => { if (typeof link === 'string' && /^#?\/[\w\-/?=&.%]*$/.test(link)) location.hash = link.startsWith('#') ? link : '#' + link; },
  };
  send({ type: 'ready', user: { id: user.id, role: user.role } });
}
// Retire le jeton push de ce compte avant la déconnexion (sinon l'appareil recevrait les alertes du compte précédent)
export async function nativeLogout(apiCall) { if (!inApp()) return; try { if (lastToken && apiCall) await apiCall('DELETE', '/me/push-token', { token: lastToken }); } catch { /* hors connexion */ } lastToken = null; send({ type: 'logout' }); }
export const nativeShare = (url) => send({ type: 'open-external', url });

// ----- Raccourci installable (navigateur) -----
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; document.dispatchEvent(new Event('gp:installable')); });
window.addEventListener('appinstalled', () => { deferred = null; toast('Application installée'); });
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const canInstall = () => !inApp() && !standalone();

// Bouton « Installer l'application » : invite native si disponible, sinon explication adaptée (iPhone, Firefox, etc.).
export function installButton(name = 'Pharmacie', cls = 'btn sm') {
  if (!canInstall()) return null;
  return h('button', { type: 'button', class: cls, onclick: async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; return; }
    toast(isIos() ? `Safari : bouton Partager, puis « Sur l'écran d'accueil » pour ajouter « ${name} ».` : `Menu du navigateur (⋮), puis « Installer l'application » ou « Ajouter à l'écran d'accueil » pour « ${name} ».`);
  } }, 'Installer l’application');
}
