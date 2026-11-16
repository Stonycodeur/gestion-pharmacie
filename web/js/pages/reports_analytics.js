// Onglet « Analyse » des Rapports : indicateurs comparés, courbes, heures de pointe, jours, paiements, meilleures ventes.
// Entièrement personnalisable (blocs affichés et leur ordre, type de courbe, indicateur, regroupement, comparaison) ; mémorisé sur le compte.
import { get, put, qs } from '../api.js';
import { h, clear, money, fail } from '../ui.js';
import { t } from '../i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const S = (tag, a = {}, ...k) => { const e = document.createElementNS(NS, tag); for (const [x, v] of Object.entries(a)) e.setAttribute(x, v); e.append(...k); return e; };
const ALL = ['kpis', 'trend', 'hours', 'weekdays', 'payments', 'top'];
const LABEL = { kpis: 'Indicateurs', trend: 'Évolution', hours: 'Heures de pointe', weekdays: 'Jours de la semaine', payments: 'Modes de paiement', top: 'Meilleures ventes' };
const DEF = { widgets: ALL.slice(), chart: 'area', group: 'day', compare: true, metric: 'net', range: 30 };
const METRIC = { net: 'Chiffre d\'affaires net', tickets: 'Tickets', margin: 'Marge HT' };
const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const COLORS = ['var(--brand)', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ef4444', '#10b981', '#64748b'];
const fmtV = (m, v) => (m === 'tickets' ? String(Math.round(v || 0)) : money(v || 0));
const compact = (v) => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1) + ' M' : a >= 1e3 ? Math.round(v / 1e3) + ' k' : String(Math.round(v)); };
const load = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem('rep.ui') || '{}') }; } catch { return { ...DEF }; } };
let saveT; const save = (u) => { try { localStorage.setItem('rep.ui', JSON.stringify(u)); } catch {} clearTimeout(saveT); saveT = setTimeout(() => put('/me/preferences', { reports_ui: u }).catch(() => {}), 700); };

// Courbe / aires / barres sur une ou deux séries (période courante + précédente en pointillé)
function trendChart(cur, prev, metric, kind) {
  const W = 640, H = 220, L = 44, R = 10, T = 14, B = 26, n = Math.max(cur.length, 1), vals = cur.map((x) => x[metric] || 0), pv = prev.map((x) => x[metric] || 0);
  const max = Math.max(1, ...vals, ...pv), x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1)), y = (v) => T + (H - T - B) * (1 - v / max);
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart ana', role: 'img', 'aria-label': t(METRIC[metric]) });
  for (let i = 0; i <= 4; i++) { const v = (max * i) / 4, yy = y(v); svg.append(S('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'grid' }), (() => { const tx = S('text', { x: L - 6, y: yy + 3, 'text-anchor': 'end', class: 'axis' }); tx.textContent = compact(v); return tx; })()); }
  if (kind === 'bar') {
    const bw = (W - L - R) / n; cur.forEach((d, i) => { const v = d[metric] || 0, r = S('rect', { x: L + i * bw + bw * 0.15, y: y(v), width: bw * 0.7, height: Math.max(1, H - B - y(v)), rx: 3, class: 'bar' }); r.append(S('title', {}, `${d.period} : ${fmtV(metric, v)}`)); svg.append(r); });
  } else {
    const pts = vals.map((v, i) => [x(i), y(v)]), line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    if (kind === 'area' && pts.length) svg.append(S('path', { d: `${line} L${pts.at(-1)[0]} ${H - B} L${pts[0][0]} ${H - B} Z`, class: 'area' }));
    if (pv.length) { const pp = pv.slice(0, n).map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' '); svg.append(S('path', { d: pp, class: 'line prev' })); }
    svg.append(S('path', { d: line, class: 'line' }));
    pts.forEach((p, i) => { const c = S('circle', { cx: p[0], cy: p[1], r: n > 45 ? 0 : 3, class: 'dot' }); c.append(S('title', {}, `${cur[i].period} : ${fmtV(metric, vals[i])}`)); svg.append(c); });
  }
  const step = Math.ceil(n / 7); cur.forEach((d, i) => { if (i % step) return; const tx = S('text', { x: kind === 'bar' ? L + (i + 0.5) * ((W - L - R) / n) : x(i), y: H - 8, 'text-anchor': 'middle', class: 'axis' }); tx.textContent = String(d.period).slice(n > 31 ? 2 : 5); svg.append(tx); });
  return svg;
}
// Barres verticales simples (heures, jours) ; la valeur maximale est mise en avant
function bars(items, label, key) {
  const W = 640, H = 170, pad = 22, max = Math.max(1, ...items.map((d) => d[key])), bw = (W - pad * 2) / Math.max(1, items.length), top = items.findIndex((d) => d[key] === max);
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart ana', role: 'img', 'aria-label': t('Graphique') });
  items.forEach((d, i) => { const bh = ((H - pad * 1.6) * d[key]) / max, xx = pad + i * bw + bw * 0.15, r = S('rect', { x: xx, y: H - pad - bh, width: bw * 0.7, height: Math.max(1, bh), rx: 3, class: 'bar' + (i === top && max > 1 ? ' hot' : '') }); r.append(S('title', {}, `${label(d)} : ${key === 'tickets' ? d.tickets + ' ticket(s)' : money(d[key])}`)); svg.append(r);
    const tx = S('text', { x: xx + bw * 0.35, y: H - 6, 'text-anchor': 'middle', class: 'axis' }); tx.textContent = label(d); svg.append(tx); });
  return svg;
}
function donut(items) {
  const tot = items.reduce((a, x) => a + x.total, 0) || 1, R = 54, C = 2 * Math.PI * R; let off = 0;
  const svg = S('svg', { viewBox: '0 0 140 140', class: 'donut', role: 'img', 'aria-label': t('Modes de paiement') });
  items.forEach((x, i) => { const len = (x.total / tot) * C, c = S('circle', { cx: 70, cy: 70, r: R, fill: 'none', 'stroke-width': 22, stroke: COLORS[i % COLORS.length], 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 70 70)' }); c.append(S('title', {}, `${x.method} : ${money(x.total)}`)); svg.append(c); off += len; });
  const tx = S('text', { x: 70, y: 75, 'text-anchor': 'middle', class: 'donut-t' }); tx.textContent = items.length + ' ' + t('modes'); svg.append(tx);
  return svg;
}
const delta = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : a ? null : 0);
const badge = (d) => (d == null ? h('span', { class: 'dl' }, '—') : h('span', { class: 'dl ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') }, `${d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= '}${d} %`));

export async function analytics(box, getRange) {
  let ui = load(), data = null, tok = 0;
  get('/me/preferences').then((p) => { if (p.reports_ui && JSON.stringify(p.reports_ui) !== JSON.stringify(ui)) { ui = { ...DEF, ...p.reports_ui }; try { localStorage.setItem('rep.ui', JSON.stringify(ui)); } catch {} draw(); } }).catch(() => {});
  const bar = h('div', { class: 'row ana-bar' }), out = h('div', { class: 'ana-out' });
  const set = (patch, refetch) => { ui = { ...ui, ...patch }; save(ui); refetch ? fetchAll() : draw(); };
  const sel = (label, key, opts, refetch) => h('label', { class: 'ana-sel' }, h('span', {}, t(label)), h('select', { onchange: (e) => set({ [key]: typeof opts[0][0] === 'number' ? Number(e.target.value) : e.target.value }, refetch) }, opts.map(([v, l]) => h('option', { value: v, selected: ui[key] === v }, t(l)))));
  function panel() {
    const d = h('details', { class: 'ana-custom' }, h('summary', { class: 'btn' }, '⚙ ' + t('Personnaliser')));
    const lst = h('div', { class: 'ana-list' });
    const order = [...ui.widgets, ...ALL.filter((w) => !ui.widgets.includes(w))];
    order.forEach((w, i) => { const on = ui.widgets.includes(w);
      lst.append(h('div', { class: 'ana-item' }, h('label', {}, h('input', { type: 'checkbox', checked: on, onchange: (e) => { const ws = order.filter((x) => (x === w ? e.target.checked : ui.widgets.includes(x))); set({ widgets: ws }); } }), ' ' + t(LABEL[w])),
        h('span', { class: 'row' }, h('button', { class: 'btn sm', 'aria-label': t('Monter'), disabled: i === 0, onclick: () => { const o = order.slice(); [o[i - 1], o[i]] = [o[i], o[i - 1]]; set({ widgets: o.filter((x) => ui.widgets.includes(x)) }); d.open = true; renderBar(true); } }, '↑'), h('button', { class: 'btn sm', 'aria-label': t('Descendre'), disabled: i === order.length - 1, onclick: () => { const o = order.slice(); [o[i + 1], o[i]] = [o[i], o[i + 1]]; set({ widgets: o.filter((x) => ui.widgets.includes(x)) }); d.open = true; renderBar(true); } }, '↓'))));
    });
    d.append(h('div', { class: 'ana-pop card' }, lst, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { ui = { ...DEF }; save(ui); renderBar(); fetchAll(); } }, t('Réinitialiser')))));
    return d;
  }
  function renderBar(keepOpen) { const was = bar.querySelector('details')?.open || keepOpen; clear(bar).append(
    sel('Période', 'range', [[7, '7 jours'], [30, '30 jours'], [90, '90 jours'], [365, '12 mois']], true), sel('Regroupement', 'group', [['day', 'Par jour'], ['month', 'Par mois']], true),
    sel('Indicateur', 'metric', Object.entries(METRIC)), sel('Courbe', 'chart', [['area', 'Aires'], ['line', 'Ligne'], ['bar', 'Barres']]),
    h('label', { class: 'ana-chk' }, h('input', { type: 'checkbox', checked: ui.compare, onchange: (e) => set({ compare: e.target.checked }) }), ' ' + t('Comparer à la période précédente')), panel());
    if (was) bar.querySelector('details').open = true; }
  const card = (title, ...k) => h('section', { class: 'card ana-card' }, h('h3', {}, t(title)), ...k);
  const W = {
    kpis: (r) => { const c = r.current, p = r.prev, K = [['net', 'Chiffre d\'affaires', money(c.net)], ['tickets', 'Tickets', String(c.tickets)], ['basket', 'Panier moyen', money(c.basket)], ['margin', 'Marge HT', money(c.margin || 0)], ['refunded', 'Remboursé', money(c.refunded || 0), true]];
      return h('div', { class: 'grid g4 ana-kpis' }, K.map(([k, l, v, inv]) => { const d = delta(c[k] || 0, p[k] || 0); return h('div', { class: 'card kpi' }, h('div', { class: 'l' }, t(l)), h('div', { class: 'v' }, v), ui.compare ? h('div', { class: 'l' }, inv && d != null ? badge(-d) : badge(d), ' ', t('vs précédente')) : null); })); },
    trend: (r) => card(METRIC[ui.metric], trendChart(r.series, ui.compare ? r.series_prev : [], ui.metric, ui.chart), ui.compare ? h('div', { class: 'legend' }, h('span', { class: 'sw cur' }), ' ', `${r.from} → ${r.to}`, h('span', { class: 'sw prev' }), ' ', `${r.previous.from} → ${r.previous.to}`) : null),
    hours: (r) => { const hrs = Array.from({ length: 24 }, (_, i) => r.hours.find((x) => x.hour === i) || { hour: i, tickets: 0, total: 0 }).filter((x) => x.hour >= 6 && x.hour <= 23 || x.tickets); const best = [...r.hours].sort((a, b) => b.tickets - a.tickets)[0];
      return card('Heures de pointe', bars(hrs, (d) => d.hour + 'h', 'tickets'), best ? h('p', { class: 'muted' }, `${t('Pic d\'affluence')} : ${best.hour}h–${best.hour + 1}h (${best.tickets} ${t('tickets')})`) : h('p', { class: 'muted' }, t('Aucune vente sur la période'))); },
    weekdays: (r) => { const wd = [1, 2, 3, 4, 5, 6, 0].map((d) => r.weekdays.find((x) => x.day === d) || { day: d, tickets: 0, total: 0 }); const best = [...wd].sort((a, b) => b.total - a.total)[0];
      return card('Jours de la semaine', bars(wd, (d) => t(DAYS[d.day]), 'total'), best?.total ? h('p', { class: 'muted' }, `${t('Meilleur jour')} : ${t(DAYS[best.day])} (${money(best.total)})`) : null); },
    payments: (r) => { const tot = r.payments.reduce((a, x) => a + x.total, 0) || 1;
      return card('Modes de paiement', r.payments.length ? h('div', { class: 'row ana-pay' }, donut(r.payments), h('ul', { class: 'ana-leg' }, r.payments.map((x, i) => h('li', {}, h('i', { style: { background: COLORS[i % COLORS.length] } }), ` ${x.method} — ${money(x.total)} (${Math.round((x.total / tot) * 100)} %)`)))) : h('p', { class: 'muted' }, t('Aucun paiement sur la période'))); },
    top: (r) => { const m = Math.max(1, ...r.top.map((x) => x.revenue));
      return card('Meilleures ventes', r.top.length ? h('div', { class: 'ana-top' }, r.top.map((x) => h('div', { class: 'ana-trow' }, h('div', { class: 'n' }, x.name, h('small', {}, ` × ${x.qty}`)), h('div', { class: 'b' }, h('i', { style: { width: Math.max(2, (x.revenue / m) * 100) + '%' } })), h('div', { class: 'a' }, money(x.revenue))))) : h('p', { class: 'muted' }, t('Aucune vente sur la période'))); },
  };
  function draw() { if (!data) return; clear(out); const ws = ui.widgets.filter((w) => W[w]); if (!ws.length) return out.append(h('div', { class: 'empty' }, t('Aucun bloc affiché : utilisez « Personnaliser ».')));
    const half = new Set(['hours', 'weekdays', 'payments', 'top']), kids = []; let pair = [];
    const flush = () => { if (pair.length) kids.push(h('div', { class: 'grid g2' }, pair)); pair = []; };
    for (const w of ws) { const el = W[w](data); if (half.has(w)) { pair.push(el); if (pair.length === 2) flush(); } else { flush(); kids.push(el); } } flush(); out.append(...kids); }
  async function fetchAll() { const my = ++tok; clear(out).append(h('div', { class: 'empty' }, t('Chargement…'))); try { const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - (ui.range - 1) * 864e5).toISOString().slice(0, 10); const r = await get('/reports/analytics' + qs({ from, to, group: ui.group })); if (my !== tok) return; data = r; draw(); } catch (e) { if (my === tok) { clear(out); fail(e); } } }
  renderBar(); box.append(bar, out); await fetchAll();
}
