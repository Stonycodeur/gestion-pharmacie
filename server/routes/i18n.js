// Langues de l'interface : liste publique, paquets de traductions personnalisés (super-administrateur).
import { router, audit } from '../http.js';
import { get, run } from '../db.js';
import { bad, forbidden, notFound, str } from '../util.js';

const CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const BUILTIN = ['fr', 'en', 'ar', 'es', 'pt', 'de', 'it', 'tr'];
const read = (k, d) => { try { return JSON.parse(get('SELECT svalue FROM platform_settings WHERE skey=?', k)?.svalue || 'null') ?? d; } catch { return d; } };
const write = (k, v) => run("INSERT INTO platform_settings(skey,svalue,updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(skey) DO UPDATE SET svalue=excluded.svalue, updated_at=datetime('now')", k, JSON.stringify(v));
const needSuper = (ctx) => { if (ctx.user.role !== 'super_admin') throw forbidden('Réservé au super-administrateur'); };

router.get('/i18n/languages', { public: true }, () => ({ builtin: BUILTIN, custom: read('i18n.langs', []) }));
router.get('/i18n/pack/:code', { public: true }, (ctx) => { if (!CODE.test(ctx.params.code)) throw notFound('Langue'); return { code: ctx.params.code, strings: read('i18n.pack.' + ctx.params.code, {}) }; });
router.put('/i18n/pack/:code', { needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const code = ctx.params.code; if (!CODE.test(code)) throw bad('VALIDATION', 'Code de langue invalide (ex. ln, sw, wo, ha, es)');
  const src = ctx.body.strings && typeof ctx.body.strings === 'object' ? ctx.body.strings : {}; const entries = Object.entries(src).filter(([k, v]) => typeof k === 'string' && k.length <= 200 && typeof v === 'string' && v.trim());
  if (entries.length > 5000) throw bad('VALIDATION', 'Trop de traductions (5000 maximum)');
  const strings = Object.fromEntries(entries.map(([k, v]) => [k, v.trim().slice(0, 400)]));
  write('i18n.pack.' + code, strings);
  if (!BUILTIN.includes(code)) { const name = str(ctx.body.name, 'nom de la langue', { required: true, max: 40 }); const list = read('i18n.langs', []).filter((l) => l.code !== code); list.push({ code, name, rtl: !!ctx.body.rtl }); write('i18n.langs', list); }
  audit(ctx, 'i18n.pack', 'language', 0, undefined, { code, count: entries.length }); return { ok: true, count: entries.length };
});
router.delete('/i18n/pack/:code', { needsPharmacy: false, ok200: true }, (ctx) => {
  needSuper(ctx); const code = ctx.params.code; if (!CODE.test(code)) throw notFound('Langue'); run('DELETE FROM platform_settings WHERE skey=?', 'i18n.pack.' + code); write('i18n.langs', read('i18n.langs', []).filter((l) => l.code !== code)); audit(ctx, 'i18n.delete', 'language', 0, undefined, { code }); return { ok: true };
});
