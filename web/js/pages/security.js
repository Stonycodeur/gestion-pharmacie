import { get, post, state } from '../api.js';
import { h, formModal, fail, toast, modal, clear } from '../ui.js';
import { t } from '../i18n.js';

export default async function (box) {
  const u = state.user;
  box.append(h('h1', {}, t('Sécurité')), h('p', { class: 'sub' }, u.email));
  const mfa = h('div'); const draw = () => { clear(mfa).append(h('p', {}, 'Double authentification (TOTP) : ', h('strong', {}, u.mfa_enabled ? 'activée' : 'désactivée')),
    u.mfa_enabled ? h('button', { class: 'btn', onclick: () => formModal('Désactiver la MFA', [{ name: 'password', label: 'Mot de passe', type: 'password', required: true }, { name: 'code', label: 'Code actuel', required: true }], async (v) => { await post('/auth/mfa/disable', v); u.mfa_enabled = false; draw(); toast('MFA désactivée'); }) }, 'Désactiver') :
      h('button', { class: 'btn primary', onclick: async () => { const s = await post('/auth/mfa/setup'); formModal('Activer la double authentification', [{ name: 'code', label: 'Code à 6 chiffres', required: true, maxLength: 6 }], async (v) => { const r = await post('/auth/mfa/enable', v); u.mfa_enabled = true; state.token = r.access_token; draw(); toast('MFA activée'); }, { extra: h('div', { class: 'alert info' }, h('p', {}, 'Ajoutez ce secret dans une application d\'authentification (Google Authenticator, Aegis, FreeOTP…) :'), h('code', { style: { wordBreak: 'break-all' } }, s.secret), h('p', {}, h('small', {}, s.otpauth))) }); } }, t('Activer la double authentification'))); };
  draw();
  box.append(h('div', { class: 'card', style: { maxWidth: '520px', marginBottom: '14px' } }, h('h2', {}, t('Changer le mot de passe')), h('button', { class: 'btn', onclick: () => formModal('Changer le mot de passe', [{ name: 'current', label: 'Mot de passe actuel', type: 'password', required: true }, { name: 'password', label: 'Nouveau mot de passe', type: 'password', required: true, hint: '10 caractères min., majuscule, minuscule, chiffre' }], async (v) => { await post('/auth/change-password', v); toast('Mot de passe modifié - reconnectez-vous'); setTimeout(() => location.reload(), 1200); }) }, t('Changer le mot de passe'))), h('div', { class: 'card', style: { maxWidth: '520px' } }, h('h2', {}, 'Double authentification'), mfa));
}
