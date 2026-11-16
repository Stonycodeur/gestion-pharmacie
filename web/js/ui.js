// Petite bibliothèque d'interface : construction DOM sûre (textContent, jamais innerHTML avec des données).
import { t, fmtDate } from './i18n.js';
import { phoneField } from './net.js';
import { state, ApiError, postBlob } from './api.js';
import { icon } from './icons.js';
export { icon };
// Bouton avec icône SVG : ib('plus', 'Nouveau', { class:'btn primary', onclick })
export const ib = (name, label, props = {}) => h('button', { class: 'btn', type: 'button', ...props, ...(label ? {} : { 'aria-label': props['aria-label'] || '' }) }, icon(name), label ? h('span', {}, label) : null);
export const skeleton = (n = 4) => h('div', { class: 'sk-grid', 'aria-busy': 'true' }, Array.from({ length: n }, (_, i) => h('div', { class: 'sk', style: { height: i ? '46px' : '28px', width: i ? '100%' : '40%' } })));

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (typeof v === 'boolean' && k.startsWith('aria-')) { el.setAttribute(k, String(v)); continue; } // aria-selected=true (et non une valeur vide)
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
      el.name = f.name; inputs[f.name] = el;
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
  const none = h('div', { class: 'empty', hidden: true }, t('Aucun résultat')), box = h('input', { type: 'search', class: 'sr-search tsb', placeholder: t('Rechercher dans la liste…'), 'aria-label': t('Rechercher dans la liste'), autocomplete: 'off', hidden: search === false || rows.length < 6 });
  // Recherche sur toutes les colonnes affichées. Une seule recherche par page (cf. onePerPage) : si plusieurs tableaux sont visibles, la recherche maîtresse les filtre tous.
  const apply = (q) => { let n = 0; for (const tr of tb.rows) { const ok = !q || tr.textContent.toLowerCase().includes(q); tr.hidden = !ok; if (ok) n++; } none.hidden = n > 0; }; box._apply = apply;
  box.addEventListener('input', () => { const q = box.value.trim().toLowerCase(); apply(q); if (box.dataset.master) for (const o of document.querySelectorAll('#content .tsb')) if (o !== box && o._apply) { o.value = box.value; o._apply(q); } });
  // Export des lignes affichées (après recherche) : CSV, Excel, JSON, texte, ou PDF/impression.
  const grid = () => { const head = columns.map((c) => (c.label ? t(c.label) : '')), keep = columns.map((c, i) => (c.label ? i : -1)).filter((i) => i >= 0); const data = [...tb.rows].filter((tr) => !tr.hidden).map((tr) => keep.map((i) => (tr.cells[i]?.innerText ?? '').replace(/\s+/g, ' ').trim())); return { head: keep.map((i) => head[i]), data }; };
  const exp = h('select', { class: 'sr-export', 'aria-label': t('Exporter'), onchange: (e) => { const f = e.target.value; e.target.value = ''; if (f) exportGrid(grid(), f, document.title || 'export'); } }, h('option', { value: '' }, `⭳ ${t('Exporter')}`), ...[['xlsx', 'Excel (.xlsx)'], ['pdf', 'PDF'], ['csv', 'CSV'], ['print', t('Imprimer')], ['json', 'JSON'], ['txt', t('Texte')]].map(([v, l]) => h('option', { value: v }, l)));
  return h('div', { class: 'tblwrap' }, h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, box, exp), tw, none);
}
const save = (name, mime, text) => { const a = h('a', { href: URL.createObjectURL(new Blob(['\ufeff' + text], { type: mime + ';charset=utf-8' })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Nombres lus avec les séparateurs de la langue : les colonnes 100 % numériques partent en Excel comme de vrais nombres (triables, totalisables).
function typedGrid(head, data) {
  const parts = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1 }).formatToParts(12345.6), grp = parts.find((p) => p.type === 'group')?.value || ',', dcm = parts.find((p) => p.type === 'decimal')?.value || '.', cur = state.pharmacy?.currency || '';
  const num = (v) => { let x = String(v).replace(/[\s\u00a0\u202f]/g, ''); if (cur) x = x.replace(cur, ''); if (!x || /[^\d.,\-+]/.test(x)) return null; x = x.split(grp.replace(/[\s\u00a0\u202f]/g, '') || ',').join('').replace(dcm, '.'); if (!/^-?\d+(\.\d+)?$/.test(x) || /^-?0\d/.test(x) || x.replace(/\D/g, '').length > 15) return null; return x; };
  const dec = head.map((_, c) => { let any = false, d = 0; for (const r of data) { const v = r[c]; if (v === '' || v == null) continue; const n = num(v); if (n === null) return null; any = true; d = Math.max(d, (n.split('.')[1] || '').length); } return any ? d : null; });
  return { dec, rows: data.map((r) => r.map((v, c) => (dec[c] !== null && v !== '' && v != null ? Number(num(v)) : v))) };
}
const logoSrc = () => (state.pharmacy?.logo_path ? `/api/v1/public/file/${state.pharmacy.logo_path}` : '/assets/icon-192.png');
// Export générique (utilisable aussi hors tableau) : { head: [..], data: [[..]] }. Titre = page, sous-titre = vue (onglet) — ex. « Stock » › « Lots ».
export async function exportGrid({ head, data }, format, title = 'export', subtitle) {
  const x = window.__gpx || {}, ttl = x.page || title, sub = subtitle ?? x.view ?? '';
  const base = (String(ttl) + (sub ? '-' + sub : '')).replace(/[^\w\-À-ÿ]+/g, '_').slice(0, 60) + '-' + new Date().toISOString().slice(0, 10);
  if (format === 'csv') return save(base + '.csv', 'text/csv', [head, ...data].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n'));
  if (format === 'json') return save(base + '.json', 'application/json', JSON.stringify({ title: ttl, view: sub, pharmacy: state.pharmacy?.name || '', exported_at: new Date().toISOString(), rows: data.map((r) => Object.fromEntries(head.map((k, i) => [k || 'col' + i, r[i]]))) }, null, 1));
  if (format === 'txt') return save(base + '.txt', 'text/plain', [`${ttl}${sub ? ' · ' + sub : ''}`, state.pharmacy?.name || '', '', head, ...data].map((r) => (Array.isArray(r) ? r.join('\t') : r)).join('\n'));
  if (format === 'xlsx' || format === 'xls' || format === 'pdf') {
    try { const { dec, rows } = typedGrid(head, data), { blob, name } = await postBlob('/export/grid', { format: format === 'pdf' ? 'pdf' : 'xlsx', title: ttl, subtitle: sub, head, data: rows, dec }); const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800); return; }
    catch (e) { if (e?.status && e.status < 500) return toast(e.message || t('Export impossible')); if (format !== 'pdf') return save(base + '.csv', 'text/csv', [head, ...data].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')), toast(t('Hors connexion : export CSV à la place')); /* PDF hors connexion : aperçu imprimable */ }
  }
  const html = `<table><thead><tr>${head.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${data.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const w = window.open('', '_blank'); if (!w) return toast(t('Autorisez les fenêtres pour imprimer'));
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(ttl)}${sub ? ' · ' + esc(sub) : ''}</title><base href="${location.origin}/"><style>@page{size:A4 landscape;margin:12mm}body{font:11px system-ui,Segoe UI,Arial;margin:0;color:#14201f}.hd{display:flex;gap:14px;align-items:center;border-top:6px solid #0f766e;padding:12px 0 10px;border-bottom:1.5px solid #0f766e;margin-bottom:12px}.hd img{height:52px;width:auto;max-width:120px;object-fit:contain}.hd .ph{font-weight:700;color:#667370;font-size:12px}.hd h1{margin:2px 0;font-size:21px}.hd h2{margin:0;font-size:13px;color:#0f766e}.hd .r{margin-inline-start:auto;text-align:end;color:#667370;font-size:11px;line-height:1.6}table{border-collapse:collapse;width:100%}th{background:#0f766e;color:#fff;text-align:left;padding:6px 8px;font-size:11px}td{border-bottom:1px solid #d9e1df;padding:5px 8px}tr:nth-child(even) td{background:#f3f8f7}thead{display:table-header-group}tr{break-inside:avoid}.ft{margin-top:10px;color:#667370;font-size:10px}</style><div class="hd"><img src="${esc(logoSrc())}" alt=""><div><div class="ph">${esc(state.pharmacy?.name || '')}</div><h1>${esc(ttl)}</h1>${sub ? `<h2>${esc(sub)}</h2>` : ''}</div><div class="r">${esc(new Date().toLocaleString())}<br>${esc(state.user?.name || '')}<br>${data.length} ${esc(t('ligne(s)'))}</div></div>${html}<div class="ft">${esc(state.pharmacy?.name || '')} — ${esc(ttl)}${sub ? ' · ' + esc(sub) : ''}</div>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
}
export const badge = (text, kind = '') => h('span', { class: 'badge ' + (kind ? 'b-' + kind : '') }, text);
export function pager(res, load) {
  const pages = Math.max(1, Math.ceil(res.total / res.limit));
  return h('div', { class: 'pager' }, h('span', { class: 'muted' }, `${res.total} · ${res.page}/${pages}`),
    h('button', { class: 'btn sm', disabled: res.page <= 1, onclick: () => load(res.page - 1), 'aria-label': 'Précédent' }, icon(document.dir === 'rtl' ? 'right' : 'left', { size: 16 })), h('button', { class: 'btn sm', disabled: res.page >= pages, onclick: () => load(res.page + 1), 'aria-label': 'Suivant' }, icon(document.dir === 'rtl' ? 'left' : 'right', { size: 16 })));
}
// Onglets : l'onglet actif est marqué (trait + fond) et annoncé comme « vue courante » dans l'en-tête (évènement gp:view).
export function tabs(items, active, onChange) {
  const cur = items.find(([id]) => id === active); if (cur) window.dispatchEvent(new CustomEvent('gp:view', { detail: t(cur[1]) }));
  return h('div', { class: 'tabs', role: 'tablist' }, items.map(([id, label]) => h('button', { role: 'tab', type: 'button', 'aria-selected': id === active, 'aria-current': id === active ? 'page' : null, onclick: () => onChange(id) }, t(label))));
}
// Bloc repliable (▶) pour les éléments passés : « Commandes passées », « Livraisons passées », « Courses passées »…
export function collapsible(title, { count, onOpen, open = false } = {}) {
  const sum = h('summary', {}, h('span', { class: 'tri', 'aria-hidden': 'true' }, '▶'), h('strong', {}, t(title)), count != null ? h('span', { class: 'badge b-info', style: { marginInlineStart: '8px' } }, String(count)) : '');
  const body = h('div', { class: 'past-body' }), el = h('details', { class: 'past history card' }, sum, body); if (open) el.open = true;
  el.addEventListener('toggle', () => { if (el.open && onOpen) onOpen(body); }); return { el, body };
}
// Éléments passés d'une liste déjà chargée : recherche large (tous les champs), dates, statut, filtres à facettes
// (select auto-alimenté ou montants min/max) et tri. render(rows) renvoie un nœud (ou une promesse).
// filters : [{ label, get: (r) => valeur, labels?: {valeur: libellé} }]  → liste déroulante des valeurs distinctes
//           [{ label, num: 'min'|'max', get: (r) => nombre }]            → champ numérique (≥ / ≤)
export function pastBlock({ title, rows, statuses = {}, text = (r) => JSON.stringify(r), day = (r) => String(r.updated_at || r.created_at || '').slice(0, 10), stat = (r) => r.status, filters = [], sorts, render, empty = 'Aucun élément passé' }) {
  const mk = (tag, p) => h(tag, { ...p, 'aria-label': t(p.label || p.placeholder || '') });
  const q = mk('input', { type: 'search', class: 'sr-search', placeholder: t('Rechercher (n°, produit, pharmacie, montant, date…)') }), from = mk('input', { type: 'date', label: 'Du' }), to = mk('input', { type: 'date', label: 'Au' });
  const st = mk('select', { label: 'Statut' }); st.append(h('option', { value: '' }, t('Tous les statuts')), ...Object.entries(statuses).map(([k, l]) => h('option', { value: k }, t(l))));
  const fx = filters.map((f) => { if (f.num) return { f, el: mk('input', { type: 'number', min: 0, step: 'any', placeholder: t(f.label), label: f.label, style: { maxWidth: '150px' } }) };
    const vals = [...new Set(rows.map(f.get).filter((v) => v != null && v !== ''))]; const el = mk('select', { label: f.label }); el.append(h('option', { value: '' }, t(f.label)), ...vals.map((v) => h('option', { value: String(v) }, t((f.labels || {})[v] || String(v))))); return { f, el, hide: vals.length < 2 }; });
  const SORTS = sorts || [['recent', 'Plus récentes', (a, b) => String(day(b)).localeCompare(String(day(a)))], ['old', 'Plus anciennes', (a, b) => String(day(a)).localeCompare(String(day(b)))]];
  const so = mk('select', { label: 'Trier' }); so.append(...SORTS.map(([k, l]) => h('option', { value: k }, t(l))));
  const out = h('div'), count = h('small', { class: 'muted' });
  const draw = async () => { const k = q.value.trim().toLowerCase();
    const list = rows.filter((r) => (!k || text(r).toLowerCase().includes(k)) && (!from.value || day(r) >= from.value) && (!to.value || day(r) <= to.value) && (!st.value || stat(r) === st.value)
      && fx.every(({ f, el }) => !el.value || (f.num ? (f.num === 'min' ? Number(f.get(r)) >= Number(el.value) : Number(f.get(r)) <= Number(el.value)) : String(f.get(r)) === el.value))).sort(SORTS.find((x) => x[0] === so.value)[2]);
    count.textContent = `${list.length} / ${rows.length}`; const node = list.length ? await render(list) : h('div', { class: 'empty' }, t('Aucun résultat : modifiez ou réinitialisez les filtres')); clear(out).append(node); };
  const c = collapsible(title, { count: rows.length, onOpen: () => draw().catch(() => {}) });
  const all = [q, from, to, ...(Object.keys(statuses).length ? [st] : []), ...fx.filter((x) => !x.hide).map((x) => x.el), so];
  for (const el of all) { el.addEventListener('input', () => draw().catch(() => {})); el.addEventListener('change', () => draw().catch(() => {})); }
  const reset = h('button', { type: 'button', class: 'btn sm', onclick: () => { for (const el of [q, from, to, st, ...fx.map((x) => x.el)]) el.value = ''; so.value = SORTS[0][0]; draw().catch(() => {}); } }, t('Réinitialiser'));
  c.body.append(h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px', margin: '10px 0', alignItems: 'center' } }, ...all, reset, count), out); return c.el;
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

// Une seule fonction de recherche par page : si la page a déjà sa recherche (serveur, multi-champs) la recherche intégrée des tableaux est masquée ;
// sinon la première recherche intégrée devient « maîtresse » et filtre tous les tableaux de la page. Les fenêtres (modales) et les blocs « passés » gardent la leur.
export function onePerPage(root = document.getElementById('content')) {
  if (!root) return;
  const own = (i) => !i.closest('.overlay,.modal,details.past') && !i.hidden && !i.disabled;
  const all = [...root.querySelectorAll('input[type=search]')].filter(own), page = all.filter((i) => !i.classList.contains('tsb')), built = all.filter((i) => i.classList.contains('tsb'));
  let master = null;
  for (const b of built) { const hide = page.length > 0 || (master && master !== b); if (hide) b.dataset.dup = '1'; else { delete b.dataset.dup; master ||= b; } }
  for (const b of built) { if (b === master && built.length > 1) b.dataset.master = '1'; else delete b.dataset.master; }
}
