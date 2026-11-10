import { get, post, can } from '../api.js';
import { h, clear, money, toMinor, table, pager, badge, modal, formModal, fail, toast, when, statusBadge, confirmDialog, icon } from '../ui.js';
import { loadMethods, methodsNow, methodOptions, kindOf, kindIcon } from '../paymethods.js';
import { t } from '../i18n.js';
import { productPicker } from './purchases.js';

const NEXT = { pending: ['confirmed'], confirmed: ['preparing'], preparing: ['ready'] };
export default async function (box) { await loadMethods('pos');
  const list = h('div'); const st = h('select', {}, h('option', { value: '' }, 'Tous statuts'), ['pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'cancelled', 'expired'].map((s) => h('option', { value: s }, s)));
  async function load(page = 1) { const r = await get(`/orders?page=${page}&status=${st.value}`); clear(list).append(table([{ label: 'N°', key: 'number' }, { label: 'Client', key: 'customer_name' }, { label: 'Type', key: 'kind' }, { label: 'Lignes', num: true, key: 'lines' }, { label: 'Expire', render: (o) => when(o.expires_at) }, { label: 'Statut', render: (o) => statusBadge('order', o.status) }], r.data, { onRow: open }), pager(r, load)); }
  function deposit(o, dep) {
    formModal('Acompte — ' + o.number, [{ name: 'amount', label: 'Montant', type: 'money', required: true, hint: `Déjà versé : ${money(dep.held)} · valeur de la commande : ${money(dep.order_value)}` }, { name: 'method', label: 'Mode', type: 'select', required: true, value: 'cash', options: methodOptions() }], async (v) => { await post(`/orders/${o.id}/deposit`, v); toast('Acompte encaissé'); load(); });
  }
  async function open(row) {
    const o = await get('/orders/' + row.id); const acts = []; const dep = can('orders.view') ? await get(`/orders/${o.id}/deposits`).catch(() => ({ held: 0, data: [], order_value: 0 })) : { held: 0, data: [] };
    if (can('orders.manage')) {
      (NEXT[o.status] || []).forEach((n) => acts.push(h('button', { class: 'btn', onclick: async () => { await post(`/orders/${o.id}/status`, { status: n }); m.close(); load(); } }, [icon('arrow', { size: 14 }), t(({ confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête' })[n])])));
      if (['pending', 'confirmed', 'preparing', 'ready'].includes(o.status)) { acts.push(h('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog('Annuler et libérer le stock réservé ?', { danger: true })) { await post(`/orders/${o.id}/status`, { status: 'cancelled' }); m.close(); load(); } } }, t('Annuler')));
        if (can('sales.deposit')) acts.push(h('button', { class: 'btn', onclick: () => { m.close(); deposit(o, dep); } }, '+ Acompte'));
        if (can('sales.deposit') && dep.held > 0) acts.push(h('button', { class: 'btn', onclick: async () => { const r = await confirmDialog(`Rembourser ${money(dep.held)} d'acompte ?`, { reason: true }); if (r) { try { await post(`/orders/${o.id}/deposit/refund`, { reason: r }); m.close(); toast('Acompte remboursé'); } catch (e) { fail(e); } } } }, 'Rembourser l\'acompte'));
        if (can('sales.create')) acts.push(h('button', { class: 'btn primary', onclick: () => { m.close(); pickup(o); } }, 'Retrait + encaissement')); }
    }
    const m = modal(`${o.number} — ${o.customer_name}`, h('div', {}, statusBadge('order', o.status), ' Expire : ', when(o.expires_at), dep.held > 0 ? h('div', { class: 'alert info' }, `Acompte versé : ${money(dep.held)} (déduit au retrait)`) : null, table([{ label: 'Produit', render: (l) => h('span', {}, l.product_name, ' ', l.rx_status !== 'free' ? statusBadge('rx', l.rx_status) : '') }, { label: 'Qté', num: true, key: 'qty' }, { label: 'Prix', num: true, render: (l) => money(l.sale_price) }], o.lines), h('h3', {}, 'Historique'), table([{ label: 'Date', render: (x) => when(x.created_at) }, { label: 'Statut', key: 'to_status' }, { label: 'Par', key: 'user_name' }], o.history)), { wide: true, actions: acts });
  }
  async function pickup(o) {
    const dep = await get(`/orders/${o.id}/deposits`).catch(() => ({ held: 0 })); const total = Math.max(0, o.lines.reduce((a, l) => a + l.sale_price * l.qty, 0) - dep.held); const meth = h('select', {}, methodsNow().map((x) => h('option', { value: x.code }, x.label))), amt = h('input', { type: 'number', step: '0.001', value: (total / 1000).toFixed(3) });
    const needRx = o.lines.some((l) => l.rx_status !== 'free'); const pres = h('input', { type: 'number', placeholder: 'ID ordonnance validée' });
    const m = modal('Retrait — ' + o.number, h('div', {}, h('p', {}, h('strong', {}, `Reste à payer : ${money(total)}`), dep.held ? ` (acompte ${money(dep.held)} déjà versé)` : ''), h('label', { class: 'f' }, 'Mode de paiement', meth), h('label', { class: 'f' }, 'Montant reçu', amt), needRx ? h('label', { class: 'f' }, 'Ordonnance validée (ID)', pres) : null), { actions: [h('button', { class: 'btn primary', onclick: async () => { try { const s = await post(`/orders/${o.id}/pickup`, { prescription_id: pres.value ? Number(pres.value) : undefined, payments: toMinor(amt.value) > 0 ? [{ method: meth.value, amount: toMinor(amt.value) }] : [] }); m.close(); toast(`Vente ${s.number}`); load(); } catch (e) { fail(e); } } }, 'Encaisser et remettre')] });
  }
  function create() {
    const lines = []; const tb = h('div'); const cs = h('select'); get('/customers?limit=200').then((r) => r.data.forEach((c) => cs.append(h('option', { value: c.id }, c.name))));
    const kind = h('select', {}, h('option', { value: 'reservation' }, 'Réservation'), h('option', { value: 'order' }, 'Commande'));
    const draw = () => clear(tb).append(table([{ label: 'Produit', key: 'name' }, { label: 'Qté', render: (l) => h('input', { type: 'number', min: 1, value: l.qty, style: { width: '70px' }, onchange: (e) => (l.qty = Number(e.target.value)) }) }], lines));
    const m = modal('Nouvelle commande / réservation', h('div', {}, h('label', { class: 'f' }, 'Client', cs), h('label', { class: 'f' }, 'Type', kind), tb, h('button', { class: 'btn', onclick: () => productPicker((p) => { lines.push({ id: p.id, name: p.name, qty: 1 }); draw(); }) }, '+ Produit'), h('p', { class: 'muted' }, 'Le stock est réservé immédiatement (FEFO) et libéré automatiquement à l\'expiration.')), { wide: true, actions: [h('button', { class: 'btn primary', onclick: async () => { try { await post('/orders', { customer_id: Number(cs.value), kind: kind.value, lines: lines.map((l) => ({ product_id: l.id, qty: l.qty })) }); m.close(); toast('Créée'); load(); } catch (e) { fail(e); } } }, 'Créer')] });
  }
  st.onchange = () => load();
  box.append(h('div', { class: 'row between' }, h('h1', {}, t('Commandes')), can('orders.manage') ? h('button', { class: 'btn primary', onclick: create }, '+ ' + t('Nouveau')) : null), h('div', { style: { margin: '12px 0' } }, st), list); await load();
  if (can('orders.view')) box.append(await (await import('./payments_admin.js')).onlinePayments());
}
