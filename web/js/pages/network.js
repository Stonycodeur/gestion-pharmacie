// Réseau d'établissements (super-administrateur) : établissements, pays & drapeaux.
import { get, post, put, del, state } from '../api.js';
import { h, clear, formModal, modal, table, tabs, badge, toast, fail, confirmDialog, icon, debounce } from '../ui.js';
import { getCountries, getCities, flagImg, locate } from '../net.js';

const fileToB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
const fileToUri = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

export default async function (box) {
  const body = h('div'); let active = 'ph';
  const draw = () => { clear(body); (active === 'ph' ? drawPharmacies : drawCountries)(body); };
  box.append(h('h1', {}, 'Réseau'), tabs([['ph', 'Établissements'], ['co', 'Pays et drapeaux']], active, (k) => { active = k; draw(); }), body); draw();
}

async function drawPharmacies(body) {
  const [list, countries] = await Promise.all([get('/pharmacies'), getCountries(true)]);
  const cOpts = countries.filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.name} (+${c.dial_code})`, dial: c.dial_code }));
  const ratesCodes = (await get('/currency-rates').catch(() => [])).map((r) => r.code);
  const curList = (cid) => { const c = countries.find((x) => x.id === Number(cid)); return c?.currencies?.length ? c.currencies : ratesCodes; };
  const curOpts = (cid) => curList(cid).map((x) => ({ value: x, label: x }));
  const PF = (p = {}, creating = false) => [
    { name: 'name', label: 'Nom', required: true, value: p.name }, { name: 'country_id', label: 'Pays (détermine l\'indicatif téléphonique)', type: 'select', required: true, options: cOpts, value: p.country_id ?? p.country?.id, syncDial: 'phone', dialInitial: !!p.phone },
    { name: 'city', label: 'Ville', value: p.city, hint: 'Choisissez dans la liste du pays ou saisissez une autre ville', suggest: { field: 'country_id', load: getCities } }, { name: 'address', label: 'Adresse', value: p.address }, { name: 'phone', label: 'Téléphone', type: 'phone', value: p.phone, dial: countries.find((c) => c.id === (p.country_id))?.dial_code },
    { name: 'email', label: 'E-mail', type: 'email', value: p.email }, { name: 'lat', label: 'Latitude (GPS)', type: 'number', step: 'any', value: p.lat, hint: 'Utilisée pour « pharmacies les plus proches » et le calcul des livraisons' }, { name: 'lng', label: 'Longitude (GPS)', type: 'number', step: 'any', value: p.lng },
    { name: 'opening_hours', label: 'Horaires d\'ouverture', value: p.opening_hours, placeholder: 'Lun–Sam 8h–20h' }, { name: 'currency', label: 'Devise principale', type: 'select', required: true, options: curOpts(p.country_id ?? p.country?.id), value: p.currency || '' }, { name: 'currencies', label: 'Devises acceptées (parmi celles du pays — Ctrl/⌘ pour plusieurs)', type: 'multiselect', options: curOpts(p.country_id ?? p.country?.id), value: String(p.currencies || p.currency || '').split(',') }, { name: 'currency_decimals', label: 'Décimales', type: 'number', value: p.currency_decimals ?? 3 },
    { name: 'public_listed', label: 'Visible par les clients', type: 'checkbox', value: p.public_listed ?? 1 }, { name: 'appointments_enabled', label: 'Prise de rendez-vous médecin activée', type: 'checkbox', value: p.appointments_enabled },
    ...(creating ? [{ name: 'copy_catalog_from', label: 'Copier tous les médicaments de…', type: 'select', options: list.map((x) => ({ value: x.id, label: x.name })), hint: 'Laissez vide pour créer les produits un par un' }] : []),
  ];
  const clean = (v) => ({ ...v, country_id: Number(v.country_id), currencies: (v.currencies || []).length ? v.currencies : [v.currency], public_listed: !!v.public_listed, appointments_enabled: !!v.appointments_enabled });
  const geoBtn = (m) => { const b = h('button', { type: 'button', class: 'btn sm', onclick: async () => { try { const p = await locate(); const f = m.box.querySelector('form'); const set = (n, v) => { const i = [...f.querySelectorAll('label.f')].find((l) => l.textContent.startsWith(n))?.querySelector('input'); if (i) i.value = v.toFixed(6); }; set('Latitude', p.lat); set('Longitude', p.lng); toast('Position de cet appareil utilisée'); } catch (e) { fail(e); } } }, icon('pin', { size: 14 }), 'Utiliser ma position actuelle'); return b; };
  // Quand le pays change, les devises proposées sont celles de ce pays (un pays peut en avoir plusieurs).
  const wireCurrencies = (f) => { if (!f) return; const sels = [...f.querySelectorAll('select')], ctry = sels[0], main = sels.find((x) => !x.multiple && x !== ctry && [...x.options].some((o) => o.value === 'TND' || /^[A-Z]{3}$/.test(o.value))), multi = f.querySelector('select[multiple]'); if (!ctry || !main || !multi) return;
    const fill = (keep) => { const opts = curList(ctry.value), prevMain = main.value, prevMulti = new Set([...multi.selectedOptions].map((o) => o.value)); main.replaceChildren(...opts.map((c) => h('option', { value: c, selected: c === prevMain }, c))); multi.replaceChildren(...opts.map((c) => h('option', { value: c, selected: keep ? prevMulti.has(c) : c === main.value }, c))); if (![...multi.selectedOptions].length && multi.options[0]) multi.options[0].selected = true; };
    ctry.addEventListener('change', () => fill(false)); };
  const open = (title, fields, submit, creating) => { const m = formModal(title, fields, submit, { wide: true, extra: null }); const f = m.box?.querySelector?.('form'); wireCurrencies(f); if (f) f.insertBefore(h('div', { class: 'row', style: { marginBottom: '8px' } }, geoBtn(m)), f.children[8] || null); return m; };
  const wrap = h('div', { class: 'card' });
  clear(wrap).append(h('div', { class: 'row between' }, h('h2', {}, 'Établissements'), h('button', { class: 'btn sm primary', onclick: () => open('Nouvel établissement', PF({}, true), async (v) => { await post('/pharmacies', clean(v)); toast('Établissement créé'); clear(body); drawPharmacies(body); }, true) }, icon('plus', { size: 14 }), 'Nouveau')),
    table([
      { label: '', render: (p) => p.logo_url ? h('img', { src: p.logo_url, alt: '', width: 36, height: 36, style: { borderRadius: '8px', objectFit: 'cover' } }) : h('span', { class: 'avatar-lg', style: { width: '36px', height: '36px', fontSize: '1rem' } }, p.name[0]) },
      { label: 'Nom', render: (p) => h('div', {}, h('strong', {}, p.name), h('div', { class: 'muted' }, [p.city, p.address].filter(Boolean).join(' · '))) },
      { label: 'Pays', render: (p) => { const c = countries.find((x) => x.id === p.country_id); return c ? h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, flagImg(c), `${c.name} (+${c.dial_code})`) : '—'; } },
      { label: 'Gestionnaire', render: (p) => p.manager ? h('span', {}, p.manager.name) : h('span', { class: 'muted' }, 'Non affecté') },
      { label: 'Statut', render: (p) => h('span', {}, badge(p.status === 'active' ? 'Actif' : 'Désactivé', p.status === 'active' ? 'ok' : 'bad'), ' ', p.appointments_enabled ? badge('RDV', 'info') : null) },
      { label: '', render: (p) => h('span', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => open('Modifier l\'établissement', PF(p), async (v) => { await put('/pharmacies/' + p.id, clean(v)); clear(body); drawPharmacies(body); }) }, icon('edit', { size: 14 }), 'Modifier'),
        h('button', { class: 'btn sm', onclick: () => logoModal(p, () => { clear(body); drawPharmacies(body); }) }, icon('image', { size: 14 }), 'Logo'),
        h('button', { class: 'btn sm', onclick: () => managerModal(p, () => { clear(body); drawPharmacies(body); }) }, icon('user', { size: 14 }), 'Gestionnaire'),
        h('button', { class: 'btn sm', onclick: () => catalogModal(p, list) }, icon('pill', { size: 14 }), 'Médicaments'),
        h('button', { class: 'btn sm', onclick: async () => { const to = p.status === 'active' ? 'disabled' : 'active'; if (await confirmDialog(to === 'disabled' ? 'Désactiver cet établissement ? Ses utilisateurs ne pourront plus se connecter.' : 'Réactiver cet établissement ?')) try { await post(`/pharmacies/${p.id}/status`, { status: to }); clear(body); drawPharmacies(body); } catch (e) { fail(e); } } }, p.status === 'active' ? 'Désactiver' : 'Réactiver'),
        h('button', { class: 'btn sm danger', 'aria-label': 'Supprimer', onclick: async () => { if (await confirmDialog(`Supprimer « ${p.name} » ? Possible seulement s'il est vide.`, { danger: true })) try { await del('/pharmacies/' + p.id); clear(body); drawPharmacies(body); } catch (e) { fail(e); } } }, icon('trash', { size: 14 }))) },
    ], list));
  body.append(wrap);
}

function logoModal(p, done) {
  const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' }); const prev = h('div', {}, p.logo_url ? h('img', { src: p.logo_url, alt: 'Logo', height: 64, style: { borderRadius: '10px' } }) : h('p', { class: 'muted' }, 'Aucun logo'));
  inp.addEventListener('change', async () => { const f = inp.files[0]; if (!f) return; clear(prev).append(h('img', { src: URL.createObjectURL(f), alt: 'Aperçu', height: 64, style: { borderRadius: '10px' } })); });
  const m = modal(`Logo — ${p.name}`, h('div', {}, h('p', { class: 'muted' }, 'Affiché sur les e-mails (bienvenue, demandes de prix) et dans l\'application. PNG, JPEG ou WebP, 1 Mo max.'), prev, inp,
    h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } }, p.logo_url ? h('button', { class: 'btn danger', onclick: async () => { try { await del(`/pharmacies/${p.id}/logo`); m.close(); done(); } catch (e) { fail(e); } } }, 'Retirer') : null,
      h('button', { class: 'btn primary', onclick: async () => { const f = inp.files[0]; if (!f) return toast('Choisissez une image', true); try { await post(`/pharmacies/${p.id}/logo`, { file: { mime: f.type, name: f.name, data_base64: await fileToB64(f) } }); toast('Logo enregistré'); m.close(); done(); } catch (e) { fail(e); } } }, 'Enregistrer'))));
}

async function managerModal(p, done) {
  const users = (await get(`/users?pharmacy_id=${p.id}&kind=staff&limit=200`).catch(() => ({ data: [] }))).data || [];
  const roles = (await get('/roles').catch(() => [])).filter((r) => !['super_admin', 'customer', 'guest'].includes(r.code));
  const mode = h('select', {}, h('option', { value: 'new' }, 'Créer un nouveau compte'), users.length ? h('option', { value: 'existing' }, 'Choisir un membre du personnel') : null);
  const exist = h('select', { hidden: true }, users.map((u) => h('option', { value: u.id }, `${u.name} — ${u.email}`)));
  const name = h('input', { placeholder: 'Nom complet' }), email = h('input', { type: 'email', placeholder: 'E-mail' });
  const role = h('select', {}, roles.map((r) => h('option', { value: r.code, selected: r.code === 'pharmacy_admin' }, r.label || r.code)));
  const nf = h('div', { class: 'grid g2' }, h('label', { class: 'f' }, 'Nom', name), h('label', { class: 'f' }, 'E-mail', email));
  mode.addEventListener('change', () => { exist.hidden = mode.value !== 'existing'; nf.hidden = mode.value !== 'new'; });
  const m = modal(`Gestionnaire — ${p.name}`, h('div', {}, h('p', { class: 'muted' }, 'Le gestionnaire administre les utilisateurs de cet établissement uniquement, avec les droits de son rôle (ajustables ensuite dans Utilisateurs → Droits).'), h('label', { class: 'f' }, 'Compte', mode), exist, nf, h('label', { class: 'f' }, 'Rôle / droits', role),
    h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: async () => {
      try { const b = mode.value === 'existing' ? { user_id: Number(exist.value), role_code: role.value } : { name: name.value, email: email.value, role_code: role.value }; const r = await post(`/pharmacies/${p.id}/manager`, b); m.close(); done();
        if (r.temporary_password) modal('Compte créé', h('div', {}, h('p', {}, 'Mot de passe provisoire (envoyé aussi par e-mail si l\'envoi est configuré) :'), h('code', { style: { fontSize: '1.2rem', userSelect: 'all' } }, r.temporary_password), h('p', { class: 'muted' }, 'À changer dès la première connexion.'))); else toast('Gestionnaire affecté'); } catch (e) { fail(e); } } }, 'Affecter'))));
}

async function catalogModal(p, list) {
  const stat = h('p', { class: 'muted' }), rows = h('div', { style: { maxHeight: '46vh', overflow: 'auto' } }); const q = h('input', { type: 'search', placeholder: 'Rechercher un produit…', 'aria-label': 'Rechercher' });
  const load = async () => { const r = await get(`/pharmacies/${p.id}/catalog?q=${encodeURIComponent(q.value)}`); stat.textContent = `${r.total_in_catalog} produit(s) dans le catalogue de cette pharmacie`;
    clear(rows).append(...(r.data.length ? r.data.map((x) => h('div', { class: 'list-item' }, h('span', {}, `${x.name} ${x.dosage || ''}`), x.in_catalog ? h('button', { class: 'btn sm danger', onclick: async () => { try { await del(`/pharmacies/${p.id}/catalog/${x.id}`); load(); } catch (e) { fail(e); } } }, 'Retirer') : h('button', { class: 'btn sm', onclick: async () => { await post(`/pharmacies/${p.id}/catalog`, { product_ids: [x.id] }); load(); } }, 'Ajouter'))) : [h('div', { class: 'empty' }, 'Aucun résultat')])); };
  q.addEventListener('input', debounce(load, 250));
  const src = h('select', {}, h('option', { value: '' }, 'Copier tous les médicaments de…'), list.filter((x) => x.id !== p.id).map((x) => h('option', { value: x.id }, x.name)));
  modal(`Médicaments — ${p.name}`, h('div', {}, stat, h('div', { class: 'row' }, src, h('button', { class: 'btn', onclick: async () => { if (!src.value) return; try { await post(`/pharmacies/${p.id}/catalog`, { copy_from: Number(src.value) }); toast('Médicaments copiés'); load(); } catch (e) { fail(e); } } }, 'Copier')), h('p', { class: 'muted' }, 'Pour créer un produit spécifique à cette pharmacie : Produits → Nouveau, puis choisissez les pharmacies concernées.'), q, rows), { wide: true }); await load();
}

async function drawCountries(body) {
  const rows = await getCountries(true).then(() => get('/countries?all=1'));
  const CF = (c) => { c ||= {}; return [{ name: 'iso2', label: 'Code ISO (2 lettres)', required: true, value: c.iso2, maxLength: 2 }, { name: 'name_fr', label: 'Nom (français)', required: true, value: c.name_fr }, { name: 'name_en', label: 'Nom (anglais)', value: c.name_en }, { name: 'name_ar', label: 'Nom (arabe)', value: c.name_ar },
    { name: 'dial_code', label: 'Indicatif (sans +)', required: true, value: c.dial_code, maxLength: 4 }, { name: 'currencies', label: 'Devises utilisées dans ce pays (codes séparés par des virgules, la première est la principale)', value: (c.currencies || []).join(', '), placeholder: 'XAF, USD' }, { name: 'phone_min', label: 'Chiffres min. du numéro local', type: 'number', value: c.phone_min ?? 8 }, { name: 'phone_max', label: 'Chiffres max.', type: 'number', value: c.phone_max ?? 9 }, { name: 'active', label: 'Actif', type: 'checkbox', value: c.active ?? 1 }]; };
  const refresh = async () => { await getCountries(true); clear(body); drawCountries(body); };
  const edit = (c) => {
    let file = null, reset = false; const prev = h('span', {}, c ? flagImg(c, 40) : '');
    const inp = h('input', { type: 'file', accept: 'image/svg+xml,image/png,image/jpeg,image/webp' });
    inp.addEventListener('change', async () => { file = inp.files[0] || null; reset = false; if (file) { prev.replaceChildren(h('img', { class: 'flag', alt: '', src: await fileToUri(file), style: { width: '40px', height: '30px', objectFit: 'contain' } })); } });
    const extra = h('div', { class: 'f' }, h('label', {}, 'Drapeau (SVG, PNG, JPEG ou WebP, 40 Ko max)', inp), h('div', { class: 'row' }, prev, c?.custom_flag ? h('button', { type: 'button', class: 'btn sm', onclick: () => { reset = true; file = null; inp.value = ''; prev.replaceChildren(h('small', {}, 'Drapeau par défaut rétabli à l\'enregistrement')); } }, 'Rétablir le drapeau par défaut') : h('small', { class: 'muted' }, 'Un drapeau est fourni par défaut ; téléversez une image seulement pour le remplacer.')));
    formModal(c ? `Modifier — ${c.name_fr}` : 'Nouveau pays', CF(c), async (v) => {
      const b = { ...v, active: !!v.active }; if (file) b.flag = await fileToUri(file); else if (reset) b.flag = null;
      if (c) { delete b.iso2; await put('/countries/' + c.id, b); } else await post('/countries', b);
      toast('Pays enregistré'); await refresh();
    }, { extra });
  };
  const cities = async (c) => {
    const list = h('div', { style: { maxHeight: '44vh', overflow: 'auto' } }), q = h('input', { type: 'search', placeholder: 'Filtrer…', 'aria-label': 'Filtrer les villes' }), add = h('input', { placeholder: 'Nouvelle ville', 'aria-label': 'Nouvelle ville', maxLength: 80 });
    let data = [];
    const draw = () => { const f = q.value.trim().toLowerCase(); list.replaceChildren(...(data.filter((x) => x.name.toLowerCase().includes(f)).map((x) => h('div', { class: 'list-item' }, h('span', {}, x.name), h('button', { class: 'btn sm danger', 'aria-label': 'Retirer ' + x.name, onclick: async () => { try { await del('/cities/' + x.id); data = data.filter((y) => y.id !== x.id); draw(); } catch (e) { fail(e); } } }, icon('trash', { size: 14 })))))); if (!list.childNodes.length) list.append(h('p', { class: 'muted' }, 'Aucune ville')); stat.textContent = `${data.length} ville(s)`; };
    const stat = h('p', { class: 'muted' });
    const load = async () => { data = await get(`/countries/${c.id}/cities`); draw(); };
    q.addEventListener('input', draw);
    modal(`Villes — ${c.name_fr}`, h('div', {}, stat, q, list, h('form', { class: 'row', style: { marginTop: '10px' }, onsubmit: async (e) => { e.preventDefault(); const name = add.value.trim(); if (!name) return; try { await post(`/countries/${c.id}/cities`, { name }); add.value = ''; await load(); } catch (er) { fail(er); } } }, add, h('button', { class: 'btn primary', type: 'submit' }, icon('plus', { size: 14 }), 'Ajouter'))));
    await load();
  };
  const q = h('input', { type: 'search', placeholder: 'Rechercher un pays, un code ou un indicatif…', 'aria-label': 'Rechercher un pays' }), wrap = h('div');
  const drawTable = () => { const f = q.value.trim().toLowerCase().replace(/^\+/, ''); const sel = rows.filter((c) => !f || [c.name_fr, c.name_en, c.iso2, c.dial_code].some((x) => String(x || '').toLowerCase().includes(f)));
    clear(wrap).append(table([{ label: '', render: (c) => flagImg(c, 30) }, { label: 'Pays', render: (c) => h('strong', {}, c.name_fr) }, { label: 'Indicatif', render: (c) => '+' + c.dial_code }, { label: 'Chiffres', render: (c) => c.phone_min === c.phone_max ? c.phone_min : `${c.phone_min}–${c.phone_max}` }, { label: 'Statut', render: (c) => badge(c.active ? 'Actif' : 'Inactif', c.active ? 'ok' : '') },
      { label: '', render: (c) => h('span', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => edit(c) }, icon('edit', { size: 14 }), 'Modifier'), h('button', { class: 'btn sm', onclick: () => cities(c) }, icon('pin', { size: 14 }), 'Villes'),
        h('button', { class: 'btn sm danger', 'aria-label': 'Supprimer', onclick: async () => { if (await confirmDialog(`Supprimer ${c.name_fr} ?`, { danger: true })) try { await del('/countries/' + c.id); toast('Pays supprimé'); await refresh(); } catch (e) { fail(e); } } }, icon('trash', { size: 14 }))) }], sel)); };
  q.addEventListener('input', debounce(drawTable, 150)); drawTable();
  body.append(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, `Pays et drapeaux (${rows.length})`), h('button', { class: 'btn sm primary', onclick: () => edit(null) }, icon('plus', { size: 14 }), 'Nouveau pays')),
    h('p', { class: 'muted' }, 'L\'indicatif d\'un établissement suit son pays : les utilisateurs de cet établissement saisissent seulement le numéro local. Tous les pays du monde sont préchargés avec leur drapeau et leurs villes principales.'), q, wrap));
}
