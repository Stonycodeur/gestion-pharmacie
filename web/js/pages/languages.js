// Langues & traductions (super-administrateur) : ajouter n'importe quelle langue, compléter celles qui existent, exporter / importer en JSON.
import { h, clear, toast, fail, icon, confirmDialog } from '../ui.js';
import { get, put, del } from '../api.js';
import { t, languages, knownKeys, dictOf, loadLanguages, loadPack, lang as curLang } from '../i18n.js';

export default async function languagesCard() {
  await loadLanguages().catch(() => {});
  const box = h('div', { class: 'card', style: { marginTop: '16px' } }), listBox = h('div'); let code = curLang === 'fr' ? 'en' : curLang, edits = {}, only = false, q = '', name = '', rtl = false, custom = false;
  const langs = () => languages().filter(([k]) => k !== 'fr');
  const load = async (c) => { code = c; edits = {}; const p = await get('/i18n/pack/' + c).catch(() => ({ strings: {} })); edits = { ...dictOf(c), ...(p.strings || {}) }; const known = langs().find(([k]) => k === c); name = known ? known[1] : name; paint(); };
  const paint = () => {
    const keys = knownKeys().filter((k) => (!q || k.toLowerCase().includes(q.toLowerCase()) || (edits[k] || '').toLowerCase().includes(q.toLowerCase())) && (!only || !edits[k]));
    const done = knownKeys().filter((k) => edits[k]).length;
    clear(listBox).append(h('p', { class: 'muted' }, `${done} / ${knownKeys().length} ${t('libellés traduits')}. ${t('Les libellés non traduits s\'affichent en anglais, sinon en français.')}`),
      ...keys.slice(0, 80).map((k) => h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px', margin: '4px 0', alignItems: 'center' } }, h('div', { style: { flex: '1 1 220px' } }, h('strong', {}, k)), h('input', { style: { flex: '1 1 220px', width: 'auto' }, value: edits[k] || '', maxLength: 400, 'aria-label': `${t('Traduction de')} ${k}`, oninput: (e) => { edits[k] = e.target.value; } }))),
      keys.length > 80 ? h('p', { class: 'muted' }, `${keys.length - 80} ${t('autres libellés : affinez la recherche')}`) : null);
  };
  const sel = h('select', { 'aria-label': t('Langue à modifier'), onchange: (e) => { if (e.target.value === '+') { custom = true; code = ''; edits = {}; name = ''; draw(); } else { custom = false; load(e.target.value); draw(); } } }, ...langs().map(([k, n]) => h('option', { value: k, selected: !custom && k === code }, `${n} (${k})`)), h('option', { value: '+', selected: custom }, `+ ${t('Nouvelle langue')}`));
  const search = h('input', { type: 'search', placeholder: t('Rechercher un libellé…'), oninput: (e) => { q = e.target.value; paint(); } });
  function draw() {
    const codeIn = h('input', { value: code, maxLength: 8, placeholder: 'ln, sw, wo, ha…', disabled: !custom, 'aria-label': t('Code de la langue'), oninput: (e) => { code = e.target.value.trim().toLowerCase(); } }), nameIn = h('input', { value: name, maxLength: 40, placeholder: t('Nom (ex. Lingála)'), oninput: (e) => { name = e.target.value; }, disabled: !custom && ['en', 'ar', 'es', 'pt', 'de', 'it', 'tr'].includes(code) });
    clear(box).append(h('h3', {}, icon('globe', { size: 18 }), ' ', t('Langues & traductions')), h('p', { class: 'muted' }, t('L\'application accepte autant de langues que vous le souhaitez. Choisissez une langue ou créez-en une, traduisez les libellés (ou exportez le fichier pour le faire traduire puis réimportez-le).')),
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px', alignItems: 'center' } }, sel, custom ? codeIn : null, custom ? nameIn : null, custom ? h('label', { class: 'row', style: { gap: '4px' } }, h('input', { type: 'checkbox', style: { width: 'auto' }, checked: rtl, onchange: (e) => { rtl = e.target.checked; } }), t('Écriture de droite à gauche')) : null),
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px', margin: '8px 0', alignItems: 'center' } }, search, h('label', { class: 'row', style: { gap: '4px' } }, h('input', { type: 'checkbox', style: { width: 'auto' }, onchange: (e) => { only = e.target.checked; paint(); } }), t('Non traduits seulement'))), listBox,
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px', marginTop: '10px' } },
        h('button', { class: 'btn primary', onclick: async () => { try { if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(code)) throw new Error(t('Code de langue invalide')); const strings = Object.fromEntries(Object.entries(edits).filter(([, v]) => v && v.trim())); await put('/i18n/pack/' + code, { strings, name, rtl }); toast(t('Traductions enregistrées')); custom = false; await loadLanguages(); await loadPack(code); draw(); } catch (e) { fail(e); } } }, icon('check', { size: 16 }), t('Enregistrer')),
        h('button', { class: 'btn', onclick: () => { const b = new Blob([JSON.stringify(Object.fromEntries(knownKeys().map((k) => [k, edits[k] || ''])), null, 1)], { type: 'application/json' }), a = h('a', { href: URL.createObjectURL(b), download: `traductions-${code || 'nouvelle'}.json` }); a.click(); } }, icon('download', { size: 16 }), t('Exporter (JSON)')),
        h('label', { class: 'btn' }, icon('upload', { size: 16 }), ' ', t('Importer (JSON)'), h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async (e) => { try { const o = JSON.parse(await e.target.files[0].text()); if (!o || typeof o !== 'object') throw new Error('JSON'); for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v.trim()) edits[k] = v; paint(); toast(t('Importé : vérifiez puis enregistrez')); } catch { fail(new Error(t('Fichier JSON invalide'))); } } })),
        !custom && !['en', 'ar', 'es', 'pt', 'de', 'it', 'tr'].includes(code) ? h('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog(t('Supprimer cette langue et ses traductions ?'))) { try { await del('/i18n/pack/' + code); toast(t('Langue supprimée')); location.reload(); } catch (er) { fail(er); } } } }, icon('trash', { size: 16 }), t('Supprimer la langue')) : null));
    paint();
  }
  await load(code); draw(); return box;
}
