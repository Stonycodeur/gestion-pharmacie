import { syncPrefs, stopSync } from './prefsync.js';
import { emit } from './events.js';
import { state, api, get, post, refresh, setSession, can, listen, ApiError, mayHaveSession, endSession, sessionActive } from './api.js';
import { h, clear, toast, fail, formModal, modal, when, icon, skeleton, onePerPage } from './ui.js';
import { t, lang, setLang, languages, loadLanguages, loadPack } from './i18n.js';
import { setBrand, getPrefs, setPrefs, isDark, onTheme } from './theme.js';
import { net, onNet, saveProfile, loadProfile, unlock, wipeAll, setScope, onSent, sync } from './offline.js';
import { personalize, syncCenter } from './personalize.js';
import { notifyBeep, enhancePasswords } from './net.js';
import { nativeReady, nativeLogout, installButton } from './native.js';

const ICON = { help: 'help', files: 'folder', network: 'globe', trash: 'trash', driver: 'car', doctor: 'steth', discover: 'pin', deliveries: 'truck', forecast: 'chart', accounting: 'receipt', finance: 'wallet', dashboard: 'dashboard', pos: 'cart', sales: 'receipt', cash: 'wallet', products: 'pill', stock: 'boxes', purchases: 'truck', inventory: 'clipboard', prescriptions: 'file', customers: 'users', orders: 'bag', reports: 'chart', operations: 'swap', users: 'user', roles: 'shield', audit: 'history', settings: 'sliders', portal: 'store', security: 'lock' };
const TAB_PREF = ['pos', 'dashboard', 'stock', 'prescriptions', 'orders', 'sales', 'portal'];
let brandName = '';
const appName = () => brandName || state.pharmacy?.name || 'Gestion Pharmacie';
// Marque : tuile aux couleurs de l'établissement (suit l'accent choisi)
const logo = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = '<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--brand)"/><stop offset="1" stop-color="var(--brand-2)"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#lg)"/><path d="M26 12h12v14h14v12H38v14H26V38H12V26h14z" fill="var(--brand-ink)"/>'; return s; };
const offlineNow = () => !net.online;

const app = document.getElementById('app');
const NAV = [
  ['dashboard', 'Tableau de bord', 'dashboard.view'], ['pos', 'Caisse / Vente', 'sales.create'], ['sales', 'Ventes', 'sales.view'], ['cash', 'Ma caisse', 'cash.use|cash.view_all'],
  ['-', 'Pharmacie'], ['products', 'Produits', 'products.view'], ['stock', 'Stock', 'stock.view'], ['purchases', 'Achats', 'purchases.view'], ['inventory', 'Inventaires', 'inventory.manage'],
  ['-', 'Patients'], ['deliveries', 'Livraisons', 'deliveries.view'], ['prescriptions', 'Ordonnances', 'prescriptions.view'], ['customers', 'Clients', 'customers.view'], ['orders', 'Commandes', 'orders.view'],
  ['-', 'Pilotage'], ['reports', 'Rapports', 'reports.view'], ['forecast', 'Prévisions', 'forecast.view'], ['accounting', 'Comptabilité', 'accounting.view'], ['finance', 'Finance & API', 'finance.admin'], ['operations', 'Opérations', 'transfers.manage|transfers.receive|supplier_returns.manage|supplier_payments.manage|accounting.view'],
  ['-', 'Administration'], ['users', 'Utilisateurs', 'users.manage'], ['roles', 'Rôles & droits', 'users.manage'], ['audit', 'Journal d\'audit', 'audit.view'], ['settings', 'Paramètres', 'settings.manage'],
  ['-', 'Réseau'], ['help', 'Centre d\'aide', 'help.view|portal.use|driver.use'], ['files', 'Fichiers', 'files.view'], ['network', 'Établissements & pays', 'pharmacies.manage'], ['trash', 'Corbeille', 'trash.manage'],
  ['driver', 'Espace chauffeur', 'driver.use'], ['doctor', 'Espace médecin', 'doctor.use'],
  ['portal', 'Mon espace', 'portal.use|portal.guest'], ['discover', 'Pharmacies', 'portal.use|portal.guest'],
];
const EXTRA = { security: 'Sécurité', profile: 'Mon profil' };
const allowed = (perm) => !perm || perm.split('|').some(can);
// Une vue du menu exige le droit « view.<id> » (Rôles & droits) ET la fonction correspondante.
const navOk = (id, perm) => can('view.' + id) && allowed(perm);
let current = null, sse = null;

// ---------- connexion ----------
function loginScreen(msg) {
  clear(app); let needOtp = false;
  const email = h('input', { type: 'email', required: true, autocomplete: 'username', value: '' }), pw = h('input', { type: 'password', required: true, autocomplete: 'current-password' }), otp = h('input', { inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 6, pattern: '[0-9]{6}' });
  const otpRow = h('label', { class: 'f', style: { display: 'none' } }, t('Code de double authentification'), otp);
  const err = h('div', { class: 'alert bad', role: 'alert', style: { display: msg ? '' : 'none' } }, msg || '');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.style.display = 'none';
    try { const d = await api('POST', '/auth/login', { email: email.value, password: pw.value, otp: needOtp ? otp.value : undefined }); setSession(d); await boot(d); saveProfile(email.value, pw.value, d, state.pharmacy).catch(() => {}); }
    catch (er) { if (er.code === 'OTP_REQUIRED') { needOtp = true; otpRow.style.display = ''; otp.focus(); return; } err.textContent = er.status === 0 ? 'Hors connexion : utilisez le déverrouillage hors ligne si cet appareil a déjà été utilisé.' : er.message; err.style.display = ''; }
  } }, err, h('label', { class: 'f' }, t('E-mail'), email), h('label', { class: 'f' }, t('Mot de passe'), pw), otpRow, h('button', { class: 'btn primary block' }, icon('arrow', { size: 18 }), t('Se connecter')), h('div', { style: { marginTop: '12px', textAlign: 'center' } }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); forgotScreen(); } }, 'Mot de passe oublié ?')));
  const langSel = h('select', { 'aria-label': t('Langue'), onchange: async (e) => { setLang(e.target.value); await loadPack(e.target.value); loginScreen(); } }, languages().map(([v, l]) => h('option', { value: v, selected: v === lang }, l)));
  const reg = h('button', { class: 'btn sm', type: 'button', onclick: registerModal }, icon('user', { size: 16 }), 'Créer un compte client');
  const guest = h('button', { class: 'btn block', type: 'button', style: { marginTop: '10px' }, onclick: async (e) => { const gb = e.currentTarget; gb.disabled = true; try { const cid = await askCountry(); if (cid === null) { gb.disabled = false; return; } const d = await api('POST', '/auth/guest', { country_id: cid || undefined }); setSession(d); await boot(d); } catch (er) { err.textContent = er.message; err.style.display = ''; gb.disabled = false; } } }, icon('user', { size: 18 }), 'Continuer en tant qu\'invité');
  app.append(h('main', { class: 'login' }, h('div', { class: 'card' }, h('div', { class: 'brand' }, logo(), h('span', {}, appName())), h('h1', {}, t('Connexion')), form, guest, h('div', { class: 'row between', style: { marginTop: '14px' } }, reg, langSel), (() => { const b = installButton(appName(), 'btn sm block'); return b ? h('div', { style: { marginTop: '10px' } }, b) : null; })())));
  email.focus();
}
// Mot de passe oublié / réinitialisation par lien e-mail
function forgotScreen() {
  clear(app); const email = h('input', { type: 'email', required: true, autocomplete: 'username' }); const msg = h('div', { class: 'alert info', style: { display: 'none' } });
  const form = h('form', { onsubmit: async (e) => { e.preventDefault(); try { const r = await api('POST', '/auth/forgot', { email: email.value }); msg.textContent = r.message; msg.style.display = ''; } catch (er) { msg.className = 'alert bad'; msg.textContent = er.message; msg.style.display = ''; } } },
    h('p', { class: 'muted' }, 'Saisissez l\'e-mail de votre compte : vous recevrez un lien valable 1 heure.'), msg, h('label', { class: 'f' }, t('E-mail'), email), h('button', { class: 'btn primary block' }, icon('arrow', { size: 18 }), 'Envoyer le lien'), h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => loginScreen() }, icon('left', { size: 14 }), 'Retour')));
  app.append(h('main', { class: 'login' }, h('div', { class: 'card' }, h('div', { class: 'brand' }, logo(), h('span', {}, appName())), h('h1', {}, 'Mot de passe oublié'), form))); email.focus();
}
function resetScreen(token) {
  clear(app); const pw = h('input', { type: 'password', required: true, autocomplete: 'new-password', minLength: 10 }), pw2 = h('input', { type: 'password', required: true, autocomplete: 'new-password' }); const err = h('div', { class: 'alert bad', style: { display: 'none' } });
  const form = h('form', { onsubmit: async (e) => { e.preventDefault(); err.style.display = 'none'; if (pw.value !== pw2.value) { err.textContent = 'Les deux mots de passe diffèrent'; err.style.display = ''; return; }
    try { await api('POST', '/auth/reset', { token, password: pw.value }); history.replaceState(null, '', location.pathname); toast('Mot de passe modifié : connectez-vous'); loginScreen(); } catch (er) { err.textContent = er.message; err.style.display = ''; } } },
    err, h('label', { class: 'f' }, 'Nouveau mot de passe', pw), h('label', { class: 'f' }, 'Confirmer', pw2), h('p', { class: 'muted' }, '10 caractères minimum, avec majuscule, minuscule et chiffre.'), h('button', { class: 'btn primary block' }, icon('check', { size: 18 }), 'Enregistrer'));
  app.append(h('main', { class: 'login' }, h('div', { class: 'card' }, h('div', { class: 'brand' }, logo(), h('span', {}, appName())), h('h1', {}, 'Nouveau mot de passe'), form))); pw.focus();
}
// Appareil hors connexion déjà utilisé : déverrouillage par mot de passe (vérificateur local), accès aux données en cache
function unlockScreen(profile) {
  clear(app);
  const email = h('input', { type: 'email', required: true, value: profile.email, autocomplete: 'username' }), pw = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const err = h('div', { class: 'alert bad', role: 'alert', style: { display: 'none' } });
  const form = h('form', { onsubmit: async (e) => { e.preventDefault(); err.style.display = 'none'; const p = await unlock(email.value, pw.value);
    if (!p) { err.textContent = 'E-mail ou mot de passe incorrect'; err.style.display = ''; return; }
    state.offline = true; state.token = null; state.user = p.user; state.perms = new Set(p.permissions || []); state.pharmacy = p.pharmacy; setScope(p.user.id); shell(); if (!location.hash || location.hash === '#/login') location.hash = '#/' + (can('pos') || can('sales.create') ? 'pos' : 'dashboard'); render(); } },
    h('div', { class: 'alert warn' }, icon('wifioff', { size: 18 }), h('span', {}, 'Vous êtes hors connexion. Déverrouillez avec votre mot de passe habituel pour utiliser les données enregistrées sur cet appareil et encaisser des ventes qui seront synchronisées plus tard.')),
    err, h('label', { class: 'f' }, t('E-mail'), email), h('label', { class: 'f' }, t('Mot de passe'), pw), h('button', { class: 'btn primary block' }, icon('lock', { size: 18 }), 'Déverrouiller hors ligne'),
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => location.reload() }, icon('refresh', { size: 16 }), 'Réessayer la connexion')));
  app.append(h('main', { class: 'login' }, h('div', { class: 'card' }, h('div', { class: 'brand' }, logo(), h('span', {}, appName())), h('h1', {}, 'Mode hors connexion'), form))); pw.focus();
}
// Premier lancement : aucun compte n'existe → création de l'établissement et du super-administrateur
function setupScreen(st) {
  clear(app);
  const f = {}; const inp = (k, label, props = {}) => h('label', { class: 'f' }, label, f[k] = h('input', { ...props }));
  const err = h('div', { class: 'alert bad', role: 'alert', style: { display: 'none' } });
  const form = h('form', { onsubmit: async (e) => { e.preventDefault(); err.style.display = 'none';
    if (f.password.value !== f.password2.value) { err.textContent = 'Les mots de passe ne correspondent pas'; err.style.display = ''; return; }
    try { await fetch('/api/v1/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-setup-token': f.token?.value || '' }, body: JSON.stringify({ pharmacy: { name: f.pname.value, address: f.address.value, phone: f.phone.value, currency: f.currency.value, currency_decimals: Number(f.dec.value), timezone: f.tz.value }, admin: { name: f.name.value, email: f.email.value, password: f.password.value } }) }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error?.message || 'Erreur'); });
      toast('Système configuré : connectez-vous'); loginScreen(); } catch (er) { err.textContent = er.message; err.style.display = ''; } } },
    err, h('h2', {}, 'Votre pharmacie'), inp('pname', 'Nom de la pharmacie *', { required: true }), inp('address', 'Adresse'), inp('phone', 'Téléphone'),
    h('div', { class: 'row' }, inp('currency', 'Devise', { value: 'TND', required: true, style: { width: '90px' } }), inp('dec', 'Décimales', { type: 'number', min: 0, max: 4, value: 3, style: { width: '90px' } }), inp('tz', 'Fuseau horaire', { value: Intl.DateTimeFormat().resolvedOptions().timeZone })),
    h('h2', { style: { marginTop: '16px' } }, 'Compte super-administrateur'), inp('name', 'Nom complet *', { required: true }), inp('email', 'E-mail *', { type: 'email', required: true, autocomplete: 'username' }),
    inp('password', 'Mot de passe *', { type: 'password', required: true, autocomplete: 'new-password' }), inp('password2', 'Confirmer le mot de passe *', { type: 'password', required: true, autocomplete: 'new-password' }), h('small', { class: 'muted' }, '10 caractères minimum, avec majuscule, minuscule et chiffre.'),
    st.token_required ? inp('token', 'Jeton de première configuration (SETUP_TOKEN)', { required: true }) : null, h('button', { class: 'btn primary', style: { width: '100%', justifyContent: 'center', marginTop: '12px' } }, 'Créer et démarrer'));
  app.append(h('main', { class: 'login' }, h('div', { class: 'card', style: { width: 'min(520px,100%)' } }, h('div', { class: 'brand' }, logo(), h('span', {}, 'Gestion Pharmacie')), h('h1', {}, 'Première configuration'), h('p', { class: 'sub' }, 'Aucun compte n\'existe encore. Créez votre établissement et le compte super-administrateur ; vous créerez ensuite les autres comptes dans Administration → Utilisateurs.'), form)));
  f.pname.focus();
}
// Pays du client : proposé uniquement parmi les pays où une pharmacie existe ; ne demande rien s'il n'y en a qu'un seul.
async function askCountry() {
  const cs = await api('GET', '/countries?with_pharmacy=1').catch(() => []); if (cs.length <= 1) return cs[0]?.id || 0;
  let done = false; return new Promise((res) => { formModal('Votre pays', [{ name: 'country_id', label: 'Pays', type: 'select', required: true, value: cs[0].id, options: cs.map((c) => ({ value: c.id, label: c.name_fr })) }], async (v) => { done = true; res(Number(v.country_id)); }, { submitLabel: 'Continuer', onClose: () => { if (!done) res(null); } }); });
}
async function registerModal() {
  const cs = await api('GET', '/countries?with_pharmacy=1').catch(() => []);
  if (!cs.length) return toast('Aucune pharmacie n\'est encore disponible : l\'inscription est impossible pour le moment', true);
  formModal('Créer un compte client', [{ name: 'country_id', label: 'Votre pays', type: 'select', required: true, value: cs[0].id, options: cs.map((c) => ({ value: c.id, label: c.name_fr })), hint: 'Vous aurez accès aux pharmacies de ce pays' }, { name: 'name', label: 'Nom', required: true }, { name: 'email', label: 'E-mail', type: 'email', required: true }, { name: 'phone', label: 'Téléphone', type: 'phone' }, { name: 'password', label: 'Mot de passe', type: 'password', required: true, hint: '10 caractères min., majuscule, minuscule, chiffre' }, { name: 'marketing_consent', label: 'J\'accepte de recevoir des communications (facultatif)', type: 'checkbox' }],
    async (v) => { await post('/auth/register', v); toast('Compte créé, vous pouvez vous connecter'); });
}

// ---------- démarrage ----------
async function boot(d) {
  state.offline = false;
  const me = await get('/auth/me'); state.pharmacy = me.pharmacy; state.user = me.user; nativeReady(me.user, post);
  if (d?.mfa_setup_required || me.mfa_setup_required) { shell(); location.hash = '#/security'; return render(); }
  if (state.user.must_change_password) { shell(); await forcePasswordChange(); }
  if (can('portal.use') || can('portal.guest')) { try { const c = JSON.parse(localStorage.getItem('gp.portal.pharmacy') || 'null'); state.phOverride = c?.id || null; } catch { state.phOverride = null; } }
  shell(); syncPrefs();
  if (!location.hash || location.hash === '#/login') location.hash = '#/' + (can('portal.use') || can('portal.guest') ? 'portal' : can('driver.use') ? 'driver' : can('doctor.use') ? 'doctor' : can('dashboard.view') ? 'dashboard' : 'security');
  render(); sse?.abort(); sse = new AbortController(); listen((ev, data) => { emit(ev, data); if (ev === 'notification') { toast(data.title, false, { onclick: () => openNotification(data) }); notifyBeep(); loadNotifs(); } }, sse.signal);
}
function forcePasswordChange() {
  return new Promise((res) => formModal('Changer le mot de passe', [{ name: 'current', label: 'Mot de passe actuel', type: 'password', required: true }, { name: 'password', label: 'Nouveau mot de passe', type: 'password', required: true }],
    async (v) => { await post('/auth/change-password', v); await refresh().catch(() => {}); state.user.must_change_password = false; toast('Mot de passe modifié'); res(); }));
}

// ---------- coque ----------
let notifBox, bellN, tabN, netChip, offbar, titleEl;
const initials = (n) => (n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
function dropdown(btn, content) { const box = h('div', { class: 'dropdown', hidden: true }, content); const wrap = h('div', { class: 'bell' }, btn, box); btn.addEventListener('click', (e) => { e.stopPropagation(); const open = box.hidden; document.querySelectorAll('.dropdown').forEach((d) => (d.hidden = true)); box.hidden = !open; }); return { wrap, box }; }
function shell() {
  clear(app);
  const items = NAV.filter(([id, , perm]) => id === '-' || navOk(id, perm));
  const nav = h('nav', { class: 'nav', 'aria-label': 'Navigation principale' });
  for (const [id, label] of items) {
    if (id === '-') { nav.append(h('div', { class: 'grp' }, t(label))); continue; }
    nav.append(h('a', { href: '#/' + id, 'data-id': id, 'data-label': t(label), title: t(label) }, icon(ICON[id] || 'dashboard', { size: 20 }), h('span', {}, t(label))));
  }
  [...nav.querySelectorAll('.grp')].forEach((g) => { if (!g.nextElementSibling || g.nextElementSibling.classList.contains('grp')) g.remove(); });
  nav.append(h('a', { href: '#/security', 'data-id': 'security', 'data-label': t('Sécurité'), title: t('Sécurité') }, icon('lock', { size: 20 }), h('span', {}, t('Sécurité'))));
  const side = h('aside', { class: 'side', id: 'side' }, h('div', { class: 'brand' }, logo(), h('span', {}, appName())), nav);

  // --- barre d'onglets mobile (+ feuille « Plus ») ---
  const pages = items.filter(([id]) => id !== '-').map(([id, l]) => [id, l]); pages.push(['security', 'Sécurité']);
  let primary = TAB_PREF.filter((id) => pages.some(([x]) => x === id)).slice(0, pages.length <= 5 ? 5 : 4);
  if (pages.length <= 5) primary = pages.map(([id]) => id);
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Navigation mobile' });
  primary.forEach((id) => { const l = pages.find(([x]) => x === id)[1]; tabbar.append(h('a', { href: '#/' + id, 'data-id': id }, icon(ICON[id] || 'dashboard', { size: 23 }), h('span', {}, t(l)))); });
  tabN = h('span', { class: 'n', hidden: true });
  const sheetBg = h('div', { class: 'sheet-bg', hidden: true, onclick: () => closeSheet() });
  const closeSheet = () => { sheetBg.hidden = true; clear(sheetBg); };
  const openSheet = () => {
    clear(sheetBg); let grp = null; const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Menu', onclick: (e) => e.stopPropagation() });
    const tiles = () => h('div', { class: 'tiles' }); let cur = tiles();
    for (const [id, label] of items) { if (id === '-') { if (cur.children.length) sheet.append(cur); sheet.append(h('h3', {}, t(label))); cur = tiles(); continue; } cur.append(h('a', { href: '#/' + id, 'data-id': id, 'aria-current': location.hash === '#/' + id ? 'page' : null, onclick: closeSheet }, icon(ICON[id] || 'dashboard', { size: 24 }), t(label))); }
    cur.append(h('a', { href: '#/security', onclick: closeSheet }, icon('lock', { size: 24 }), t('Sécurité'))); sheet.append(cur);
    sheet.append(h('h3', {}, t('Compte')), h('div', { class: 'tiles' },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); closeSheet(); personalize({ onLang: () => { shell(); render(); } }); } }, icon('palette', { size: 24 }), t('Personnaliser')),
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); closeSheet(); syncCenter(); } }, icon('refresh', { size: 24 }), t('Synchronisation')),
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); closeSheet(); logout(); } }, icon('logout', { size: 24 }), t('Déconnexion'))));
    sheetBg.append(sheet); sheetBg.hidden = false; paintMenuCounters(lastRows);
  };
  if (pages.length > 5) tabbar.append(h('button', { type: 'button', onclick: openSheet, 'aria-label': t('Plus') }, icon('apps', { size: 23 }), h('span', {}, t('Plus')), tabN));

  // --- barre supérieure ---
  titleEl = h('div', { class: 'grow' }, appName());
  netChip = h('button', { class: 'chip-net', type: 'button', onclick: () => syncCenter() }); offbar = h('div', { class: 'offbar', role: 'status' });
  bellN = h('span', { class: 'n', hidden: true }); notifBox = h('div', { class: 'dropdown', hidden: true });
  const bellBtn = h('button', { class: 'iconbtn', 'aria-label': t('Notifications'), onclick: (e) => { e.stopPropagation(); const o = notifBox.hidden; document.querySelectorAll('.dropdown').forEach((d) => (d.hidden = true)); notifBox.hidden = !o; } }, icon('bell', { size: 21 }), bellN);
  const bell = h('div', { class: 'bell' }, bellBtn, notifBox);
  const phSel = can('pharmacies.manage') ? h('select', { id: 'phsel', 'aria-label': t('Établissement'), style: { maxWidth: '180px' }, onchange: async (e) => { state.phOverride = Number(e.target.value); const me = await get('/auth/me'); state.pharmacy = me.pharmacy; render(); } }) : null;
  if (phSel) get('/pharmacies').then((l) => l.forEach((p) => phSel.append(h('option', { value: p.id, selected: p.id === state.pharmacy?.id }, p.name)))).catch(() => {});
  const mi = (ic, label, fn, cls = '') => h('button', { class: 'mi ' + cls, onclick: () => { document.querySelectorAll('.dropdown').forEach((d) => (d.hidden = true)); fn(); } }, icon(ic, { size: 18 }), label);
  const acct = dropdown(h('button', { class: 'avatar', 'aria-label': state.user.name, title: state.user.name }, state.user.avatar_url ? h('img', { class: 'avatar-img', src: state.user.avatar_url, alt: '' }) : initials(state.user.name)), h('div', {},
    h('div', { class: 'it' }, h('strong', {}, state.user.name), h('div', { class: 'muted' }, state.user.email || state.user.role || '')),
    mi('user', t('Mon profil'), () => { location.hash = '#/profile'; }), mi('palette', t('Personnaliser'), () => personalize({ onLang: () => { shell(); render(); } })), mi('refresh', t('Synchronisation'), () => syncCenter()), ...(installButton() ? [mi('download', t('Installer l\'application'), () => installButton().click())] : []),
    mi(isDark() ? 'sun' : 'moon', t('Thème'), () => setPrefs({ mode: isDark() ? 'light' : 'dark' })), mi('logout', t('Déconnexion'), logout, 'danger')));
  const top = h('header', { class: 'top' }, titleEl, phSel, netChip, bell, acct.wrap);
  const impbar = state.impersonating ? h('div', { class: 'impbar', role: 'alert' }, icon('user', { size: 16 }), h('span', {}, `Prise de contrôle : vous agissez en tant que ${state.user.name} (${state.user.role}) — actions journalisées`), h('button', { class: 'btn sm', onclick: async () => { try { const d = await refresh(); location.hash = ''; await boot(d); } catch (e) { fail(e); } } }, icon('logout', { size: 14 }), 'Quitter')) : null;
  app.append(h('div', { class: 'shell' }, side, h('div', { class: 'main' }, impbar, top, offbar, h('main', { class: 'content', id: 'content', tabIndex: -1 }))), tabbar, sheetBg);
  paintNet(); loadNotifs();
}
function paintNet() {
  if (!netChip) return; const n = net;
  clear(netChip); netChip.className = 'chip-net';
  const cnt = n.pending + n.conflicts;
  if (n.syncing) { netChip.classList.add('sync'); netChip.append(icon('refresh', { size: 15 }), t('Synchronisation…')); }
  else if (!n.online) { netChip.classList.add('off'); netChip.append(icon('wifioff', { size: 15 }), t('Hors ligne') + (cnt ? ` · ${cnt}` : '')); }
  else if (n.conflicts) { netChip.classList.add('bad'); netChip.append(icon('alert', { size: 15 }), `${n.conflicts} ${t('conflit(s)')}`); }
  else if (n.pending) { netChip.classList.add('sync'); netChip.append(icon('upload', { size: 15 }), `${n.pending} ${t('à envoyer')}`); }
  else { netChip.append(icon('wifi', { size: 15 }), h('span', { class: 'gh' }, t('En ligne'))); }
  netChip.title = t('Synchronisation');
  if (offbar) { offbar.classList.toggle('show', !n.online); clear(offbar); if (!n.online) offbar.append(icon('wifioff', { size: 16 }), t('Mode hors connexion : les pages déjà consultées restent disponibles et les ventes sont mises en file d\'attente.')); }
}
// Ouvre une notification : va à la page concernée ; sans page associée, affiche le message complet.
function openNotification(n) {
  if (n.id) post('/notifications/read', { ids: [n.id] }).then(loadNotifs).catch(() => {}); // lue = retirée de la liste
  if (n.link) { const h2 = String(n.link).startsWith('#') ? n.link : '#/' + n.link; if (location.hash === h2) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h2; return; }
  modal(n.title, h('div', {}, n.body ? h('p', { style: { whiteSpace: 'pre-wrap' } }, n.body) : h('p', { class: 'muted' }, 'Aucun détail.'), n.created_at ? h('small', { class: 'muted' }, when(n.created_at)) : null));
}
// Page visée par une notification (« #/orders?id=5 », « /portal?tab=receipts » → orders / portal) et élément précis (id).
const linkPage = (l) => String(l || '').replace(/^#?\/?/, '').split('?')[0];
let lastRows = [];
function paintMenuCounters(rows) {
  lastRows = rows;
  const by = {}; for (const n of rows) { const p = linkPage(n.link); if (p) by[p] = (by[p] || 0) + 1; }
  document.querySelectorAll('.nav a[data-id],.tabbar a[data-id],.sheet a[data-id]').forEach((a) => { let b = a.querySelector('.nbadge'); const c = by[a.dataset.id] || 0; if (!c) { b?.remove(); return; } if (!b) { b = h('span', { class: 'nbadge', 'aria-hidden': 'true' }); a.append(b); } b.textContent = c > 99 ? '99+' : String(c); a.setAttribute('aria-label', `${a.dataset.label || a.textContent} (${c})`); });
}
// Une fois la page affichée, met en évidence (et ouvre) la ligne visée par la notification.
function focusItem(box, id) {
  if (!id) return; let tries = 0; const go = () => { const el = [...box.querySelectorAll('[data-rid]')].find((x) => x.dataset.rid === String(id));
    if (el) { let d = el.closest('details'); while (d) { d.open = true; d = d.parentElement?.closest('details'); } el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 3000); if (el.tagName === 'TR' && el.style.cursor === 'pointer') el.click(); return; }
    if (tries === 3 || tries === 8) box.querySelectorAll('details.past:not([open])').forEach((d) => { d.open = true; }); // l'élément est peut-être dans « passées » (chargé à l'ouverture)
    if (++tries < 25) setTimeout(go, 200); }; go();
}
async function loadNotifs() {
  if (state.offline || !net.online) return;
  try {
    const r = await get(can('dashboard.view') ? '/notifications' : '/portal/notifications'); const rows = (r.data || r).filter((x) => !x.is_read); const unread = rows.length; // une notification lue disparaît de la liste (pas de saturation)
    paintMenuCounters(rows); bellN.textContent = unread; bellN.hidden = !unread; if (tabN) { tabN.textContent = unread; tabN.hidden = !unread; } clear(notifBox);
    notifBox.append(h('div', { class: 'it row between' }, h('strong', {}, t('Notifications')), h('button', { class: 'btn sm', onclick: async () => { await post('/notifications/read', {}); loadNotifs(); } }, icon('check', { size: 14 }), t('Tout marquer comme lu'))));
    rows.slice(0, 30).forEach((n) => notifBox.append(h('div', { class: 'it' + (n.is_read ? '' : ' unread'), 'data-link': n.link || '', role: 'link', tabIndex: 0, onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); }, onclick: (e) => { notifBox.hidden = true; e.currentTarget.remove(); openNotification(n); } }, h('div', {}, n.title), n.body ? h('small', {}, n.body) : null, h('div', {}, h('small', { class: 'muted' }, when(n.created_at))))));
    if (!rows.length) notifBox.append(h('div', { class: 'empty' }, icon('bell'), t('Aucune nouvelle notification')));
  } catch {}
}
async function logout() {
  sse?.abort(); const keep = net.pending + net.conflicts > 0;
  stopSync(); await nativeLogout(api); try { await post('/auth/logout', {}); } catch {} endSession(); state.token = null; state.perms = new Set(); state.offline = false; state.phOverride = null; location.hash = '';
  if (keep) toast('Des ventes hors ligne ne sont pas encore synchronisées : elles restent sur cet appareil.', true); else await wipeAll();
  loginScreen();
}

// ---------- routeur ----------
async function render() {
  const id = (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0];
  const box = document.getElementById('content'); if (!box) return;
  document.querySelectorAll('.nav a,.tabbar a').forEach((a) => (a.dataset.id === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const nm = NAV.find(([n]) => n === id)?.[1] || EXTRA[id] || ''; if (titleEl) titleEl.textContent = nm ? t(nm) : appName(); document.title = (nm ? t(nm) + ' · ' : '') + appName(); window.__gpx = { page: nm ? t(nm) : '', view: '' }; // contexte des exports : page › vue
  const known = !!EXTRA[id] || NAV.some(([n, , p]) => n === id && navOk(n, p));
  if (!known) { clear(box).append(h('div', { class: 'alert bad' }, 'Page indisponible ou accès refusé.')); return; }
  clear(box).append(skeleton(5));
  const token = (current = Symbol());
  try {
    const mod = await import(`./pages/${id}.js`); if (token !== current) return;
    const out = h('div', {}); await mod.default(out); if (token !== current) return; clear(box).append(out); focusItem(box, new URLSearchParams(location.hash.split('?')[1] || '').get('id')); box.focus({ preventScroll: true }); box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
  } catch (e) { if (token !== current) return; clear(box).append(h('div', { class: 'alert bad' }, icon('alert', { size: 18 }), h('span', {}, e.status === 0 ? 'Cette page n\'a pas encore été consultée sur cet appareil : elle n\'est pas disponible hors connexion.' : e.message || String(e)))); if (e.status !== 0) console.error(e); }
}
window.addEventListener('hashchange', () => state.token && render());
{ let q = 0; new MutationObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; try { onePerPage(); } catch { /* cosmétique */ } }); }).observe(document.getElementById('app') || document.body, { childList: true, subtree: true }); }
// Vue courante (onglet actif d'une page) : « Mon espace · Mes commandes » dans l'en-tête et le titre de l'onglet du navigateur.
window.addEventListener('gp:view', (e) => { const id = (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0], nm = NAV.find(([n]) => n === id)?.[1] || EXTRA[id] || ''; if (!nm) return; if (titleEl) { titleEl.textContent = ''; titleEl.append(t(nm), ' ', Object.assign(document.createElement('span'), { className: 'view-crumb', textContent: '› ' + e.detail })); } document.title = e.detail + ' · ' + t(nm) + ' · ' + appName(); window.__gpx = { page: t(nm), view: e.detail }; });

window.addEventListener('gp:impersonate', async (e) => { location.hash = ''; try { await boot(e.detail); } catch (er) { fail(er); } });
// ---------- init ----------
document.addEventListener('click', (e) => { if (!e.target.closest('.bell')) document.querySelectorAll('.dropdown').forEach((d) => (d.hidden = true)); });
// Effet d'onde sur les boutons
document.addEventListener('pointerdown', (e) => { const b = e.target.closest?.('.btn:not(:disabled)'); if (!b || document.documentElement.dataset.motion === 'off') return; const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 0.6, el = h('span', { class: 'rip', style: { width: d + 'px', height: d + 'px', left: e.clientX - r.left - d / 2 + 'px', top: e.clientY - r.top - d / 2 + 'px' } }); b.append(el); setTimeout(() => el.remove(), 600); }, { passive: true });
onNet(() => paintNet());
// Retour du réseau : si la session a été ouverte hors ligne, on la rétablit (cookie de rafraîchissement) puis on synchronise
onNet(async (n) => { if (n.online && state.offline) { try { const d = await refresh(); state.offline = false; toast('Connexion rétablie'); await sync(); loadNotifs(); } catch (er) { if (er.status && er.status !== 0) toast('Reconnectez-vous pour synchroniser vos ventes hors ligne.', true); } } });
onSent((it, r) => { toast(`${r?.number || it.label || ''} · ${t('synchronisée')}`); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});
(async () => {
  await loadLanguages().catch(() => {});
  try { const b = await fetch('/api/v1/branding').then((r) => (r.ok ? r.json() : null)); if (b) { brandName = b.name || ''; setBrand(b.color); } } catch { const c = await loadProfile(); if (c?.pharmacy?.name) brandName = c.pharmacy.name; }
  const rt = location.hash.match(/^#\/reset\?token=([\w-]+)/); if (rt) return resetScreen(rt[1]);
  try { if (!mayHaveSession() || !(await sessionActive())) throw new ApiError(401, null); const d = await refresh(); await boot(d); }
  catch (e) {
    if (e.status === 0) { const p = await loadProfile(); if (p) return unlockScreen(p); return loginScreen('Hors connexion : première connexion impossible sans réseau.'); }
    try { const st = await api('GET', '/auth/setup-status'); st.needed ? setupScreen(st) : loginScreen(); } catch { loginScreen(); }
  }
})();

// Photo détourée : si les coins de l'image sont transparents, on affiche seulement la personne (sans cadre ni fond).
document.addEventListener('load', (e) => { const im = e.target; if (!(im instanceof HTMLImageElement) || !/avatar/.test(im.className) || !im.naturalWidth) return;
  try { const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 16, 16); const px = [0, 15].flatMap((a) => [0, 15].map((b) => x.getImageData(a, b, 1, 1).data[3])); im.classList.toggle('cutout', px.every((a) => a < 40)); } catch { /* image d'une autre origine : cadre normal */ } }, true);
