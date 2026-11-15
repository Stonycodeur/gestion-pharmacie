// Super-administrateur : modes de paiement (espèces, TPE, virement, Stripe, Konnect, bac à sable…) et suivi des paiements en ligne.
import { get, put, post, del, can } from '../api.js';
import { h, formModal, fail, toast, table, clear, badge, confirmDialog, icon, money, when } from '../ui.js';
import { t } from '../i18n.js';
import * as P2 from './payments2.js';
const CFG_LABELS = { init_url: 'URL de création du paiement (HTTPS)', api_key: 'Clé API / jeton', auth_header: 'En-tête d\'authentification (ex. Authorization: Bearer {{key}})', body_template: 'Modèle JSON de la requête ({{amount_decimal}}, {{currency}}, {{reference}}, {{return_url}}, {{webhook_url}}, {{payer_phone}})', ref_path: 'Chemin de la référence dans la réponse (ex. data.id)', url_path: 'Chemin de l\'URL de paiement dans la réponse (ex. data.link)', status_url: 'URL de vérification du statut ({{ref}})', status_path: 'Chemin du statut dans la réponse', success_values: 'Valeurs de statut « payé » (ex. paid,completed,success)', webhook_secret: 'Secret de signature du webhook (HMAC-SHA256, en-tête x-signature)' };

const KINDS = [['cash', 'Espèces'], ['card', 'Carte'], ['mobile', 'Mobile'], ['transfer', 'Virement / chèque'], ['wallet', 'Portefeuille']].map(([value, label]) => ({ value, label }));
export default async function () {
  const card = h('div', { class: 'card', style: { marginTop: '14px' } }); let providers = [];
  const fields = (m = {}) => {
    const prov = providers.filter((p) => p.available).map((p) => ({ value: p.code, label: p.label }));
    return [{ name: 'code', label: 'Code (a-z, 0-9, _)', required: true, value: m.code, ...(m.id ? { hint: 'Non modifiable' } : {}) }, { name: 'label', label: 'Libellé affiché', required: true, value: m.label }, { name: 'kind', label: 'Famille comptable', type: 'select', required: true, options: KINDS, value: m.kind || 'card' },
      { name: 'provider', label: 'Prestataire', type: 'select', required: true, options: prov, value: m.provider || 'manual' }, { name: 'instructions', label: 'Instructions affichées au client', type: 'textarea', value: m.instructions },
      { name: 'channel_pos', label: 'Utilisable en caisse', type: 'checkbox', value: m.id ? m.channel_pos : 1 }, { name: 'channel_online', label: 'Proposé au client en ligne', type: 'checkbox', value: m.channel_online }, { name: 'enabled', label: 'Actif', type: 'checkbox', value: m.id ? m.enabled : 1 }, { name: 'sort_order', label: 'Ordre', type: 'number', value: m.sort_order ?? 100 }];
  };
  const secrets = (m) => { // champs du prestataire choisi (clés API chiffrées côté serveur ; jamais réaffichées sauf demande explicite auditée)
    const p = providers.find((x) => x.code === m.provider); if (!p?.fields.length) return Promise.resolve();
    return formModal(`Clés ${p.label}`, p.fields.map((f) => ({ name: f, label: (CFG_LABELS[f] || f) + (m.has_config?.[f] ? ' (déjà définie — laisser vide pour conserver)' : ''), type: ['base_url', 'init_url', 'auth_header', 'body_template', 'ref_path', 'url_path', 'status_url', 'status_path', 'success_values'].includes(f) ? 'text' : 'password' })), async (v) => { const c = {}; for (const [k, x] of Object.entries(v)) if (x) c[k] = x; await put('/payment-methods/' + m.id, { config: c }); toast('Clés enregistrées (chiffrées)'); draw(); });
  };
  async function draw() {
    const r = await get('/payment-methods?all=1'); providers = r.providers;
    clear(card).append(h('div', { class: 'row between' }, h('h2', {}, 'Modes de paiement'), h('span', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => P2.catalogDialog(draw) }, icon('globe', { size: 14 }), t('Catalogue mondial')), h('button', { class: 'btn sm primary', onclick: () => formModal('Nouveau mode de paiement', fields(), async (v) => { await post('/payment-methods', v); toast('Mode créé'); draw(); }) }, icon('plus', { size: 14 }), t('Nouveau')))),
      h('p', { class: 'muted' }, 'Seul le super-administrateur configure les modes. « Manuel » = encaissement au comptoir (espèces, TPE, chèque, virement confirmé à la main). Stripe / Konnect : paiement en ligne confirmé automatiquement par le prestataire (webhook signé).'),
      table([{ label: 'Mode', render: (m) => h('span', {}, h('strong', {}, m.label), h('div', { class: 'muted' }, m.code)) }, { label: 'Prestataire', render: (m) => providers.find((p) => p.code === m.provider)?.label || m.provider },
        { label: 'Disponibilité', render: (m) => h('span', { class: 'muted' }, m.countries ? `Pays : ${m.countries}` : 'Tous les pays', h('br'), m.currencies ? `Devises : ${m.currencies}` : 'Toutes devises', m.otp_required ? h('div', {}, badge('Code SMS', 'info')) : null) }, { label: 'Canaux', render: (m) => h('span', {}, m.channel_pos ? badge('Caisse', 'info') : null, ' ', m.channel_online ? badge('En ligne', 'info') : null) }, { label: 'Clés', render: (m) => (m.provider === 'manual' || m.provider === 'sandbox' ? '—' : Object.values(m.has_config || {}).some(Boolean) ? badge('Définies', 'ok') : badge('Manquantes', 'bad')) },
        { label: 'Statut', render: (m) => badge(m.enabled ? 'Actif' : 'Inactif', m.enabled ? 'ok' : 'warn') },
        { label: '', render: (m) => h('span', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => formModal('Modifier', fields(m), async (v) => { delete v.code; await put('/payment-methods/' + m.id, v); draw(); }) }, icon('edit', { size: 14 }), t('Modifier')),
          h('button', { class: 'btn sm', onclick: () => P2.settingsDialog(m, draw) }, icon('sliders', { size: 14 }), t('Réglages')),
          ['stripe', 'konnect', 'generic'].includes(m.provider) ? h('button', { class: 'btn sm', onclick: () => secrets(m) }, icon('lock', { size: 14 }), 'Clés') : null,
          h('button', { class: 'btn sm danger', 'aria-label': t('Supprimer'), onclick: async () => { if (await confirmDialog(`Supprimer « ${m.label} » ? (impossible s'il a déjà servi : désactivez-le)`, { danger: true })) try { await del('/payment-methods/' + m.id); draw(); } catch (e) { fail(e); } } }, icon('trash', { size: 14 }))) }], r.methods));
    card.append(await onlinePayments());
  }
  await draw(); return h('div', {}, card, await P2.adminExtras());
}

// Suivi des paiements en ligne (visible du personnel autorisé) : confirmation manuelle des virements / paiements au comptoir.
export async function onlinePayments() {
  const wrap = h('div'); const draw = async () => {
    const ops = await get('/online-payments').catch(() => []);
    clear(wrap).append(h('h3', { style: { marginTop: '16px' } }, 'Paiements en ligne récents'), table([{ label: 'Date', render: (p) => when(p.created_at) }, { label: 'Commande', key: 'order_number' }, { label: 'Client', key: 'customer_name' }, { label: 'Mode', render: (p) => p.method_label || p.method_code }, { label: 'Montant', num: true, render: (p) => money(p.amount) },
      { label: 'Statut', render: (p) => badge({ paid: 'Payé', pending: 'En attente', awaiting_manual: 'À confirmer', failed: 'Échoué', cancelled: 'Annulé', expired: 'Expiré' }[p.status] || p.status, p.status === 'paid' ? 'ok' : p.status === 'awaiting_manual' ? 'warn' : 'info') },
      { label: '', render: (p) => (p.status === 'paid' && can('sales.refund') && p.amount - (p.refunded || 0) > 0 ? h('button', { class: 'btn sm', onclick: () => P2.refundDialog(p, draw) }, t('Rembourser')) : null) },
      { label: '', render: (p) => (p.status === 'awaiting_manual' && can('sales.deposit') ? h('button', { class: 'btn sm primary', onclick: async () => { try { await post(`/online-payments/${p.id}/confirm`, {}); toast('Paiement confirmé'); draw(); } catch (e) { fail(e); } } }, 'Confirmer la réception') : null) }], ops, { empty: 'Aucun paiement en ligne' }));
  }; await draw(); return wrap;
}
