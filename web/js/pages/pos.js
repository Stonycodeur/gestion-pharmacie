import { get, post, download, can, state } from '../api.js';
import { h, clear, money, toMinor, fromMinor, toast, fail, modal, formModal, debounce, badge, statusBadge, methodLabel, confirmDialog, icon } from '../ui.js';
import { net, onNet, enqueue, listOutbox } from '../offline.js';
import { t, fmtDate } from '../i18n.js';

export async function receipt(sale) {
  const ph = sale.pharmacy || state.pharmacy || {};
  const L = (a, b, bold) => h('div', { class: 'l', style: bold ? { fontWeight: 700 } : null }, h('span', {}, a), h('span', {}, b));
  const node = h('div', { class: 'receipt print-area' }, sale.offline ? h('div', { class: 'alert warn' }, 'TICKET PROVISOIRE — vente enregistrée hors connexion, numéro définitif attribué à la synchronisation.') : null, h('div', { style: { textAlign: 'center' } }, h('strong', {}, ph.name), h('div', {}, ph.address || ''), h('div', {}, ph.phone || '')), h('hr'),
    L(sale.number, fmtDate(sale.created_at)), h('div', {}, `${t('Caisse / Vente')} : ${sale.cashier_name}`), sale.customer_name ? h('div', {}, `${t('Client')} : ${sale.customer_name}`) : null, h('hr'),
    sale.lines.map((l) => h('div', {}, h('div', {}, l.product_name), L(`${l.qty} × ${money(l.unit_price, false)}${l.discount ? ' − ' + money(l.discount, false) : ''}`, money(l.line_total, false)), l.batch_no ? h('small', { class: 'muted' }, `${t('Lot')} ${l.batch_no} · ${l.exp_date}`) : null)), h('hr'),
    L(t('Total'), money(sale.total), true), L('dont taxes', money(sale.tax_total)), sale.payments.map((p) => L(methodLabel(p.method), money(p.amount))), sale.change_given ? L(t('Rendu'), money(sale.change_given)) : null, sale.balance_due > 0 ? L('RESTE À PAYER', money(sale.balance_due), true) : null, h('hr'),
    h('div', { style: { textAlign: 'center', fontSize: '12px' } }, ph.legal_notice || ''));
  modal(t('Ticket'), node, { actions: [sale.offline ? null : h('button', { class: 'btn', onclick: () => download(`/sales/${sale.id}/pdf`, sale.number + '.pdf').catch(() => {}) }, icon('download', { size: 16 }), 'PDF'), h('button', { class: 'btn primary', onclick: () => window.print() }, icon('printer', { size: 16 }), t('Imprimer'))] });
}
import { loadMethods, methodsNow, methodOptions, kindOf, kindIcon } from '../paymethods.js';

export default async function (box) {
  await loadMethods('pos'); let session = null, sessionErr = null;
  try { session = await get('/cash/current'); } catch (e) { sessionErr = e; }
  const cart = []; let customer = null, presId = null, method = 'cash', timer, credit = false, catalog = [], queued = new Map();
  const gate = h('div'); const results = h('div', { class: 'res' }); const cartBox = h('div'); const payBox = h('div');
  const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // --- catalogue : instantané serveur (mis en cache automatiquement) pour la recherche hors connexion ---
  async function loadCatalog() { try { const r = await get('/pos/snapshot'); catalog = r.products || []; } catch { catalog = []; } await refreshQueued(); }
  async function refreshQueued() { queued = new Map(); for (const it of await listOutbox()) for (const l of it.lines || []) queued.set(l.product_id, (queued.get(l.product_id) || 0) + l.qty); }
  const sellable = (p) => p.sellable - (net.online ? 0 : queued.get(p.id) || 0);
  const localSearch = (q) => { const n = norm(q); return catalog.filter((p) => [p.name, p.dci, p.sku, p.barcode].some((x) => norm(x).includes(n))).slice(0, 25).map((p) => ({ ...p, sellable: sellable(p) })); };
  const search = h('input', { type: 'search', placeholder: t('Rechercher un produit (nom, DCI, code-barres)…'), 'aria-label': t('Rechercher'), autocomplete: 'off', enterKeyHint: 'search',
    onkeydown: async (e) => { if (e.key === 'Enter' && search.value.trim()) { clearTimeout(timer); const r = await doSearch(); const v = search.value.trim(); if (r.length === 1 || r.find((x) => x.barcode === v)) { add(r.find((x) => x.barcode === v) || r[0]); search.value = ''; clear(results); } } } });
  async function doSearch() {
    const q = search.value.trim(); if (q.length < 2) { clear(results); return []; }
    let r; if (net.online) { try { r = await get('/pos/search?q=' + encodeURIComponent(q)); } catch (e) { if (e.status !== 0) throw e; r = localSearch(q); } } else r = localSearch(q);
    clear(results);
    r.forEach((p) => results.append(h('button', { disabled: p.sellable <= 0, onclick: () => { add(p); search.focus(); } }, h('span', {}, h('strong', {}, p.name), h('div', { class: 'muted' }, [p.dci, p.dosage, p.sku].filter(Boolean).join(' · '), ' ', p.rx_status !== 'free' ? statusBadge('rx', p.rx_status) : '')),
      h('span', { class: 'right nowrap' }, h('div', {}, h('strong', {}, money(p.sale_price))), h('small', { class: p.sellable <= 0 ? '' : 'muted' }, p.sellable > 0 ? `${t('Disponible')} : ${p.sellable}` : 'Rupture')))));
    if (!r.length) results.append(h('div', { class: 'empty' }, icon('search'), t('Aucun résultat'))); return r;
  }
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => doSearch().catch(fail), 200); });
  const add = (p) => { const l = cart.find((x) => x.p.id === p.id); if (!net.online && (l ? l.qty : 0) + 1 > p.sellable) return toast('Stock insuffisant (données hors ligne)', true); if (l) l.qty++; else cart.push({ p, qty: 1, discount: 0 }); drawCart(); };
  const total = () => cart.reduce((a, l) => a + l.p.sale_price * l.qty - l.discount, 0);
  const count = () => cart.reduce((a, l) => a + l.qty, 0);
  const needsRx = () => cart.some((l) => l.p.rx_status !== 'free');
  let touched = false, presSel = null, custSel = null, paid = h('input', { type: 'number', min: 0, step: 1 / 10 ** state.pharmacy.currency_decimals, inputMode: 'decimal', 'aria-label': 'Montant reçu' });
  const fab = h('button', { class: 'btn primary fab', onclick: () => cartCard.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
  function drawCart() {
    clear(cartBox);
    if (!cart.length) cartBox.append(h('div', { class: 'empty' }, icon('cart'), t('Panier vide')));
    else cart.forEach((l, i) => cartBox.append(h('div', { class: 'cartline' },
      h('div', { class: 'nm' }, h('strong', {}, l.p.name), l.p.rx_status !== 'free' ? h('div', {}, statusBadge('rx', l.p.rx_status)) : ''),
      h('div', { class: 'amt' }, money(l.p.sale_price * l.qty - l.discount)),
      h('div', { class: 'ctl' }, h('span', { class: 'qty' }, h('button', { class: 'btn sm', 'aria-label': '−', onclick: () => { if (--l.qty <= 0) cart.splice(i, 1); drawCart(); } }, icon('minus', { size: 14 })), h('input', { type: 'number', min: 1, value: l.qty, inputMode: 'numeric', 'aria-label': t('Quantité'), onchange: (e) => { l.qty = Math.max(1, parseInt(e.target.value) || 1); drawCart(); } }), h('button', { class: 'btn sm', 'aria-label': '+', onclick: () => { if (!net.online && l.qty + 1 > l.p.sellable) return toast('Stock insuffisant (données hors ligne)', true); l.qty++; drawCart(); } }, icon('plus', { size: 14 }))),
        can('sales.discount') ? h('input', { type: 'number', min: 0, style: { width: '96px' }, placeholder: t('Remise'), title: t('Remise'), 'aria-label': t('Remise'), value: l.discount ? fromMinor(l.discount) : '', onchange: (e) => { l.discount = e.target.value ? toMinor(e.target.value) : 0; drawCart(); } }) : null,
        h('button', { class: 'btn sm danger', 'aria-label': t('Supprimer'), onclick: () => { cart.splice(i, 1); drawCart(); } }, icon('trash', { size: 14 }))))));
    fab.classList.toggle('show', cart.length > 0); clear(fab).append(icon('cart', { size: 20 }), `${count()} · ${money(total())}`);
    drawPay();
  }
  async function drawPay() {
    clear(payBox); const tot = total();
    const extra = h('div', { class: 'row' });
    if (!custSel) { custSel = h('select', { 'aria-label': t('Client'), onchange: (e) => { customer = e.target.value ? Number(e.target.value) : null; loadPres(); drawPay(); } }, h('option', { value: '' }, t('Sans client'))); get('/customers?limit=200').then((r) => r.data.forEach((c) => custSel.append(h('option', { value: c.id, selected: c.id === customer }, c.name)))).catch(() => {}); }
    extra.append(custSel);
    if (can('sales.credit') && customer) extra.append(h('label', { class: 'row', style: { gap: '6px' } }, h('input', { type: 'checkbox', checked: credit, onchange: (e) => { credit = e.target.checked; drawPay(); } }), 'Reste à crédit'));
    if (needsRx()) { presSel ||= h('select', { 'aria-label': t('Ordonnance'), onchange: (e) => { presId = e.target.value ? Number(e.target.value) : null; drawPay(); } }, h('option', { value: '' }, t('Ordonnance') + ' *')); extra.append(presSel); loadPres(); }
    const input = h('div', { class: 'pay-methods', role: 'group' }, methodsNow().map((m) => h('button', { class: 'btn sm', 'aria-pressed': m.code === method, onclick: () => { method = m.code; drawPay(); } }, icon(kindIcon(m.kind), { size: 15 }), m.label)));
    if (!touched) paid.value = fromMinor(tot); const diff = toMinor(paid.value || 0) - tot;
    const blocked = () => !cart.length || (toMinor(paid.value || 0) - total() < 0 && !credit) || (needsRx() && !presId) || (!net.online && credit);
    const btn = h('button', { class: 'btn primary block', style: { fontSize: '1.1rem', minHeight: '52px' }, disabled: blocked(), onclick: pay }, icon(net.online ? 'check' : 'upload', { size: 20 }), net.online ? `${t('Encaisser')} (F9)` : 'Encaisser hors ligne (F9)');
    payBox.append(h('div', { class: 'total' }, money(tot)), h('div', { class: 'grid', style: { gap: '10px' } }, extra, input, h('label', { class: 'f' }, 'Montant reçu', paid), kindOf(method) === 'cash' && diff > 0 ? h('div', { class: 'alert info' }, icon('info', { size: 18 }), `${t('Rendu')} : ${money(diff)}`) : null,
      !net.online ? h('div', { class: 'alert warn' }, icon('wifioff', { size: 18 }), h('span', {}, 'Hors connexion : la vente sera enregistrée sur cet appareil et envoyée dès le retour du réseau (stock et prix contrôlés à ce moment). La vente à crédit n\'est pas disponible hors connexion.')) : null,
      needsRx() && !presId ? h('div', { class: 'alert warn' }, icon('alert', { size: 18 }), 'Produit sur ordonnance : sélectionnez une ordonnance validée.') : null, btn));
    paid.oninput = () => { touched = true; btn.disabled = blocked(); };
  }
  async function loadPres() {
    if (!presSel) return; const keep = presId; clear(presSel); presSel.append(h('option', { value: '' }, t('Ordonnance') + ' *'));
    try { const r = await get('/prescriptions?limit=100&q='); r.data.filter((p) => ['validated', 'partially_delivered'].includes(p.status)).forEach((p) => presSel.append(h('option', { value: p.id, selected: p.id === keep }, `${p.number} — ${p.patient_name}`))); } catch {}
  }
  const idem = () => crypto.randomUUID();
  let key = idem();
  const taxOf = (gross, rate) => Math.round((gross * (rate || 0)) / (100 + (rate || 0)));
  async function pay() {
    const tot = total(), received = toMinor(paid.value || 0); const amt = credit ? Math.min(received, tot) : kindOf(method) === 'cash' ? received : tot; const pays = amt > 0 ? [{ method, amount: amt }] : [];
    const payload = { customer_id: customer, prescription_id: needsRx() ? presId : null, idempotency_key: key, allow_credit: credit || undefined, lines: cart.map((l) => ({ product_id: l.p.id, qty: l.qty, discount: l.discount })), payments: pays };
    const snapshot = cart.map((l) => ({ ...l })), custName = custSel?.selectedOptions?.[0]?.textContent;
    const done = () => { cart.length = 0; touched = false; paid.value = ''; key = idem(); presId = null; credit = false; drawCart(); };
    const queueIt = async () => {
      const sale = { number: 'HORS-LIGNE-' + key.slice(0, 6).toUpperCase(), offline: true, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), cashier_name: state.user.name, customer_name: customer ? custName : null, total: tot, tax_total: snapshot.reduce((a, l) => a + taxOf(l.p.sale_price * l.qty - l.discount, l.p.tax_rate), 0), change_given: kindOf(method) === 'cash' && received > tot ? received - tot : 0, balance_due: 0,
        lines: snapshot.map((l) => ({ product_name: l.p.name, qty: l.qty, unit_price: l.p.sale_price, discount: l.discount, line_total: l.p.sale_price * l.qty - l.discount })), payments: pays.map((p) => ({ ...p, amount: Math.min(p.amount, tot) })) };
      await enqueue({ key, method: 'POST', path: '/sales', body: { ...payload, offline_at: new Date().toISOString(), expected_total: tot }, label: sale.number, total: tot, lines: payload.lines });
      await refreshQueued(); done(); toast(`${sale.number} — ${money(tot)}`); receipt(sale);
    };
    if (!net.online) return queueIt().catch(fail);
    try { const sale = await post('/sales', payload); done(); toast(`${sale.number} — ${money(sale.total)}`); receipt(sale); }
    catch (e) { if (e.status === 0 && !credit) return queueIt().catch(fail); fail(e); if (e.code === 'NO_OPEN_CASH_SESSION') location.reload(); }
  }
  function drawGate() {
    clear(gate);
    if (session) return;
    if (sessionErr?.status === 0 || !net.online) return gate.append(h('div', { class: 'alert warn' }, icon('wifioff', { size: 18 }), h('span', {}, 'Hors connexion et aucune session de caisse en cache : ouvrez la caisse une première fois avec le réseau. Vous pouvez néanmoins encaisser : la vente sera rattachée à la caisse ouverte au moment de la synchronisation.')));
    get('/cash/registers').then((regs) => gate.append(h('div', { class: 'alert warn' }, icon('wallet', { size: 18 }), h('span', {}, h('strong', {}, t('Ouvrir la caisse')), ' — ouvrez une session avant de vendre. ', h('button', { class: 'btn sm primary', onclick: () => formModal('Ouvrir la caisse', [{ name: 'register_id', label: 'Caisse', type: 'select', required: true, options: regs.map((r) => ({ value: r.id, label: r.name })) }, { name: 'opening_float', label: 'Fond de caisse', type: 'money', value: 0 }], async (v) => { await post('/cash/open', v); session = await get('/cash/current'); drawGate(); }) }, t('Ouvrir la caisse')))))).catch(() => {});
  }
  const cartCard = h('div', { class: 'card cartcard' }, h('h2', {}, icon('cart', { size: 20 }), ' ', t('Panier')), cartBox, payBox);
  box.append(h('div', { class: 'row between', style: { marginBottom: '10px' } }, h('h1', {}, t('Caisse / Vente')), h('button', { class: 'btn', onclick: () => { cart.length = 0; touched = false; drawCart(); search.focus(); } }, icon('plus', { size: 16 }), t('Nouvelle vente'))), gate,
    h('div', { class: 'pos' }, h('div', { class: 'card' }, h('label', { class: 'search' }, icon('search', { size: 18 }), search), results), cartCard), fab);
  const keys = (e) => { if (!document.body.contains(search)) return document.removeEventListener('keydown', keys); if (e.key === 'F2') { e.preventDefault(); search.focus(); } if (e.key === 'F9') { e.preventDefault(); payBox.querySelector('.btn.primary')?.click(); } };
  document.addEventListener('keydown', keys);
  const off = onNet(() => { if (!document.body.contains(search)) return off(); drawGate(); drawPay(); refreshQueued(); });
  drawGate(); drawCart(); await loadCatalog(); setTimeout(() => { if (matchMedia('(pointer:fine)').matches) search.focus(); }, 50);
}
