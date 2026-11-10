// Gabarit d'e-mail HTML (mise en page sobre, compatible clients de messagerie : tableaux + styles en ligne) avec le logo de la pharmacie.
import { get } from './db.js';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
export function pharmacyBrand(pharmacyId) {
  const p = (pharmacyId && get('SELECT name,logo_path,address,city,phone,email FROM pharmacies WHERE id=?', pharmacyId)) || { name: 'Gestion Pharmacie' };
  return { name: p.name, logo: p.logo_path ? `${appUrl()}/api/v1/public/file/${p.logo_path}` : null, address: [p.address, p.city].filter(Boolean).join(', '), phone: p.phone, email: p.email };
}
// blocks : [{ p: 'paragraphe' } | { table: [[label, value], …] } | { button: { label, url } } | { note: 'texte' }]
export function renderMail({ pharmacyId, title, preheader = '', blocks = [] }) {
  const b = pharmacyBrand(pharmacyId); const color = '#0f766e';
  const body = blocks.map((x) => {
    if (x.p) return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937">${x.html ? x.p : esc(x.p).replace(/\n/g, '<br>')}</p>`;
    if (x.table) return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;overflow:hidden">${x.table.map(([k, v], i) => `<tr><td style="padding:10px 14px;background:#f9fafb;font-size:13px;color:#6b7280;width:38%;${i ? 'border-top:1px solid #e5e7eb' : ''}">${esc(k)}</td><td style="padding:10px 14px;font-size:14px;color:#111827;${i ? 'border-top:1px solid #e5e7eb' : ''}">${esc(v)}</td></tr>`).join('')}</table>`;
    if (x.button) return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="background:${color};border-radius:8px"><a href="${esc(x.button.url)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(x.button.label)}</a></td></tr></table>`;
    if (x.note) return `<p style="margin:0 0 16px;padding:12px 14px;background:#fffbeb;border-left:4px solid #f59e0b;font-size:13px;line-height:1.5;color:#92400e">${esc(x.note)}</p>`;
    return '';
  }).join('');
  const logo = b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.name)}" height="48" style="display:block;max-height:48px;max-width:180px;border:0">` : `<div style="width:48px;height:48px;border-radius:12px;background:${color};color:#fff;font-size:22px;font-weight:700;line-height:48px;text-align:center">${esc(b.name.trim().charAt(0).toUpperCase())}</div>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="padding:22px 28px;border-bottom:3px solid ${color}"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:14px">${logo}</td><td style="font-size:18px;font-weight:700;color:#111827">${esc(b.name)}</td></tr></table></td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:#111827">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding:18px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#6b7280">${esc(b.name)}${b.address ? '<br>' + esc(b.address) : ''}${b.phone ? '<br>' + esc(b.phone) : ''}${b.email ? ' · ' + esc(b.email) : ''}<br><span style="color:#9ca3af">Ce message est automatique, merci de ne pas y répondre directement.</span></td></tr>
</table></td></tr></table></body></html>`;
  const text = [title, '', ...blocks.map((x) => x.p ? (x.html ? x.p.replace(/<[^>]+>/g, '') : x.p) : x.table ? x.table.map(([k, v]) => `${k} : ${v}`).join('\n') : x.button ? `${x.button.label} : ${x.button.url}` : x.note || ''), '', b.name].join('\n');
  return { html, text };
}

import { sendMail, mailEnabled } from './mailer.js';
// E-mail de bienvenue (compte créé par un administrateur) : envoyé en arrière-plan, un échec ne bloque jamais la création du compte.
export function sendWelcome({ email, name, role_label, pharmacyId, password }) {
  if (!mailEnabled() || !email || /@(guest|deleted)\.invalid$/.test(email)) return;
  const b = pharmacyBrand(pharmacyId);
  const { html, text } = renderMail({ pharmacyId, title: `Bienvenue ${name}`, preheader: `Votre compte ${b.name} est prêt`, blocks: [
    { p: `Un compte vient d'être créé pour vous sur la plateforme de ${b.name}.` },
    { table: [['Identifiant', email], ...(role_label ? [['Rôle', role_label]] : []), ...(password ? [['Mot de passe provisoire', password]] : [])] },
    { button: { label: 'Se connecter', url: appUrl() } },
    ...(password ? [{ note: 'Pour votre sécurité, vous devrez choisir un nouveau mot de passe dès votre première connexion. Ne partagez jamais ce message.' }] : []),
  ] });
  sendMail({ to: email, subject: `Bienvenue chez ${b.name}`, text, html }).catch((e) => console.error('[welcome]', e.message));
}
