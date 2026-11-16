import { get, post, put, del, state, can, setSession } from '../api.js';
import { h, clear, table, pager, badge, modal, formModal, confirmDialog, fail, toast, when, debounce, icon, tabs } from '../ui.js';
import { t } from '../i18n.js';

const ST = { active: ['Actif', 'ok'], suspended: ['Suspendu', 'warn'], disabled: ['Désactivé', 'bad'], deleted: ['Supprimé', ''], trashed: ['Corbeille', ''] };
const stBadge = (u) => badge(t(ST[u.status]?.[0] || u.status), ST[u.status]?.[1] || '');
const code = (txt) => h('code', { style: { fontSize: '1.1rem', userSelect: 'all', wordBreak: 'break-all' } }, txt);

export default async function (box) {
  const isSuper = state.user.role === 'super_admin';
  const { roles } = await get('/roles'); const phs = isSuper ? await get('/pharmacies') : []; const ctrs = isSuper ? await get('/countries').catch(() => []) : [];
  const roleLabel = (c) => roles.find((x) => x.code === c)?.label || c;
  let kind = 'staff', status = '', role = '', pharmacy = '', sel = new Set(), cur = null;
  const q = h('input', { type: 'search', placeholder: t('Rechercher'), 'aria-label': t('Rechercher') });
  const list = h('div'), bulk = h('div', { class: 'row', style: { marginBottom: '10px' } }), head = h('div');
  const staffRoles = roles.filter((r) => r.code !== 'customer' && (isSuper || r.code !== 'super_admin'));

  const F = (u = {}) => [
    { name: 'name', label: 'Nom', required: true, value: u.name },
    { name: 'email', label: 'E-mail', type: 'email', required: true, value: u.email, ...(u.id && !isSuper ? { disabled: true } : {}) },
    ...(!u.id ? [{ name: 'role_code', label: 'Rôle', type: 'select', required: true, value: u.role_code, options: (isSuper ? roles : staffRoles).map((r) => ({ value: r.code, label: r.label })) }] : []),
    ...(isSuper && u.role_code !== 'super_admin' ? [{ name: 'pharmacy_id', label: 'Établissement', type: 'select', required: true, value: u.pharmacy_id ?? phs[0]?.id, options: phs.map((p) => ({ value: p.id, label: p.name })) }] : []),
    ...(isSuper && u.id && u.role_code === 'customer' ? [{ name: 'country_id', label: 'Pays du client', type: 'select', value: u.country_id || '', options: [{ value: '', label: '—' }, ...ctrs.map((c) => ({ value: c.id, label: c.name_fr }))] },
      { name: 'see_all_countries', label: 'Autoriser à voir les pharmacies de tous les pays', type: 'checkbox', value: !!u.see_all_countries }] : []),
    { name: 'phone', label: 'Téléphone', type: 'phone', value: u.phone }, { name: 'lang', label: 'Langue', type: 'select', required: true, value: u.lang || 'fr', options: ['fr', 'en', 'ar'] }];

  async function load(page = 1) {
    const qs = new URLSearchParams({ page, kind, q: q.value, ...(status ? { status } : {}), ...(role ? { role } : {}), ...(pharmacy ? { pharmacy_id: pharmacy } : {}), ...(status === 'deleted' ? { include_deleted: 1 } : {}) });
    const r = await get('/users?' + qs); sel = new Set([...sel].filter((id) => r.data.some((u) => u.id === id))); drawBulk();
    const chk = (u) => h('input', { type: 'checkbox', 'aria-label': u.name, checked: sel.has(u.id), onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? sel.add(u.id) : sel.delete(u.id); drawBulk(); } });
    clear(list).append(table([{ label: '', render: chk }, { label: 'Nom', render: (u) => h('strong', {}, u.name) }, { label: 'E-mail', key: 'email' }, { label: 'Rôle', render: (u) => roleLabel(u.role_code) }, { label: 'Établissement', key: 'pharmacy_name' },
      { label: 'Statut', render: (u) => h('span', {}, stBadge(u), u.status === 'suspended' && u.suspended_until ? h('small', { class: 'muted' }, ' → ' + when(u.suspended_until)) : '') },
      { label: 'MFA', render: (u) => (u.mfa_enabled ? icon('check', { size: 16 }) : '') }, { label: 'Dernière connexion', render: (u) => when(u.last_login_at) }], r.data, { onRow: openAccount }), pager(r, load));
  }
  function drawBulk() {
    clear(bulk); if (!sel.size) return;
    const act = (label, ic, action, danger) => h('button', { class: 'btn sm' + (danger ? ' danger' : ''), onclick: async () => {
      const reason = action === 'suspend' || action === 'disable' ? await confirmDialog(`${label} ${sel.size} compte(s) ?`, { reason: true }) : await confirmDialog(`${label} ${sel.size} compte(s) ?`, { danger });
      if (!reason) return; try { const r = await post('/users-bulk', { ids: [...sel], action, reason: typeof reason === 'string' ? reason : undefined }); toast(`${r.done} fait(s)` + (r.failed.length ? ` · ${r.failed.length} refusé(s) : ${r.failed[0].error}` : ''), !!r.failed.length); sel.clear(); load(); } catch (e) { fail(e); } } }, icon(ic, { size: 15 }), label);
    bulk.append(h('strong', {}, `${sel.size} ${t('sélectionné(s)')}`), act('Suspendre', 'lock', 'suspend'), act('Réactiver', 'check', 'activate'), act('Désactiver', 'x', 'disable'), act('Fermer les sessions', 'logout', 'revoke_sessions'), act('Supprimer', 'trash', 'delete', true));
  }
  const tempPw = (title, r) => modal(title, h('div', {}, h('p', {}, 'À transmettre à l\'utilisateur (affiché une seule fois, changement obligatoire à la connexion) :'), code(r.temporary_password)));
  const done = (m, close) => { toast(m); close?.(); load(); };


  // Matrice des permissions d'un compte : héritée du rôle, accordée ou refusée individuellement
  // Chauffeur : rattachement à PLUSIEURS pharmacies (il voit et accepte les courses des clients de chacune)
  async function drvModal(u) {
    const d = await get(`/users/${u.id}/driver-pharmacies`), sel = new Set(d.selected), q = h('input', { type: 'search', placeholder: t('Rechercher une pharmacie…'), 'aria-label': t('Rechercher') }), list = h('div', { class: 'drvph' }), cnt = h('strong');
    const draw = () => { const f = q.value.trim().toLowerCase(); clear(list).append(...d.pharmacies.filter((p) => !f || `${p.name} ${p.city || ''}`.toLowerCase().includes(f)).map((p) => { const home = p.id === d.home_pharmacy_id; return h('label', { class: 'list-item', style: { cursor: 'pointer' } }, h('span', { class: 'row' }, h('input', { type: 'checkbox', style: { width: 'auto' }, checked: sel.has(p.id) || home, disabled: home, onchange: (e) => { e.target.checked ? sel.add(p.id) : sel.delete(p.id); cnt.textContent = String(sel.size); } }), h('span', {}, h('strong', {}, p.name), p.city ? h('small', { class: 'muted' }, ' — ' + p.city) : null)), home ? badge('Principale', 'ok') : null); })); cnt.textContent = String(new Set([...sel, d.home_pharmacy_id]).size); };
    q.oninput = draw; draw();
    modal(`Pharmacies de ${d.name}`, h('div', {}, h('p', { class: 'muted' }, 'Cochez toutes les pharmacies dont ce chauffeur doit recevoir et pouvoir accepter les courses (livraisons uniquement). La pharmacie principale reste toujours rattachée ; chaque pharmacie ajoutée en est informée.'), q, list,
      h('div', { class: 'row between', style: { marginTop: '12px' } }, h('span', {}, t('Pharmacies sélectionnées'), ' : ', cnt), h('button', { class: 'btn primary', onclick: async () => { try { await put(`/users/${u.id}/driver-pharmacies`, { pharmacy_ids: [...new Set([...sel, d.home_pharmacy_id])] }); toast('Rattachements enregistrés'); } catch (e) { fail(e); } } }, t('Enregistrer')))), { wide: true });
  }
  async function permsModal(u) {
    const d = await get(`/users/${u.id}/permissions`); const ov = { ...d.overrides }; const base = new Set(d.role_permissions); const groups = {};
    d.catalog.forEach((p) => (groups[p.code.split('.')[0]] ||= []).push(p));
    const body = h('div', {}, h('div', { class: 'alert info' }, icon('info', { size: 18 }), h('span', {}, `Rôle « ${roleLabel(d.role)} » : les droits du rôle s'appliquent ; ci-dessous, accordez ou refusez des droits pour CETTE personne uniquement (« refusé » l'emporte).`)),
      Object.entries(groups).map(([g, ps]) => h('div', {}, h('h3', { style: { textTransform: 'capitalize', marginTop: '12px' } }, g), ps.map((p) => {
        const sel = h('select', { 'aria-label': p.label, onchange: (e) => { if (e.target.value) ov[p.code] = e.target.value; else delete ov[p.code]; } },
          h('option', { value: '' }, `${t('Hérité du rôle')} (${base.has(p.code) ? t('oui') : t('non')})`), h('option', { value: 'grant', selected: ov[p.code] === 'grant' }, t('Accordé')), h('option', { value: 'deny', selected: ov[p.code] === 'deny' }, t('Refusé')));
        return h('div', { class: 'setrow' }, h('label', {}, h('span', {}, p.label, h('div', { class: 'muted', style: { fontSize: '.72rem', fontWeight: 400 } }, p.code))), sel); }))));
    modal(`Permissions — ${u.name}`, body, { wide: true, actions: [h('button', { class: 'btn primary', onclick: async () => { try { const all_ = {}; d.catalog.forEach((p) => { all_[p.code] = ov[p.code] || null; }); await put(`/users/${u.id}/permissions`, { overrides: all_ }); toast('Permissions enregistrées (journalisé)'); document.querySelectorAll('.overlay')[document.querySelectorAll('.overlay').length - 1]?.remove(); } catch (e) { fail(e); } } }, icon('check', { size: 16 }), t('Enregistrer'))] });
  }

  async function openAccount(row) {
    const u = await get('/users/' + row.id); cur = u; let m;
    const act = (ic, label, fn, danger) => h('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'button', onclick: async () => { try { await fn(); } catch (e) { fail(e); } } }, icon(ic, { size: 16 }), label);
    const kv = (k, v) => h('div', { class: 'list-item' }, h('span', { class: 'muted' }, k), h('span', {}, v ?? '—'));
    const active = u.status === 'active', gone = u.status === 'deleted';
    const info = h('div', {}, kv('E-mail', u.email), kv('Rôle', roleLabel(u.role_code)), kv('Téléphone', u.phone), u.is_primary ? kv('Fonction', badge('Super-administrateur principal', 'ok')) : null, kv('Statut', h('span', {}, stBadge(u), u.status_reason ? ` — ${u.status_reason}` : '', u.suspended_until ? ` (${t('jusqu\'au')} ${when(u.suspended_until)})` : '')),
      kv('Double authentification', u.mfa_enabled ? t('Activée') : t('Non')), kv('Sessions ouvertes', String(u.sessions_open)), kv('Dernière connexion', when(u.last_login_at)), kv('Créé le', when(u.created_at)),
      u.locked_until && u.locked_until > new Date().toISOString().slice(0, 19).replace('T', ' ') ? kv('Verrouillé jusqu\'à', when(u.locked_until)) : null, u.customer ? kv('Points de fidélité', String(u.customer.loyalty_points)) : null);
    const acts = gone ? h('div', { class: 'alert info' }, icon('info', { size: 18 }), 'Compte supprimé : conservé sous forme anonyme pour la traçabilité (ventes, stock, audit).') : h('div', { class: 'row' },
      act('edit', 'Modifier', () => formModal('Modifier le compte', F(u), async (v) => { delete v.role_code; await put('/users/' + u.id, v); done('Compte enregistré', m.close); })),
      active ? act('lock', 'Suspendre…', () => formModal('Suspendre le compte', [{ name: 'status_reason', label: 'Motif', type: 'textarea' }, { name: 'until', label: 'Jusqu\'au (facultatif — sinon jusqu\'à réactivation)', type: 'datetime-local' }], async (v) => { await put('/users/' + u.id, { status: 'suspended', status_reason: v.status_reason, suspended_until: v.until ? new Date(v.until).toISOString() : undefined }); done('Compte suspendu : sessions fermées', m.close); }, { submitLabel: 'Suspendre' })) : act('check', 'Réactiver', async () => { await put('/users/' + u.id, { status: 'active' }); done('Compte réactivé', m.close); }),
      u.status !== 'disabled' ? act('x', 'Désactiver…', async () => { const r = await confirmDialog('Désactiver ce compte (connexion impossible, données conservées) ?', { reason: true }); if (r) { await put('/users/' + u.id, { status: 'disabled', status_reason: r }); done('Compte désactivé', m.close); } }) : null,
      act('lock', 'Déverrouiller', async () => { await post(`/users/${u.id}/unlock`); toast('Compte déverrouillé'); }),
      act('refresh', 'Mot de passe temporaire', async () => { if (await confirmDialog('Générer un mot de passe temporaire ? Les sessions seront fermées.')) tempPw('Mot de passe temporaire', await post(`/users/${u.id}/reset-password`)); }),
      act('edit', 'Définir un mot de passe…', () => formModal('Définir le mot de passe', [{ name: 'password', label: 'Nouveau mot de passe', type: 'password', required: true, hint: '10 caractères min., majuscule, minuscule, chiffre' }, { name: 'must_change', label: 'Imposer le changement à la prochaine connexion', type: 'checkbox', value: true }], async (v) => { await post(`/users/${u.id}/set-password`, v); toast('Mot de passe défini'); })),
      act('shield', 'Forcer le changement', async () => { await post(`/users/${u.id}/force-password-change`); toast('Changement exigé à la prochaine connexion'); }),
      u.mfa_enabled ? act('shield', 'Réinitialiser la MFA', async () => { if (await confirmDialog('Supprimer la double authentification de ce compte ? L\'utilisateur devra la reconfigurer.', { danger: true })) { await post(`/users/${u.id}/reset-mfa`); done('MFA réinitialisée', m.close); } }, true) : null,
      act('logout', 'Fermer les sessions', async () => { await post(`/users/${u.id}/revoke-sessions`); done('Sessions fermées', m.close); }),
      act('history', 'Connexions', async () => { const l = await get(`/users/${u.id}/logins`); modal('Connexions', h('div', {}, table([{ label: 'Date', render: (x) => when(x.created_at) }, { label: 'IP', key: 'ip' }, { label: 'Résultat', render: (x) => badge(x.success ? 'succès' : 'échec', x.success ? 'ok' : 'bad') }], l.attempts), h('h3', {}, 'Sessions'), table([{ label: 'Appareil', key: 'device' }, { label: 'IP', key: 'ip' }, { label: 'Ouverte', render: (x) => when(x.created_at) }, { label: 'Statut', render: (x) => (x.revoked ? 'fermée' : 'active') }], l.sessions)), { wide: true }); }),
      u.role_code === 'driver' && active && (can('users.manage') || can('drivers.admin')) ? act('pin', 'Pharmacies rattachées…', () => drvModal(u)) : null,
      isSuper && u.role_code !== 'super_admin' ? act('shield', 'Permissions individuelles…', () => permsModal(u)) : null,
      isSuper && u.role_code !== 'super_admin' && u.status === 'active' ? act('user', 'Prendre le contrôle', async () => { if (await confirmDialog(`Ouvrir une session en tant que ${u.name} ? Toutes vos actions seront journalisées à votre nom. Durée : 30 min.`)) { const d = await post(`/users/${u.id}/impersonate`); m.close(); setSession(d); window.dispatchEvent(new CustomEvent('gp:impersonate', { detail: d })); } }) : null,
      u.role_code === 'super_admin' && state.user.is_primary && u.id !== state.user.id && u.status === 'active' ? act('shield', u.is_primary ? 'Retirer le statut principal' : 'Nommer super-administrateur principal', async () => { if (await confirmDialog(u.is_primary ? 'Retirer le statut de super-administrateur principal à ce compte ?' : 'Ce compte deviendra super-administrateur principal : il ne pourra plus être supprimé que par un principal.')) { await post(`/users/${u.id}/primary`, { value: !u.is_primary }); done('Statut mis à jour', m.close); } }) : null,
      u.id !== state.user.id && can('users.delete') && !(u.is_primary && !state.user.is_primary) ? act('trash', 'Mettre à la corbeille…', async () => { const ok = await confirmDialog('Mettre ce compte à la corbeille ? Il ne pourra plus se connecter ; vous pourrez le restaurer ou le supprimer définitivement depuis la Corbeille (vidée automatiquement après 90 jours).', { danger: true, label: 'Mettre à la corbeille' }); if (ok) { await del('/users/' + u.id); done('Compte placé dans la corbeille', m.close); } }, true) : null);
    m = modal(u.name, h('div', {}, info, h('h3', { style: { marginTop: '14px' } }, t('Actions')), acts), { wide: true });
  }

  const draw = () => { clear(head).append(tabs([['staff', 'Personnel'], ['customer', 'Clients (comptes en ligne)']], kind, (k) => { kind = k; role = ''; sel.clear(); draw(); load(); })); };
  const sc = (opts, cur_, on, label) => h('select', { 'aria-label': label, onchange: (e) => { on(e.target.value); load(); } }, h('option', { value: '' }, label), opts.map(([v, l]) => h('option', { value: v, selected: v === cur_ }, l)));
  q.oninput = debounce(() => load());
  const filters = h('div', { class: 'row', style: { marginBottom: '12px' } }, h('label', { class: 'search', style: { flex: '1 1 220px' } }, icon('search', { size: 18 }), q),
    sc(Object.entries(ST).map(([v, [l]]) => [v, t(l)]), status, (v) => (status = v), t('Tous les statuts')), sc(staffRoles.map((r) => [r.code, r.label]), role, (v) => (role = v), t('Tous les rôles')),
    isSuper ? sc(phs.map((p) => [p.id, p.name]), pharmacy, (v) => (pharmacy = v), t('Tous les établissements')) : null);
  box.append(h('div', { class: 'row between' }, h('h1', {}, t('Utilisateurs')),
    h('button', { class: 'btn primary', onclick: () => formModal('Nouveau compte', F(kind === 'customer' ? { role_code: 'customer' } : {}), async (v) => { const r = await post('/users', kind === 'customer' ? { ...v, role_code: 'customer' } : v); done('Compte créé'); if (r.temporary_password) tempPw('Compte créé', r); }, { submitLabel: 'Créer' }) }, icon('plus', { size: 16 }), t('Nouveau'))),
    head, filters, bulk, list);
  draw(); await load();
}
