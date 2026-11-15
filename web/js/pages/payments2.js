// Paiements v2 (interface) : paiement client multi-moyens, reçus (PDF/impression/e-mail/WhatsApp), tableau de bord, catalogue mondial,
// réglages avancés, taux de change, versements et journal antivirus.
import { get, post, put, can, download, blobUrl, state } from '../api.js';
import { h, clear, modal, formModal, fail, toast, table, badge, money, when, icon, confirmDialog } from '../ui.js';
import { t } from '../i18n.js';

const FAMILY = { mobile_money: 'Mobile Money', card: 'Cartes bancaires', wallet: 'Portefeuilles numériques', bank: 'Paiements bancaires', crypto: 'Cryptomonnaies', cash: 'Espèces / à la livraison', transfer: 'Virement', mobile: 'Mobile' };
const fm = (n, dec, cur) => `${(n / 10 ** dec).toFixed(dec)} ${cur}`;

// ---------- client : payer une commande ----------
export async function payDialog(order, reload) {
  const q = await get(`/portal/orders/${order.id}/payment-options`).catch((e) => { fail(e); return null; }); if (!q) return;
  if (q.due < 1) return toast(t('Rien à payer (déjà réglé ou paiement en cours)'), true);
  const M = q.modes || { counter: [], delivery: [], online: q.methods || [] };
  if (!M.counter.length && !M.delivery.length && !M.online.length) return toast(t('Cette pharmacie n\'a pas encore activé de mode de paiement : contactez-la'), true);
  let wants = q.wants_delivery === null || q.wants_delivery === undefined ? null : !!q.wants_delivery, chan = null, pick = null, payer = {}, otpCode = '', otpTimer = null; const fieldsBox = h('div'), list = h('div', { role: 'radiogroup', 'aria-label': t('Moyen de paiement') });
  const drawFields = () => { clear(fieldsBox); payer = {}; if (chan.mode !== 'online') { clearInterval(otpTimer); if (pick.instructions) fieldsBox.append(h('p', { class: 'muted' }, pick.instructions)); return; } for (const f of pick.fields) { const i = h('input', { type: f.type || 'text', required: !!f.required, maxLength: 60, autocomplete: 'off', 'aria-label': f.label, oninput: () => (payer[f.name] = i.value) }); fieldsBox.append(h('label', { class: 'f' }, f.label, f.required ? ' *' : '', i)); }
    clearInterval(otpTimer); if (pick.otp_required) { const msg = h('div', { class: 'muted', 'aria-live': 'polite' }), code = h('input', { inputMode: 'numeric', pattern: '\\d{6}', maxLength: 6, autocomplete: 'one-time-code', placeholder: '______', 'aria-label': t('Code reçu par SMS'), style: { display: 'none', letterSpacing: '6px', textAlign: 'center', maxWidth: '180px' }, oninput: () => (otpCode = code.value.trim()) });
      const send = h('button', { type: 'button', class: 'btn sm', onclick: async () => { send.disabled = true; try { const r = await post(`/portal/orders/${order.id}/pay/otp`, { method_code: pick.code, payer }); let left = r.ttl; code.style.display = ''; code.focus(); if (r.dev_code) toast(`Code (test) : ${r.dev_code}`);
        clearInterval(otpTimer); const tick = () => { if (left <= 0) { clearInterval(otpTimer); msg.textContent = t('Code expiré : demandez-en un nouveau'); send.disabled = false; send.textContent = t('Renvoyer le code'); return; } msg.textContent = `${t('Code envoyé par SMS. Valable encore')} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; left--; }; tick(); otpTimer = setInterval(tick, 1000); } catch (e) { fail(e); send.disabled = false; } } }, icon('message', { size: 14 }), t('Recevoir le code par SMS'));
      fieldsBox.append(h('div', { class: 'card', style: { marginTop: '8px' } }, h('strong', {}, t('Confirmation par code SMS')), h('p', { class: 'muted' }, t('Renseignez votre numéro ci-dessus puis demandez le code. Saisissez-le ici ; ensuite validez le paiement avec votre code secret sur votre téléphone, jamais dans cette application.')), send, h('div', {}, code), msg)); }
    fieldsBox.append(pick.hosted ? h('p', { class: 'muted' }, icon('lock', { size: 14 }), ' ', t('Vous serez redirigé vers la page sécurisée du prestataire : numéro de carte, code de sécurité, PIN ou mot de passe y sont saisis, jamais ici.')) : pick.instructions ? h('p', { class: 'muted' }, pick.instructions) : null); };
  const drawList = () => { clear(list); const groups = new Map(); for (const m of chan.methods) { const g = groups.get(m.family) || []; g.push(m); groups.set(m.family, g); }
    for (const [fam, ms] of groups) list.append(h('h4', { style: { margin: '10px 0 4px' } }, t(FAMILY[fam] || fam)), ...ms.map((m) => h('label', { class: 'pcard', style: { cursor: 'pointer', alignItems: 'center' } }, h('input', { type: 'radio', name: 'pm', style: { width: 'auto' }, checked: m === pick, onchange: () => { pick = m; drawFields(); } }), h('span', { class: 'grow' }, m.label)))); };
  const summary = h('div', { class: 'card', style: { marginBottom: '10px' } }, h('div', { class: 'muted' }, `${t('Commande')} ${q.order_number} · ${q.pharmacy}`),
    ...q.lines.map((l) => h('div', { class: 'row between' }, h('span', {}, `${l.qty} × ${l.label}`, h('div', { class: 'muted' }, `${t('Prix unitaire')} ${fm(l.unit, q.decimals, q.currency)}`)), h('strong', {}, fm(l.total, q.decimals, q.currency)))),
    h('hr'), q.tax ? h('div', { class: 'row between muted' }, t('dont taxes'), fm(q.tax, q.decimals, q.currency)) : null, q.paid ? h('div', { class: 'row between muted' }, t('Déjà payé'), fm(q.paid, q.decimals, q.currency)) : null,
    h('div', { class: 'row between', style: { fontSize: '1.2em' } }, h('strong', {}, t('Montant total à payer')), h('strong', {}, fm(q.due, q.decimals, q.currency))));
  const btn = h('button', { class: 'btn primary', type: 'button' }, icon('lock', { size: 16 }), ' ', t('Payer'), ' ', fm(q.due, q.decimals, q.currency));
  // Étape 1 : « Souhaitez-vous être livré ? » — les modes proposés dépendent de la réponse.
  const kindLabel = { cash: 'Espèces à la livraison', card: 'Carte à la livraison' };
  const channels = () => wants === null ? [] : wants === false
    ? [M.online.length && { key: 'online', label: 'Payer en ligne', mode: 'online', methods: M.online }, M.counter.length && { key: 'counter', label: 'Payer à la caisse', mode: 'counter', methods: M.counter }]
    : [M.delivery.filter((x) => x.kind === 'cash').length && { key: 'cash', label: kindLabel.cash, mode: 'delivery', methods: M.delivery.filter((x) => x.kind === 'cash') },
      M.delivery.filter((x) => x.kind === 'card').length && { key: 'card', label: kindLabel.card, mode: 'delivery', methods: M.delivery.filter((x) => x.kind === 'card') },
      M.delivery.filter((x) => !['cash', 'card'].includes(x.kind)).length && { key: 'other', label: 'Autre moyen à la livraison', mode: 'delivery', methods: M.delivery.filter((x) => !['cash', 'card'].includes(x.kind)) },
      M.online.length && { key: 'online', label: 'Payer en ligne', mode: 'online', methods: M.online }];
  const askBox = h('div', { class: 'card', style: { marginBottom: '10px' } }), chanBox = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px', margin: '8px 0' } }), payBox = h('div');
  const drawChan = () => { clear(chanBox); clear(payBox); const cs = channels().filter(Boolean); if (wants === null) return; if (!cs.length) { chanBox.append(h('p', { class: 'muted' }, t('Aucun mode de paiement n\'est proposé pour ce choix.'))); return; }
    for (const c of cs) chanBox.append(h('button', { type: 'button', class: 'btn' + (chan?.key === c.key ? ' primary' : ''), 'aria-pressed': String(chan?.key === c.key), onclick: () => { chan = c; pick = c.methods[0]; drawChan(); } }, t(c.label)));
    if (chan && !cs.some((c) => c.key === chan.key)) { chan = null; pick = null; }
    if (chan) { clearInterval(otpTimer); payBox.append(h('h3', {}, t('Choisissez votre moyen de paiement')), list, fieldsBox, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, btn)); drawList(); drawFields(); btn.replaceChildren(icon('lock', { size: 16 }), ' ', t(chan.mode === 'online' ? 'Payer' : 'Confirmer'), chan.mode === 'online' ? ' ' + fm(q.due, q.decimals, q.currency) : ''); } };
  const drawAsk = () => { clear(askBox).append(h('strong', {}, t('Souhaitez-vous être livré ?')), h('div', { class: 'row', style: { gap: '8px', marginTop: '8px' } },
    ...[[true, 'Oui'], [false, 'Non']].map(([v, l]) => h('button', { type: 'button', class: 'btn' + (wants === v ? ' primary' : ''), 'aria-pressed': String(wants === v), onclick: () => { wants = v; chan = null; pick = null; post(`/portal/orders/${order.id}/wants-delivery`, { value: v }).catch(() => {}); drawAsk(); drawChan(); } }, t(l)))),
    wants === true && !q.has_delivery ? h('small', { class: 'muted' }, t('Pensez à demander la livraison depuis votre commande (adresse et chauffeur).')) : ''); };
  drawAsk(); drawChan();
  const m = modal(`${t('Payer')} ${q.order_number}`, h('div', {}, summary, askBox, chanBox, payBox), { wide: true, onClose: () => clearInterval(otpTimer) });
  btn.onclick = async () => { if (!pick) return toast(t('Choisissez un moyen de paiement'), true); btn.disabled = true; try {
    if (chan.mode !== 'online') { const r = await post(`/portal/orders/${order.id}/pay-later`, { mode: chan.mode, method_code: pick.code }); m.close(); modal(t('Mode de règlement enregistré'), h('div', {}, h('p', {}, r.instructions), h('p', { class: 'muted' }, t('La pharmacie a été prévenue.')))); reload?.(); return; }
    const res = await post(`/portal/orders/${order.id}/pay`, { method_code: pick.code, payer, otp: pick.otp_required ? otpCode : undefined });
    if (res.mode === 'redirect') { location.href = res.checkout_url; return; }
    clearInterval(otpTimer); m.close(); modal(t('Paiement enregistré'), h('div', {}, h('p', {}, res.instructions), h('p', { class: 'muted' }, t('Vous recevrez une notification, un reçu dans « Mes reçus » et par e-mail dès que la pharmacie aura confirmé la réception.')))); reload?.();
  } catch (e) { fail(e); } finally { btn.disabled = false; } };
}

// ---------- reçus ----------
const open = async (r, print = false) => { try { const u = await blobUrl(`/receipts/${r.id}/pdf`); const w = window.open(u, '_blank'); if (print && w) w.addEventListener('load', () => w.print()); } catch (e) { fail(e); } };
export function receiptActions(r) {
  const link = r.pdf_public_url || ''; const wa = `https://wa.me/?text=${encodeURIComponent(`${t('Reçu de paiement')} ${r.number} — ${r.pharmacy_name || ''} : ${link}`)}`;
  return h('span', { class: 'row', style: { flexWrap: 'wrap' } },
    h('button', { class: 'btn sm', onclick: () => details(r) }, icon('receipt', { size: 14 }), t('Voir')),
    h('button', { class: 'btn sm', 'aria-label': t('Télécharger'), onclick: () => download(`/receipts/${r.id}/pdf`, `${r.number}.pdf`).catch(fail) }, icon('download', { size: 14 }), 'PDF'),
    h('button', { class: 'btn sm', 'aria-label': t('Imprimer'), onclick: () => open(r, true) }, icon('printer', { size: 14 })),
    h('button', { class: 'btn sm', onclick: () => formModal(t('Envoyer le reçu par e-mail'), [{ name: 'to', label: 'Adresse e-mail (vide = la vôtre)', type: 'email' }], async (v) => { await post(`/receipts/${r.id}/email`, { to: v.to || undefined }); toast(t('Reçu envoyé')); }, { submitLabel: 'Envoyer' }) }, icon('mail', { size: 14 }), 'E-mail'),
    h('a', { class: 'btn sm', href: wa, target: '_blank', rel: 'noopener noreferrer' }, icon('message', { size: 14 }), 'WhatsApp'));
}
async function details(r) {
  const v = await get(`/receipts/${r.id}`).catch((e) => { fail(e); return null; }); if (!v) return; const c = v.receipt, qr = h('div'); qr.innerHTML = v.qr_svg;
  modal(`${t('Reçu')} ${c.number}`, h('div', {}, h('div', { class: 'row between' }, h('div', {}, h('strong', {}, v.pharmacy.name), h('div', { class: 'muted' }, [v.pharmacy.address, v.pharmacy.phone].filter(Boolean).join(' · '))), badge(v.valid ? t('Authentique') : t('Altéré'), v.valid ? 'ok' : 'danger')),
    h('p', {}, `${t('Référence')} : `, h('strong', {}, c.reference), h('br'), `${t('Payeur')} : ${c.payer_name || '—'}`, h('br'), `${t('Moyen de paiement')} : ${c.method_label}`, h('br'), `${t('Date')} : ${when(c.created_at)}`, h('br'), `${t('Service')} : ${c.service}`),
    ...v.lines.map((l) => h('div', { class: 'row between' }, `${l.qty} × ${l.label}`, fm(l.total, c.decimals, c.currency))), h('hr'), h('div', { class: 'row between', style: { fontSize: '1.2em' } }, h('strong', {}, t('Montant payé')), h('strong', {}, fm(c.amount, c.decimals, c.currency))),
    h('div', { class: 'row', style: { marginTop: '10px', alignItems: 'center' } }, qr, h('div', { class: 'muted' }, t('QR code de vérification'), h('br'), h('a', { href: v.verify_url, target: '_blank', rel: 'noopener noreferrer' }, t('Vérifier l\'authenticité')), h('br'), `${t('Code')} : ${c.code}`)),
    h('div', { style: { marginTop: '10px' } }, receiptActions({ ...c, pdf_public_url: v.pdf_public_url, pharmacy_name: v.pharmacy.name }))), { wide: true });
}
export async function receiptsList(body, { staff = false } = {}) {
  const list = h('div'), q = h('input', { type: 'search', placeholder: t('Rechercher (n° de reçu, référence, nom)'), 'aria-label': t('Rechercher') }); let to;
  const load = async () => { const rows = await get(staff ? `/receipts?q=${encodeURIComponent(q.value)}` : '/portal/receipts'); const f = !staff && q.value ? rows.filter((r) => `${r.number} ${r.reference} ${r.pharmacy_name}`.toLowerCase().includes(q.value.toLowerCase())) : rows;
    clear(list).append(table([{ label: 'N°', render: (r) => h('strong', {}, r.number) }, { label: 'Date', render: (r) => when(r.created_at) }, ...(staff ? [{ label: 'Payeur', key: 'payer_name' }] : [{ label: 'Pharmacie', key: 'pharmacy_name' }]), { label: 'Moyen', key: 'method_label' }, { label: 'Montant', num: true, render: (r) => fm(r.amount, r.decimals, r.currency) }, { label: '', render: receiptActions }], f, { empty: t('Aucun reçu pour le moment') })); };
  q.oninput = () => { clearTimeout(to); to = setTimeout(load, 250); }; body.append(h('div', { class: 'card' }, h('h2', {}, t(staff ? 'Reçus de paiement' : 'Mes reçus')), h('p', { class: 'muted' }, t('Chaque paiement validé génère automatiquement un reçu sécurisé (QR code + sceau électronique), conservé de façon permanente.')), q, h('div', { style: { marginTop: '10px' } }, list))); await load();
}

// ---------- remboursement (personnel) ----------
export function refundDialog(p, done) {
  const left = p.amount - (p.refunded || 0); if (left < 1) return toast(t('Déjà remboursé'), true);
  formModal(`${t('Rembourser')} ${p.order_number || ''}`, [{ name: 'amount', label: `Montant (reste remboursable : ${(left / 10 ** (state.pharmacy?.currency_decimals ?? 2)).toFixed(state.pharmacy?.currency_decimals ?? 2)})`, type: 'money', required: true, value: left }, { name: 'reason', label: 'Motif', required: true }], async (v) => {
    const r = await post(`/online-payments/${p.id}/refund`, v); toast(r.gateway === 'done' ? t('Remboursement effectué chez le prestataire et enregistré') : r.gateway_manual ? t('Remboursement enregistré — ce prestataire n\'a pas d\'API de remboursement : effectuez le retour depuis son tableau de bord') : t('Remboursement enregistré')); done?.(); }, { submitLabel: 'Rembourser' });
}

// ---------- tableau de bord (super-admin : tout le réseau ; personnel : son établissement) ----------
export async function dashboard() {
  const wrap = h('div', { class: 'card', style: { marginTop: '14px' } }); const from = h('input', { type: 'date', 'aria-label': t('Du') }), to = h('input', { type: 'date', 'aria-label': t('Au') });
  const qs = () => `?${new URLSearchParams(Object.entries({ from: from.value, to: to.value }).filter(([, v]) => v)).toString()}`;
  const draw = async () => { const s = await get('/payments/stats' + qs()).catch((e) => { fail(e); return null; }); if (!s) return; const T = s.totals, tile = (l, v, k = '') => h('div', { class: 'card', style: { minWidth: '140px', flex: '1' } }, h('div', { class: 'muted' }, t(l)), h('strong', { style: { fontSize: '1.4em' } }, v), k ? badge(k, 'warn') : null);
    const eur = (v) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} €`; const rows = (a, name) => table([{ label: name, key: 'name' }, { label: 'Paiements', num: true, key: 'count' }, { label: 'Chiffre d\'affaires', num: true, render: (r) => eur(r.revenue_eur) }, { label: 'Remboursé', num: true, render: (r) => eur(r.refunded_eur) }, { label: 'Commissions', num: true, render: (r) => eur(r.commission_eur) }], a, { empty: t('Aucune donnée') });
    clear(wrap).append(h('div', { class: 'row between', style: { flexWrap: 'wrap' } }, h('h2', {}, t('Tableau de bord des paiements')), h('span', { class: 'row', style: { flexWrap: 'wrap' } }, from, to, h('button', { class: 'btn sm', onclick: draw }, icon('refresh', { size: 14 }), t('Actualiser')),
      ...['csv', 'xlsx', 'pdf'].map((f) => h('button', { class: 'btn sm', onclick: () => download('/payments/export' + qs() + (qs() === '?' ? '' : '&') + 'format=' + f, `paiements.${f}`).catch(fail) }, icon('download', { size: 14 }), f.toUpperCase())))),
      h('p', { class: 'muted' }, t('Montants convertis en euros avec les taux ci-dessous.')),
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '10px' } }, tile('Transactions', T.transactions), tile('Payées', T.paid), tile('Échouées', T.failed), tile('En attente', T.pending), tile('Chiffre d\'affaires', eur(T.revenue_eur)), tile('Remboursé', eur(T.refunded_eur)), tile('Commissions perçues', eur(T.commission_eur)), tile('Alertes fraude', T.flagged, T.flagged ? '!' : '')),
      state.user.role === 'super_admin' ? h('div', {}, h('h3', {}, t('Revenus par établissement')), rows(s.by_pharmacy, 'Établissement'), h('h3', {}, t('Revenus par pays')), rows(s.by_country, 'Pays')) : null,
      h('h3', {}, t('Revenus par moyen de paiement')), rows(s.by_method, 'Moyen'),
      h('h3', {}, t('Soldes des établissements')), table([{ label: 'Établissement', key: 'pharmacy' }, { label: 'Net encaissé', num: true, render: (b) => fm(b.net, b.dec, b.currency) }, { label: 'Déjà versé', num: true, render: (b) => fm(b.paid_out, b.dec, b.currency) }, { label: 'Reste à verser', num: true, render: (b) => h('strong', {}, fm(b.due, b.dec, b.currency)) }], s.balances, { empty: t('Aucun encaissement') }),
      h('h3', {}, t('Dernières transactions (journal)')), table([{ label: 'Date', render: (r) => when(r.created_at) }, { label: 'Établissement', key: 'pharmacy' }, { label: 'Moyen', key: 'method' }, { label: 'Statut', render: (r) => badge(r.status, r.status === 'paid' ? 'ok' : r.risk_score >= 40 ? 'danger' : 'info') }, { label: 'Montant', num: true, render: (r) => fm(r.amount, r.dec, r.currency) }, { label: 'IP', key: 'ip' }, { label: 'Risque', render: (r) => (r.risk_score ? badge(String(r.risk_score), r.risk_score >= 40 ? 'danger' : 'warn') : '—') }], s.recent, { empty: t('Aucune transaction') })); };
  await draw(); return wrap;
}

// ---------- super-admin : catalogue, réglages, taux, versements, antivirus ----------
export function catalogDialog(done) {
  get('/payment-catalog').then((cat) => { const sel = new Set(); const groups = new Map(); for (const c of cat) { const g = groups.get(c.family) || []; g.push(c); groups.set(c.family, g); }
    const box = h('div', {}, h('p', { class: 'muted' }, t('Les moyens ajoutés sont créés INACTIFS : configurez-les (prestataire, pays, devises, commission) puis activez-les.')), ...[...groups].flatMap(([fam, cs]) => [h('h4', {}, t(FAMILY[fam] || fam)), h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } }, ...cs.map((c) => h('label', { class: 'badge', style: { cursor: c.added ? 'default' : 'pointer', opacity: c.added ? 0.5 : 1 } }, h('input', { type: 'checkbox', disabled: c.added, style: { width: 'auto', marginRight: '4px' }, onchange: (e) => (e.target.checked ? sel.add(c.code) : sel.delete(c.code)) }), c.label, c.added ? ' ✓' : '')))]));
    const go = h('button', { class: 'btn primary' }, t('Ajouter la sélection')); const m = modal(t('Catalogue mondial des moyens de paiement'), h('div', {}, box, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, go)), { wide: true });
    go.onclick = async () => { try { const r = await post('/payment-catalog/add', { codes: [...sel] }); toast(`${r.added} ${t('moyen(s) ajouté(s)')}`); m.close(); done?.(); } catch (e) { fail(e); } }; }).catch(fail);
}
// Sélecteur à pastilles : on clique dans une liste (pays / devises) au lieu de taper des codes.
function chipPicker(options, selected, placeholder) {
  const sel = new Set(selected), chips = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px', marginBottom: '6px' } });
  const search = h('input', { type: 'search', placeholder: placeholder || t('Rechercher…'), 'aria-label': placeholder || t('Rechercher…') });
  const list = h('div', { style: { maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--border, #ddd)', borderRadius: '8px', marginTop: '6px' } });
  const label = (v) => options.find((o) => o.value === v)?.label || v;
  const paint = () => {
    clear(chips).append(...(sel.size ? [...sel].map((v) => h('button', { type: 'button', class: 'badge', title: t('Retirer'), onclick: () => { sel.delete(v); paint(); } }, label(v), ' ✕')) : [h('span', { class: 'muted' }, t('Aucune sélection : tout est autorisé'))]));
    const q = search.value.trim().toLowerCase();
    clear(list).append(...options.filter((o) => !sel.has(o.value) && (!q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))).slice(0, 80).map((o) => h('button', { type: 'button', class: 'btn sm', style: { display: 'block', width: '100%', textAlign: 'left', border: 0, borderRadius: 0 }, onclick: () => { sel.add(o.value); paint(); } }, '+ ', o.label)));
  };
  search.oninput = paint; paint();
  const node = h('div', {}, chips, search, list); node.getValue = () => [...sel].join(','); return node;
}
const slug = (s, i) => { const x = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 24); return x || 'champ' + i; };
// Éditeur de champs en clair : « Numéro Airtel Money », type, obligatoire — jamais de JSON.
function fieldsEditor(initial) {
  const rows = h('div', { class: 'stack', style: { gap: '8px' } }); const items = [];
  const add = (f = {}) => {
    const lab = h('input', { value: f.label || '', placeholder: t('Ex. Numéro Airtel Money'), maxLength: 60, style: { flex: '1 1 220px', width: 'auto' }, 'aria-label': t('Nom du champ') }), ty = h('select', { style: { width: 'auto' }, 'aria-label': t('Type') }, [['text', 'Texte'], ['tel', 'Téléphone'], ['email', 'E-mail']].map(([v, l]) => h('option', { value: v, selected: v === (f.type || 'text') }, t(l)))), rq = h('input', { type: 'checkbox', checked: f.required !== false, style: { width: 'auto' } });
    const row = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px', alignItems: 'center' } }, lab, ty, h('label', { class: 'row', style: { gap: '4px' } }, rq, t('Obligatoire')), h('button', { type: 'button', class: 'btn sm danger', 'aria-label': t('Supprimer'), onclick: () => { items.splice(items.indexOf(it), 1); row.remove(); } }, icon('trash', { size: 14 })));
    const it = { lab, ty, rq }; items.push(it); rows.append(row);
  };
  (initial || []).forEach(add);
  const addBtn = h('button', { type: 'button', class: 'btn sm', onclick: () => { if (items.length >= 6) return toast(t('6 champs maximum')); add(); } }, icon('plus', { size: 14 }), t('Ajouter une information à demander'));
  const node = h('div', {}, rows, addBtn);
  node.getValue = () => { const used = new Set(); return items.filter((i) => i.lab.value.trim()).map((i, n) => { let name = slug(i.lab.value, n + 1); while (used.has(name)) name = (name + '_').slice(0, 23) + (n + 1); used.add(name); return { name, label: i.lab.value.trim(), type: i.ty.value, required: i.rq.checked }; }); };
  return node;
}
export async function settingsDialog(m, done) {
  const [cs, cur] = await Promise.all([get('/countries').catch(() => []), get('/currency-rates').catch(() => [])]);
  let fl = []; try { fl = m.fields ? JSON.parse(m.fields) : []; } catch { fl = []; }
  const ctry = chipPicker(cs.map((c) => ({ value: c.iso2, label: `${c.name_fr || c.name} (${c.iso2})` })), (m.countries || '').split(',').filter(Boolean), t('Rechercher un pays…'));
  const curr = chipPicker(cur.map((c) => ({ value: c.code, label: c.code })), (m.currencies || '').split(',').filter(Boolean), t('Rechercher une devise…'));
  const fe = fieldsEditor(fl), f = {};
  const field = (l, node, hint) => h('label', { class: 'f' }, l, node, hint ? h('small', { class: 'muted' }, hint) : null);
  const form = h('form', { class: 'stack', onsubmit: async (e) => { e.preventDefault(); try {
    await put(`/payment-methods/${m.id}/settings`, { countries: ctry.getValue(), currencies: curr.getValue(), commission_pct: Number(f.pct.value || 0), commission_fixed: Number(f.fix.value || 0), merchant_account: f.acc.value, payout: f.payout.value, instructions: f.ins.value, fields: fe.getValue(), otp_required: f.otp.checked, otp_ttl: Number(f.ttl.value || 120) });
    toast(t('Réglages enregistrés')); mo.close(); done?.(); } catch (er) { fail(er); } } },
    field(t('Pays autorisés'), ctry, t('Cliquez sur un pays pour l\'ajouter. Vide = tous les pays.')), field(t('Devises acceptées'), curr, t('Liste des devises de l\'application. Vide = toutes.')),
    h('div', { class: 'grid g2' }, field(t('Commission de la plateforme (%)'), f.pct = h('input', { type: 'number', step: 'any', min: 0, max: 50, value: (m.commission_bp || 0) / 100 })), field(t('Commission fixe (plus petite unité de la devise)'), f.fix = h('input', { type: 'number', min: 0, value: m.commission_fixed || 0 }))),
    field(t('Compte marchand / compte de réception associé'), f.acc = h('input', { value: m.merchant_account || '' })),
    field(t('Versement à l\'établissement'), f.payout = h('select', {}, [['deferred', 'Différé (par lots)'], ['instant', 'Instantané']].map(([v, l]) => h('option', { value: v, selected: v === (m.payout || 'deferred') }, t(l))))),
    field(t('Message affiché au client'), f.ins = h('textarea', { rows: 3, maxLength: 400, placeholder: t('Ex. Merci de renseigner votre nom, votre téléphone et votre numéro Airtel Money.') }, m.instructions || ''), t('Écrivez simplement la consigne, comme à un client.')),
    h('div', { class: 'grid g2' }, h('label', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, f.otp = h('input', { type: 'checkbox', checked: !!m.otp_required, style: { width: 'auto' } }), t('Exiger un code de confirmation par SMS avant le paiement')), field(t('Durée de validité du code (secondes)'), f.ttl = h('input', { type: 'number', min: 30, max: 900, value: m.otp_ttl || 120 }), t('Le client voit un chronomètre ; passé ce délai il redemande un code. Nécessite la passerelle SMS (Finance & API).'))),
    field(t('Informations à demander au client'), fe, t('Jamais de code PIN, mot de passe ni numéro de carte : ils se saisissent chez le prestataire.')),
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn primary' }, t('Enregistrer'))));
  const mo = modal(`${t('Réglages')} — ${m.label}`, form, { wide: true });
}
export async function adminExtras() {
  const wrap = h('div'), rates = h('div', { class: 'card', style: { marginTop: '14px' } }), pay = h('div', { class: 'card', style: { marginTop: '14px' } }), av = h('div', { class: 'card', style: { marginTop: '14px' } });
  const drawRates = async () => { const r = await get('/currency-rates'); clear(rates).append(h('div', { class: 'row between' }, h('h2', {}, t('Devises et taux de change')), h('button', { class: 'btn sm primary', onclick: () => formModal(t('Taux de change'), [{ name: 'code', label: 'Devise (code ISO, ex. XOF)', required: true }, { name: 'per_eur', label: 'Unités de cette devise pour 1 EUR', type: 'number', required: true }], async (v) => { await put(`/currency-rates/${String(v.code).toUpperCase()}`, { per_eur: Number(v.per_eur) }); drawRates(); }) }, icon('plus', { size: 14 }), t('Ajouter / modifier'))),
    h('p', { class: 'muted' }, t('Base de conversion automatique des montants (tableau de bord, comparaisons). Mettez les taux à jour régulièrement.')), table([{ label: 'Devise', key: 'code' }, { label: 'Pour 1 EUR', num: true, key: 'per_eur' }, { label: 'Mis à jour', render: (x) => when(x.updated_at) }], r)); };
  const drawPay = async () => { const [po, ph] = await Promise.all([get('/payouts'), get('/pharmacies').catch(() => [])]); const list = Array.isArray(ph) ? ph : ph.data || [];
    clear(pay).append(h('div', { class: 'row between' }, h('h2', {}, t('Versements aux établissements')), h('span', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => formModal(t('Compte de réception'), [{ name: 'pharmacy_id', label: 'Établissement', type: 'select', required: true, options: list.map((p) => ({ value: p.id, label: p.name })) }], async (v) => { const a = await get(`/payout-accounts/${v.pharmacy_id}`); formModal(t('Compte de réception'), [{ name: 'holder', label: 'Titulaire', value: a.holder }, { name: 'account', label: 'Compte bancaire (IBAN / RIB)', value: a.account }, { name: 'mobile', label: 'Mobile Money de réception', value: a.mobile }, { name: 'instant', label: 'Versement instantané', type: 'checkbox', value: a.instant }], async (x) => { await put(`/payout-accounts/${v.pharmacy_id}`, x); toast(t('Enregistré')); }); }, { submitLabel: 'Continuer' }) }, icon('wallet', { size: 14 }), t('Comptes de réception')),
      h('button', { class: 'btn sm primary', onclick: () => formModal(t('Enregistrer un versement'), [{ name: 'pharmacy_id', label: 'Établissement', type: 'select', required: true, options: list.map((p) => ({ value: p.id, label: p.name })) }, { name: 'amount', label: 'Montant (plus petite unité de la devise)', type: 'number', required: true }, { name: 'reference', label: 'Référence du virement' }, { name: 'note', label: 'Note' }], async (v) => { await post('/payouts', { ...v, pharmacy_id: Number(v.pharmacy_id), amount: Number(v.amount) }); toast(t('Versement enregistré')); drawPay(); }) }, icon('plus', { size: 14 }), t('Nouveau versement')))),
    h('p', { class: 'muted' }, t('Les fonds encaissés par la plateforme sont reversés à chaque établissement ; le reste à verser figure dans le tableau de bord.')), table([{ label: 'Date', render: (x) => when(x.created_at) }, { label: 'Établissement', key: 'pharmacy' }, { label: 'Montant', num: true, render: (x) => `${x.amount} ${x.currency}` }, { label: 'Référence', key: 'reference' }], po, { empty: t('Aucun versement') })); };
  const drawAv = async () => { const s = await get('/file-scans'); clear(av).append(h('h2', {}, icon('shield', { size: 18 }), ' ', t('Antivirus intégré')), h('p', { class: 'muted' }, t('Tout document reçu (ordonnances, pièces jointes, images, avatars) est analysé avant stockage. Moteur intégré actif'), s.clamav ? ' + ClamAV.' : t('. Pour un moteur à signatures complet, configurez ClamAV (CLAMD_HOST).')),
    h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } }, h('div', { class: 'card' }, h('div', { class: 'muted' }, t('Fichiers analysés')), h('strong', {}, s.total)), h('div', { class: 'card' }, h('div', { class: 'muted' }, t('Menaces bloquées')), h('strong', {}, s.infected))),
    table([{ label: 'Date', render: (x) => when(x.created_at) }, { label: 'Fichier', key: 'name' }, { label: 'Verdict', render: (x) => badge(x.verdict === 'infected' ? t('Bloqué') : t('Sain'), x.verdict === 'infected' ? 'danger' : 'ok') }, { label: 'Raison', key: 'reason' }], s.recent.slice(0, 30), { empty: t('Aucun fichier analysé') })); };
  wrap.append(await dashboard(), rates, pay, av); await Promise.all([drawRates(), drawPay(), drawAv()]); return wrap;
}
