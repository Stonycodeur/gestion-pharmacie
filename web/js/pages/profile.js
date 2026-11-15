// Mon profil : nom, téléphone (indicatif + numéro), photo de profil — modifiables par chaque utilisateur.
import { get, put, post, del, state } from '../api.js';
import { h, clear, fail, toast, icon } from '../ui.js';
import { phoneField, filePicker } from '../net.js';

export default async function (box) {
  const me = await get('/me/profile'); const avatarBox = h('div');
  const paint = (url) => clear(avatarBox).append(url ? h('img', { class: 'avatar-lg', src: url, alt: 'Photo de profil' }) : h('div', { class: 'avatar-lg' }, (me.name || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase())); paint(me.avatar_url);
  const pick = filePicker({ accept: 'image/png,image/jpeg,image/webp', max: 1024 * 1024, label: 'Choisir une photo (PNG, JPEG ou WebP, 1 Mo max)' });
  const name = h('input', { value: me.name, required: true, maxLength: 120 }), phone = phoneField({ value: me.phone || '' });
  const lang = h('select', {}, [['fr', 'Français'], ['en', 'English'], ['ar', 'العربية']].map(([v, l]) => h('option', { value: v, selected: me.lang === v }, l)));
  if (me.is_guest) { box.append(h('h1', {}, 'Mon profil'), h('div', { class: 'alert info' }, 'Vous êtes connecté en invité : créez un compte pour avoir un profil, un historique et des privilèges.')); return; }
  box.append(h('h1', {}, 'Mon profil'), h('div', { class: 'grid g2' },
    h('div', { class: 'card' }, h('h2', {}, 'Photo de profil'), h('div', { class: 'row' }, avatarBox, h('div', {}, pick.el)), h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn primary', onclick: async () => { if (!pick.file) return toast('Choisissez une photo', true); try { const r = await post('/me/avatar', { file: await pick.payload() }); paint(r.avatar_url); state.user.avatar_url = r.avatar_url; toast('Photo enregistrée'); location.reload(); } catch (e) { fail(e); } } }, 'Enregistrer la photo'),
      me.avatar_url ? h('button', { class: 'btn danger', onclick: async () => { try { await del('/me/avatar'); paint(null); toast('Photo retirée'); location.reload(); } catch (e) { fail(e); } } }, 'Retirer') : null)),
    h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); try { await put('/me/profile', { name: name.value, phone: phone.value || null, lang: lang.value }); toast('Profil enregistré'); } catch (er) { fail(er); } } },
      h('h2', {}, 'Mes informations'), h('label', { class: 'f' }, 'Nom complet', name), h('label', { class: 'f' }, 'E-mail (identifiant)', h('input', { value: me.email, disabled: true })), h('label', { class: 'f' }, 'Téléphone', phone), h('label', { class: 'f' }, 'Langue', lang), h('button', { class: 'btn primary' }, 'Enregistrer'))));
}
