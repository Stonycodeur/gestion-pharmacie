import { get, post, put } from '../api.js';
import { h, clear, money, table, badge, fail, toast, when, statusBadge, tabs, debounce, fileToBase64, modal, icon } from '../ui.js';
import { t } from '../i18n.js';
import { onEvent } from '../events.js';
import { soft } from '../silent.js';
import * as X from './portal_extra.js';
import { state, can } from '../api.js';
import discover, { chosenPharmacy, choosePharmacy } from './discover.js';
import { filePicker, flagImg } from '../net.js';
import { compose, openTicket } from './help.js';

export default async function (box) {
  let tab = 'home'; const head = h('div'), body = h('div'), bar = h('div'); const cart = []; const guest = !can('portal.use');
  const paintBar = () => { const c = chosenPharmacy(); clear(bar).append(...(guest ? [h('div', { class: 'alert info', style: { marginBottom: '10px' } }, icon('user', { size: 16 }), h('span', {}, ' Mode invité : pas d\'historique ni de privilèges (fidélité, ordonnances, rendez-vous). '), h('button', { class: 'btn sm', onclick: async () => { try { await post('/auth/logout', {}); } catch {} location.hash = ''; location.reload(); } }, 'Créer un compte'))] : []),
    h('div', { class: 'row between card', style: { padding: '8px 12px', marginBottom: '10px' } }, h('span', {}, icon('pin', { size: 16 }), ' Pharmacie : ', h('strong', {}, c?.name || state.pharmacy?.name || 'aucune choisie')), h('button', { class: 'btn sm', onclick: () => show('discover') }, 'Changer / trouver la plus proche'))); };
  const TABS = [['home', 'Accueil'], ['discover', 'Pharmacies'], ['catalog', 'Catalogue'], ['orders', 'Mes commandes'], ['receipts', 'Mes reçus'], ['subscriptions', 'Abonnements'], ['deliveries', 'Livraisons'], ...(guest ? [] : [['rx', 'Mes ordonnances'], ['appts', 'Rendez-vous'], ['help', 'Aide']]), ['custom', 'Personnaliser']];
  const show = (id) => { tab = id; body.dataset.tab = id; clearInterval(body._iv); paintBar(); clear(head).append(tabs(TABS, tab, show)); clear(body); return views[tab]().catch(fail); };
  const views = {
    async catalog() {
      const q = h('input', { type: 'search', placeholder: t('Rechercher'), 'aria-label': t('Rechercher') }), list = h('div'), cartBox = h('div'); const note = h('textarea', { rows: 2, maxLength: 500, placeholder: 'Message pour la pharmacie (heure de passage, précision…) — modifiable ensuite dans « Mes commandes »' });
      const drawCart = () => { clear(cartBox).append(cart.length ? h('div', { class: 'card' }, h('h3', {}, 'Ma réservation'), cart.map((c) => h('div', { class: 'row between' }, c.name, h('span', {}, h('input', { type: 'number', min: 1, value: c.qty, style: { width: '60px' }, onchange: (e) => (c.qty = Number(e.target.value)) }), h('button', { class: 'btn sm', onclick: () => { cart.splice(cart.indexOf(c), 1); drawCart(); } }, icon('x', { size: 14 }))))), note, h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: async () => { try { const r = await post('/portal/orders', { lines: cart.map((c) => ({ product_id: c.id, qty: c.qty })), notes: note.value || undefined }); cart.length = 0; note.value = ''; drawCart(); toast(`Réservation ${r.number} — à retirer avant le ${when(r.expires_at)}`); } catch (e) { fail(e); } } }, 'Réserver')) : ''); };
      async function load() { const r = await get('/portal/catalog?q=' + encodeURIComponent(q.value)); clear(list).append(table([{ label: 'Produit', render: (p) => h('span', {}, h('strong', {}, p.name), h('div', { class: 'muted' }, [p.dci, p.dosage].filter(Boolean).join(' · '))) }, { label: 'Prix', num: true, render: (p) => money(p.sale_price) }, { label: 'Disponibilité', render: (p) => badge(p.available ? 'Disponible' : 'Indisponible', p.available ? 'ok' : 'bad') }, { label: '', render: (p) => (p.rx_status !== 'free' ? badge('Sur ordonnance', 'warn') : h('button', { class: 'btn sm', disabled: !p.available, onclick: () => { cart.push({ id: p.id, name: p.name, qty: 1 }); drawCart(); } }, 'Réserver')) }], r)); }
      q.oninput = debounce(load); body.append(q, cartBox, h('div', { style: { marginTop: '12px' } }, list), h('p', { class: 'muted' }, 'Les produits sur ordonnance se délivrent après dépôt et validation de votre ordonnance par le pharmacien. Ce service ne remplace pas un conseil médical : en cas de doute, consultez un professionnel de santé.')); await load();
    },
    discover: () => discover(body, { embedded: true, onChosen: () => { cart.length = 0; show('catalog'); } }),
    receipts: () => import('./payments2.js').then((m) => m.receiptsList(body)),
    subscriptions: () => import('./portal_extra.js').then((m) => m.subscriptions(body)),
    appts: () => X.appointments(body), help: () => X.help(body),
    home: () => X.home(body, show), orders: (silent) => X.orders(body, show, silent === true), deliveries: () => X.deliveries(body), custom: () => X.custom(body),
    async rx() {
      const pick = filePicker({ label: 'Photo (JPG/PNG) ou PDF, 3 Mo max — aperçu avant envoi' }), list = h('div'); const subj = h('input', { maxLength: 160, placeholder: 'Objet (ex. Traitement hypertension)' }), msg = h('textarea', { rows: 3, maxLength: 500, placeholder: 'Message personnalisé pour le pharmacien (facultatif)' });
      const load = async () => clear(list).append(table([{ label: 'N°', key: 'number' }, { label: 'Objet', render: (o) => h('span', {}, h('strong', {}, o.subject || '—'), o.notes ? h('div', { class: 'muted' }, o.notes) : null) }, { label: 'Déposée', render: (o) => when(o.created_at) }, { label: 'Statut', render: (o) => statusBadge('prescription', o.status) }, { label: 'Réponse', key: 'status_reason' }], await get('/portal/prescriptions'), { empty: 'Aucune ordonnance déposée' }));
      body.append(h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', {}, t('Déposer une ordonnance')), h('p', { class: 'muted' }, 'Un pharmacien vérifie chaque ordonnance avant toute délivrance (aucune validation automatique).'), h('label', { class: 'f' }, 'Objet', subj), h('label', { class: 'f' }, 'Message', msg), pick.el,
        h('button', { class: 'btn primary', style: { marginTop: '8px' }, onclick: async () => { if (!pick.file) return toast('Choisissez un fichier', true); try { const r = await post('/portal/prescriptions', { subject: subj.value || undefined, notes: msg.value || undefined, file: await pick.payload() }); toast(`Ordonnance ${r.number} déposée`); subj.value = ''; msg.value = ''; show('rx'); } catch (e) { fail(e); } } }, 'Envoyer')), list); await load();
    },
  };
  box.append(h('h1', {}, t('Mon espace')), head, body); const q = new URLSearchParams((location.hash.split('?')[1] || '')); if (q.get('paid')) toast(t('Paiement en cours de confirmation par la banque — le statut se met à jour automatiquement')); if (q.get('cancelled')) toast(t('Paiement annulé'), true); show(q.get('tab') && TABS.some((x) => x[0] === q.get('tab')) ? q.get('tab') : q.get('paid') || q.get('cancelled') ? 'orders' : (guest && !chosenPharmacy() ? 'discover' : 'home')); onEvent('order', (d) => { if (d.payment === 'paid') toast(t('Paiement confirmé'));  if (tab === 'orders') soft(body, () => views.orders(true)); }, box); // mise à jour sur place : on ne change JAMAIS d'onglet
}
