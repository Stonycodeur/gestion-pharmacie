// Panneau « Personnaliser » + centre de synchronisation hors ligne.
import { soundPrefs, setSoundPrefs, playSound, notifyBeep, SOUNDS, customRing, setCustomRing, clearCustomRing } from './net.js';
import { h, clear, modal, toast, fail, icon, money, confirmDialog } from './ui.js';
import { t } from './i18n.js';
import { getPrefs, setPrefs, resetPrefs, SWATCHES, brandColor, DEFAULTS } from './theme.js';
import { net, onNet, listOutbox, sync, retryConflict, removeOutbox, cacheInfo, wipeAll } from './offline.js';
import { lang, setLang, languages, loadPack } from './i18n.js';

const seg = (opts, cur, onPick) => { const box = h('div', { class: 'seg', role: 'group' }); const draw = (c) => { clear(box); opts.forEach(([v, label, ic]) => box.append(h('button', { type: 'button', 'aria-pressed': String(v) === String(c), onclick: () => { onPick(v); draw(v); } }, ic ? icon(ic, { size: 16 }) : null, label))); }; draw(cur); return box; };
const row = (ic, label, ctl, extra) => h('div', { class: 'setrow' }, h('label', {}, icon(ic, { size: 18 }), label), h('div', {}, ctl, extra));

export function personalize({ onLang } = {}) {
  const p = getPrefs();
  const color = h('input', { type: 'color', value: p.accent || brandColor(), 'aria-label': t('Couleur personnalisée'), oninput: (e) => { setPrefs({ accent: e.target.value }); drawSw(); } });
  const sw = h('div', { class: 'swatches' });
  const drawSw = () => { clear(sw); const cur = (getPrefs().accent || brandColor()).toLowerCase(); sw.append(h('button', { class: 'swatch', type: 'button', style: { background: brandColor() }, title: t('Couleur de l\'établissement'), 'aria-label': t('Couleur de l\'établissement'), 'aria-pressed': String(!getPrefs().accent), onclick: () => { setPrefs({ accent: null }); drawSw(); } }, icon('store', { size: 16 })));
    SWATCHES.forEach((c) => sw.append(h('button', { class: 'swatch', type: 'button', style: { background: c }, 'aria-label': c, 'aria-pressed': String(getPrefs().accent?.toLowerCase() === c), onclick: () => { setPrefs({ accent: c }); color.value = c; drawSw(); } }, getPrefs().accent?.toLowerCase() === c ? icon('check', { size: 16 }) : null))); sw.append(color); };
  drawSw();
  const font = h('input', { type: 'range', min: 85, max: 130, step: 5, value: p.font, 'aria-label': t('Taille du texte'), oninput: (e) => { setPrefs({ font: Number(e.target.value) }); fv.textContent = e.target.value + ' %'; } });
  const fv = h('span', { class: 'muted' }, p.font + ' %');
  const sp = soundPrefs(); const sSel = h('select', { 'aria-label': 'Sonnerie des notifications', onchange: (e) => { setSoundPrefs({ sound: e.target.value }); playSound(e.target.value, soundPrefs().volume); } }, [...Object.entries(SOUNDS).filter(([k]) => k !== 'none').map(([k, v]) => [k, v.label]), ...(customRing() ? [['custom', 'Ma sonnerie : ' + customRing().name]] : []), ['none', SOUNDS.none.label]].map(([k, label]) => h('option', { value: k, selected: sp.sound === k }, label)));
  const vol = h('input', { type: 'range', min: 0, max: 100, value: Math.round(sp.volume * 100), 'aria-label': 'Volume', oninput: (e) => setSoundPrefs({ volume: Number(e.target.value) / 100 }), onchange: () => notifyBeep() });
  // Sonnerie depuis l'appareil : le fichier choisi devient la sonnerie de notification de ce compte (et de cet établissement) sur cet appareil
  const ringInfo = h('small', { class: 'muted' }, customRing() ? 'Sonnerie : ' + customRing().name : 'Aucune sonnerie personnelle');
  const ringPicker = () => { const inp = h('input', { type: 'file', accept: 'audio/*,video/mpeg,video/mp4,video/webm,.mp3,.mpeg,.mpg,.mpga,.wav,.ogg,.oga,.opus,.m4a,.aac,.flac,.amr,.3gp,.weba', hidden: true, onchange: async () => { const f = inp.files[0]; inp.value = ''; if (!f) return; try { const n = await setCustomRing(f); toast('Sonnerie enregistrée : ' + n); playSound('custom', soundPrefs().volume); ringInfo.textContent = 'Sonnerie : ' + n; if (![...sSel.options].some((o) => o.value === 'custom')) sSel.insertBefore(h('option', { value: 'custom' }), sSel.lastChild); [...sSel.options].find((o) => o.value === 'custom').textContent = 'Ma sonnerie : ' + n; sSel.value = 'custom'; } catch (e) { fail(e); } } });
    return h('div', { class: 'row', style: { marginTop: '6px' } }, inp, h('button', { class: 'btn sm', type: 'button', onclick: () => inp.click() }, 'Choisir un son sur mon appareil (7 Mo max.)'), customRing() ? h('button', { class: 'btn sm', type: 'button', onclick: () => { clearCustomRing(); ringInfo.textContent = 'Aucune sonnerie personnelle'; [...sSel.options].find((o) => o.value === 'custom')?.remove(); sSel.value = soundPrefs().sound; toast('Sonnerie personnelle supprimée'); } }, 'Retirer') : null, ringInfo); };
  const body = h('div', {},
    h('div', { class: 'preview' }, h('button', { class: 'btn primary' }, icon('check', { size: 16 }), t('Aperçu')), h('button', { class: 'btn' }, t('Secondaire')), h('span', { class: 'badge b-ok' }, 'OK'), h('span', { class: 'badge b-warn' }, t('Alerte'))),
    row('palette', t('Mode'), seg([['auto', t('Auto'), 'sparkle'], ['light', t('Clair'), 'sun'], ['dark', t('Sombre'), 'moon']], p.mode, (v) => setPrefs({ mode: v }))),
    row('sparkle', t('Couleur d\'accent'), sw),
    row('layout', t('Densité'), seg([['compact', t('Compacte')], ['comfortable', t('Confortable')], ['spacious', t('Aérée')]], p.density, (v) => setPrefs({ density: v }))),
    row('apps', t('Arrondis'), seg([['sharp', t('Droits')], ['normal', t('Normaux')], ['round', t('Très ronds')]], p.radius, (v) => setPrefs({ radius: v }))),
    row('type', t('Taille du texte'), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, font, fv)),
    row('menu', t('Menu latéral'), seg([['auto', t('Adaptatif')], ['rail', t('Icônes seules')]], p.rail, (v) => setPrefs({ rail: v }))),
    row('sun', t('Contraste'), seg([['normal', t('Normal')], ['high', t('Élevé')]], p.contrast, (v) => setPrefs({ contrast: v }))),
    row('refresh', t('Animations'), seg([['on', t('Activées')], ['off', t('Réduites')]], p.motion, (v) => setPrefs({ motion: v }))),
    row('bell', 'Sonnerie des notifications', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, sSel, vol, h('button', { class: 'btn sm', type: 'button', onclick: () => notifyBeep() }, 'Écouter')), ringPicker()),
    row('globe', t('Langue'), h('select', { 'aria-label': t('Langue'), onchange: async (e) => { setLang(e.target.value); await loadPack(e.target.value); m.close(); onLang?.(); } }, languages().map(([v, l]) => h('option', { value: v, selected: v === lang }, l)))));
  const m = modal(t('Personnaliser'), body, { actions: [h('button', { class: 'btn', onclick: () => { resetPrefs(); m.close(); toast(t('Préférences réinitialisées')); } }, icon('rotate', { size: 16 }), t('Réinitialiser')), h('button', { class: 'btn primary', onclick: () => m.close() }, t('Terminé'))] });
}

export async function syncCenter() {
  const list = h('div'), info = h('div', { class: 'muted' });
  const draw = async () => {
    const items = (await listOutbox()).sort((a, b) => a.queued_at.localeCompare(b.queued_at)); clear(list);
    const nCache = await cacheInfo(); clear(info).append(`${nCache} ${t('pages en cache sur cet appareil')}`);
    if (!items.length) list.append(h('div', { class: 'empty' }, icon('check'), t('Rien à synchroniser')));
    items.forEach((it) => list.append(h('div', { class: 'list-item' }, h('div', {}, h('strong', {}, it.label || it.path), h('div', { class: 'muted' }, new Date(it.queued_at).toLocaleString(), it.total != null ? ' · ' + money(it.total) : ''), it.error ? h('div', { class: 'badge b-bad' }, it.error) : null),
      h('div', { class: 'row' }, h('span', { class: 'badge ' + (it.status === 'conflict' ? 'b-bad' : 'b-warn') }, it.status === 'conflict' ? t('Conflit') : t('En attente')),
        it.status === 'conflict' ? h('button', { class: 'btn sm', onclick: async () => { await retryConflict(it.key); draw(); } }, t('Réessayer')) : null,
        it.status === 'conflict' ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(t('Abandonner cette vente hors ligne ? Elle ne sera pas enregistrée.'), { danger: true })) { await removeOutbox(it.key); draw(); } } }, icon('trash', { size: 14 })) : null))));
  };
  const off = onNet(() => draw());
  const m = modal(t('Synchronisation'), h('div', {}, h('div', { class: 'alert info' }, icon('info', { size: 18 }), h('span', {}, t('Les ventes réalisées hors connexion sont enregistrées sur cet appareil puis envoyées automatiquement au retour du réseau, sans doublon possible.'))), list, info),
    { actions: [h('button', { class: 'btn', onclick: async () => { await wipeAll(); draw(); toast(t('Données hors ligne effacées')); } }, icon('trash', { size: 16 }), t('Vider le cache')), h('button', { class: 'btn primary', disabled: !net.online, onclick: async () => { try { const r = await sync(); toast(`${r.sent} ${t('envoyée(s)')}${r.failed ? ` · ${r.failed} ${t('en conflit')}` : ''}`); } catch (e) { fail(e); } draw(); } }, icon('refresh', { size: 16 }), t('Synchroniser maintenant'))] });
  draw(); const close = m.close; return { close: () => { off(); close(); } };
}
