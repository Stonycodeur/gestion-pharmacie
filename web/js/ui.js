// Petite bibliothèque d'interface : construction DOM sûre (textContent, jamais innerHTML avec des données).
import { t, fmtDate } from './i18n.js';
import { phoneField } from './net.js';
import { state, ApiError } from './api.js';
import { icon } from './icons.js';
export { icon };
// Bouton avec icône SVG : ib('plus', 'Nouveau', { class:'btn primary', onclick })
export const ib = (name, label, props = {}) => h('button', { class: 'btn', type: 'button', ...props, ...(label ? {} : { 'aria-label': props['aria-label'] || '' }) }, icon(name), label ? h('span', {}, label) : null);
export const skeleton = (n = 4) => h('div', { class: 'sk-grid', 'aria-busy': 'true' }, Array.from({ length: n }, (_, i) => h('div', { class: 'sk', style: { height: i ? '46px' : '28px', width: i ? '100%' : '40%' } })));

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { el.replaceChildren(); return el; };

// ---- montants (entiers en plus petite unité) ----
export function money(n, withCur = true) {
  const d = state.pharmacy?.currency_decimals ?? 3, cur = state.pharmacy?.currency ?? '';
  const s = (n / 10 ** d).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  return withCur ? `${s} ${cur}` : s;
}
export const toMinor = (v) => Math.round(Number(String(v).replace(',', '.')) * 10 ** (state.pharmacy?.currency_decimals ?? 3));
export const fromMinor = (n) => (n / 10 ** (state.pharmacy?.currency_decimals ?? 3)).toFixed(state.pharmacy?.currency_decimals ?? 3);

// ---- toasts ----
let toastBox;
export function toast(msg, err = false, { onclick = null } = {}) {
  toastBox ||= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = toastBox.appendChild(h('div', { class: 'toast' + (err ? ' err' : '') }, icon(err ? 'alert' : 'check', { size: 18 }), h('span', {}, msg)));
  const gone = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }; el.addEventListener('click', () => { gone(); onclick?.(); }); if (onclick) { el.style.cursor = 'pointer'; el.setAttribute('role', 'link'); } setTimeout(gone, err ? 7000 : onclick ? 8000 : 3500);
}
export const fail = (e) => { if (e instanceof ApiError && e.status === 401) return; toast(e.message || String(e), true); console.warn(e); };
export async function guard(fn) { try { return await fn(); } catch (e) { fail(e); } }

// ---- modales ----
export function modal(title, body, { wide = false, actions = [], onClose = null } = {}) {
  const prev = document.activeElement;
  const close = () => { if (!ov.isConnected) return; ov.remove(); try { onClose?.(); } catch {} document.removeEventListener('keydown', esc); prev?.focus?.(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', {}, h('span', {}, title), h('button', { class: 'iconbtn x', type: 'button', 'aria-label': t('Fermer'), onclick: () => close() }, icon('x', { size: 18 }))), body,
    actions.length ? h('div', { class: 'row', style: { marginTop: '14px', justifyContent: 'flex-end' } }, actions) : null);
  const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) close(); } }, box);
  document.body.append(ov); document.addEventListener('keydown', esc);
  setTimeout(() => (box.querySelector('input,select,textarea,button') || box).focus?.(), 0);
  return { close, box };
}
// Formulaire généré : fields = [{name,label,type,options,required,value,placeholder,hint}]
export function formModal(title, fields, onSubmit, { submitLabel = 'Enregistrer', wide = false, extra = null, onClose = null } = {}) {
  const inputs = {};
  const form = h('form', { onsubmit: async (e) => { e.preventDefault(); const vals = {}; for (const f of fields) { const el = inputs[f.name]; let v = f.type === 'checkbox' ? el.checked : f.type === 'multiselect' ? [...el.selectedOptions].map((o) => o.value) : el.value; if (f.type === 'number' && v !== '') v = Number(v); if (f.type === 'money' && v !== '') v = toMinor(v); if (v === '') v = null; vals[f.name] = v; }
    btn.disabled = true; try { await onSubmit(vals); m.close(); } catch (er) { fail(er); } finally { btn.disabled = false; } } },
    fields.map((f) => {
      let el;
      if (f.type === 'select') el = h('select', { required: f.required }, (f.required ? [] : [h('option', { value: '' }, '—')]), f.options.map((o) => h('option', { value: o.value ?? o, selected: String(o.value ?? o) === String(f.value ?? '') }, o.label ?? o)));
      else if (f.type === 'multiselect') el = h('select', { multiple: true, size: Math.min(8, f.options.length || 2), style: { height: 'auto' } }, f.options.map((o) => h('option', { value: o.value, selected: Array.isArray(f.value) && f.value.map(String).includes(String(o.value)) }, o.label)));
      else if (f.type === 'phone') el = phoneField({ value: f.value ?? '', dial: f.dial, required: f.required });
      else if (f.type === 'textarea') el = h('textarea', { required: f.required, value: f.value ?? '' });
      else if (f.type === 'checkbox') el = h('input', { type: 'checkbox', checked: !!f.value, style: { width: 'auto', display: 'inline-block' } });
      else el = h('input', { type: f.type === 'money' ? 'number' : f.type || 'text', required: f.required, value: f.type === 'money' && f.value != null ? fromMinor(f.value) : f.value ?? '', step: f.type === 'money' ? 1 / 10 ** (state.pharmacy?.currency_decimals ?? 3) : f.step, min: f.min, max: f.max, maxLength: f.maxLength, placeholder: f.placeholder, autocomplete: f.type === 'password' ? 'new-password' : 'off' });
      inputs[f.name] = el;
      return h('label', { class: 'f' }, t(f.label), f.required ? ' *' : '', el, f.hint ? h('small', {}, f.hint) : null);
    }), extra);
  // Lien pays → indicatif : le champ téléphone suit le pays de l'établissement choisi
  for (const f of fields) if (f.type === 'select' && f.syncDial) { const sel = inputs[f.name], ph = inputs[f.syncDial]; if (!sel || !ph?.setDial) continue; const go = () => { const o = f.options.find((x) => String(x.value) === sel.value); if (o?.dial) ph.setDial(String(o.dial)); }; sel.addEventListener('change', go); if (!f.dialInitial) go(); }
  // Suggestions dépendantes d'un autre champ (ex. villes du pays choisi) : <datalist> rechargée à chaque changement
  for (const f of fields) if (f.suggest) { const src = inputs[f.suggest.field], el = inputs[f.name]; if (!src || !el) continue; const dl = h('datalist', { id: 'dl-' + f.name }); el.setAttribute('list', dl.id); el.setAttribute('autocomplete', 'off'); form.append(dl); let seq = 0; const load = async () => { const n = ++seq; let items = []; try { items = await f.suggest.load(src.value); } catch { /* sans suggestions */ } if (n === seq) dl.replaceChildren(...items.map((x) => h('option', { value: x }))); }; src.addEventListener('change', load); load(); }
  const btn = h('button', { class: 'btn primary', type: 'submit' }, t(submitLabel));
  form.append(h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, t('Annuler')), btn));
  const m = modal(t(title), form, { wide, onClose }); return m;
}
export function confirmDialog(msg, { reason = false, danger = false, label = 'Confirmer' } = {}) {
  return new Promise((res) => {
    let r; const ta = reason ? (r = h('textarea', { placeholder: t('Motif') + ' *', required: true, minLength: 3 })) : null;
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); done(true); } }, h('p', {}, msg), ta, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } },
      h('button', { type: 'button', class: 'btn', onclick: () => done(false) }, t('Annuler')), h('button', { class: 'btn ' + (danger ? 'danger' : 'primary') }, t(label))));
    const m = modal(t('Confirmer'), form); const done = (ok) => { m.close(); res(ok ? (reason ? r.value.trim() : true) : null); };
  });
}

// ---- tableau ----
export function table(columns, rows, { onRow, empty = 'Aucun résultat', rowClass, search } = {}) {
  if (!rows?.length) return h('div', { class: 'empty card' }, icon('inbox'), t(empty));
  const tb = h('tbody', {}, rows.map((r) => { const tr = h('tr', { class: rowClass?.(r) || '', 'data-rid': r.id ?? null, onclick: onRow ? () => onRow(r) : null, style: onRow ? { cursor: 'pointer' } : null },
    columns.map((c) => { const v = c.render ? c.render(r) : r[c.key]; return h('td', { class: (c.num ? 'num ' : '') + (c.nowrap ? 'nowrap' : ''), 'data-label': c.label ? t(c.label) : '' }, v ?? ''); })); return tr; }));
  const tw = h('div', { class: 'tw' }, h('table', { class: 'rt' }, h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label ? t(c.label) : '')))), tb));
  const none = h('div', { class: 'empty', hidden: true }, t('Aucun résultat')), box = h('input', { type: 'search', class: 'sr-search', placeholder: t('Rechercher dans la liste…'), 'aria-label': t('Rechercher dans la liste'), autocomplete: 'off', hidden: search === false || rows.length < 6 });
  box.addEventListener('input', () => { const q = box.value.trim().toLowerCase(); let n = 0; for (const tr of tb.rows) { const ok = !q || tr.textContent.toLowerCase().includes(q); tr.hidden = !ok; if (ok) n++; } none.hidden = n > 0; });
  // Export des lignes affichées (après recherche) : CSV, Excel, JSON, texte, ou PDF/impression.
  const grid = () => { const head = columns.map((c) => (c.label ? t(c.label) : '')), keep = columns.map((c, i) => (c.label ? i : -1)).filter((i) => i >= 0); const data = [...tb.rows].filter((tr) => !tr.hidden).map((tr) => keep.map((i) => (tr.cells[i]?.innerText ?? '').replace(/\s+/g, ' ').trim())); return { head: keep.map((i) => head[i]), data }; };
  const exp = h('select', { class: 'sr-export', 'aria-label': t('Exporter'), onchange: (e) => { const f = e.target.value; e.target.value = ''; if (f) exportGrid(grid(), f, document.title || 'export'); } }, h('option', { value: '' }, `⭳ ${t('Exporter')}`), ...[['csv', 'CSV'], ['xls', 'Excel (.xls)'], ['json', 'JSON'], ['txt', t('Texte')], ['pdf', 'PDF / ' + t('Imprimer')]].map(([v, l]) => h('option', { value: v }, l)));
  return h('div', { class: 'tblwrap' }, h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, box, exp), tw, none);
}
const save = (name, mime, text) => { const a = h('a', { href: URL.createObjectURL(new Blob(['\ufeff' + text], { type: mime + ';charset=utf-8' })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Export générique (utilisable aussi hors tableau) : { head: [..], data: [[..]] }
export function exportGrid({ head, data }, format, title = 'export') {
  const base = String(title).replace(/[^\w\-À-ÿ]+/g, '_').slice(0, 40) + '-' + new Date().toISOString().slice(0, 10);
  if (format === 'csv') return save(base + '.csv', 'text/csv', [head, ...data].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n'));
  if (format === 'json') return save(base + '.json', 'application/json', JSON.stringify(data.map((r) => Object.fromEntries(head.map((k, i) => [k || 'col' + i, r[i]]))), null, 1));
  if (format === 'txt') return save(base + '.txt', 'text/plain', [head, ...data].map((r) => r.join('\t')).join('\n'));
  const html = `<table border="1"><thead><tr>${head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${data.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  if (format === 'xls') return save(base + '.xls', 'application/vnd.ms-excel', `<html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
  const w = window.open('', '_blank'); if (!w) return toast(t('Autorisez les fenêtres pour exporter en PDF'));
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:12px system-ui;margin:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}</style><h2>${esc(title)}</h2><p>${new Date().toLocaleString()}</p>${html}`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}
export const badge = (text, kind = '') => h('span', { class: 'badge ' + (kind ? 'b-' + kind : '') }, text);
export function pager(res, load) {
  const pages = Math.max(1, Math.ceil(res.total / res.limit));
  return h('div', { class: 'pager' }, h('span', { class: 'muted' }, `${res.total} · ${res.page}/${pages}`),
    h('button', { class: 'btn sm', disabled: res.page <= 1, onclick: () => load(res.page - 1), 'aria-label': 'Précédent' }, icon(document.dir === 'rtl' ? 'right' : 'left', { size: 16 })), h('button', { class: 'btn sm', disabled: res.page >= pages, onclick: () => load(res.page + 1), 'aria-label': 'Suivant' }, icon(document.dir === 'rtl' ? 'left' : 'right', { size: 16 })));
}
export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': id === active, onclick: () => onChange(id) }, t(label))));
}
export const debounce = (fn, ms = 250) => { let to; return (...a) => { clearTimeout(to); to = setTimeout(() => fn(...a), ms); }; };
export const when = fmtDate;
export const STATUS = {
  prescription: { received: ['Reçue', 'info'], to_verify: ['À vérifier', 'warn'], complement_requested: ['Complément demandé', 'warn'], validated: ['Validée', 'ok'], partially_delivered: ['Partiellement délivrée', 'info'], delivered: ['Délivrée', 'ok'], rejected: ['Refusée', 'bad'] },
  order: { pending: ['En attente', 'warn'], confirmed: ['Confirmée', 'info'], preparing: ['En préparation', 'info'], ready: ['Prête', 'ok'], picked_up: ['Retirée', 'ok'], cancelled: ['Annulée', 'bad'], expired: ['Expirée', 'bad'] },
  stock: { ok: ['OK', 'ok'], low: ['Stock bas', 'warn'], critical: ['Stock critique', 'bad'], out: ['Rupture', 'bad'], over: ['Surstock', 'info'] },
  rx: { free: ['Libre', ''], prescription: ['Sur ordonnance', 'warn'], controlled: ['Produit contrôlé', 'bad'] },
};
export const statusBadge = (kind, v) => { const [l, k] = STATUS[kind][v] || [v, '']; return badge(t(l), k); };
export const methodLabel = (m) => globalThis.__pmLabels?.[m] || t({ cash: 'Espèces', card: 'Carte', mobile: 'Mobile', transfer: 'Virement', wallet: 'Portefeuille' }[m] || m);
export function fileToBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); }); }
export function barChart(data, { key = 'net', label = 'period' } = {}) {
  const W = 640, H = 170, pad = 22, max = Math.max(1, ...data.map((d) => d[key])), bw = (W - pad * 2) / Math.max(1, data.length);
  const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Graphique');
  data.forEach((d, i) => { const bh = ((H - pad * 1.6) * d[key]) / max, x = pad + i * bw + bw * 0.15;
    const r = document.createElementNS(NS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', H - pad - bh); r.setAttribute('width', bw * 0.7); r.setAttribute('height', Math.max(1, bh)); r.setAttribute('rx', 3); r.setAttribute('class', 'bar');
    const tt = document.createElementNS(NS, 'title'); tt.textContent = `${d[label]} : ${money(d[key])}`; r.append(tt); svg.append(r);
    const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', x + bw * 0.35); tx.setAttribute('y', H - 6); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('class', 'axis'); tx.textContent = String(d[label]).slice(-2); svg.append(tx); });
  return svg;
}

// Bouton « Masquer / Afficher l'historique » (mémorisé) : agit sur tous les éléments .history de l'application.
const histHidden = () => { try { return localStorage.getItem('hist.hidden') === '1'; } catch { return false; } };
document.body.classList.toggle('hide-history', histHidden());
export function historyToggle() {
  const b = h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(histHidden()) }); const paint = () => { clear(b).append(icon(histHidden() ? 'eye' : 'history', { size: 14 }), ' ', t(histHidden() ? 'Afficher l\'historique' : 'Masquer l\'historique')); b.setAttribute('aria-pressed', String(histHidden())); };
  b.onclick = () => { const v = !histHidden(); try { localStorage.setItem('hist.hidden', v ? '1' : '0'); } catch { /* ignoré */ } document.body.classList.toggle('hide-history', v); document.querySelectorAll('.history-toggle').forEach((x) => x.dispatchEvent(new Event('repaint'))); };
  b.classList.add('history-toggle'); b.addEventListener('repaint', paint); paint(); return b;
}
