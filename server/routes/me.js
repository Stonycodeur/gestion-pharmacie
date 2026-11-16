// Espace personnel : préférences synchronisées entre appareils (thème, tableau de bord, canaux de notification) et jetons push mobiles.
import { router, audit } from '../http.js';
import { get, run } from '../db.js';
import { bad } from '../util.js';

const ENUM = { mode: ['auto', 'light', 'dark'], density: ['compact', 'comfortable', 'spacious'], radius: ['sharp', 'normal', 'round'], rail: ['auto', 'rail'], contrast: ['normal', 'high'], motion: ['on', 'off'], lang: ['fr', 'en', 'ar'] };
const WIDGETS = ['orders', 'deliveries', 'prescriptions', 'payments', 'catalog', 'history'];
export function cleanPrefs(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('VALIDATION', 'Préférences invalides');
  const o = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === '__proto__' || k === 'constructor') continue;
    if (ENUM[k]) { if (!ENUM[k].includes(v)) throw bad('VALIDATION', `Valeur invalide pour ${k}`); o[k] = v; }
    else if (k === 'accent') { if (v !== null && !/^#[0-9a-fA-F]{6}$/.test(String(v))) throw bad('VALIDATION', 'Couleur invalide'); o.accent = v; }
    else if (k === 'font') { const n = Number(v); if (!(n >= 85 && n <= 130)) throw bad('VALIDATION', 'Taille de texte invalide'); o.font = n; }
    else if (k === 'home_widgets') { if (!Array.isArray(v) || v.length > 12 || v.some((x) => !WIDGETS.includes(x))) throw bad('VALIDATION', 'Blocs invalides'); o.home_widgets = [...new Set(v)]; } // ordre = ordre d'affichage ; absent = masqué
    else if (k === 'reports_ui') { if (!v || typeof v !== 'object') throw bad('VALIDATION', 'Rapports invalides'); const W = ['kpis', 'trend', 'hours', 'weekdays', 'payments', 'top']; o.reports_ui = { widgets: Array.isArray(v.widgets) ? [...new Set(v.widgets.filter((x) => W.includes(x)))] : W, chart: ['line', 'bar', 'area'].includes(v.chart) ? v.chart : 'area', group: ['day', 'month'].includes(v.group) ? v.group : 'day', compare: v.compare !== false, metric: ['net', 'tickets', 'margin'].includes(v.metric) ? v.metric : 'net', range: [7, 30, 90, 365].includes(Number(v.range)) ? Number(v.range) : 30 }; }
    else if (k === 'notify') { if (!v || typeof v !== 'object') throw bad('VALIDATION', 'Canaux invalides'); o.notify = {}; for (const c of ['inapp', 'email', 'sms', 'push']) if (c in v) o.notify[c] = !!v[c]; }
    else if (k === 'nickname') { o.nickname = String(v ?? '').slice(0, 40); }
    else throw bad('VALIDATION', `Préférence inconnue : ${k}`);
  }
  return o;
}
export const prefsOf = (userId) => { try { return JSON.parse(get('SELECT data FROM user_preferences WHERE user_id=?', userId)?.data || '{}'); } catch { return {}; } };
router.get('/me/preferences', { needsPharmacy: false }, (ctx) => prefsOf(ctx.user.id));
router.put('/me/preferences', { needsPharmacy: false, ok200: true, bodyLimit: 8192 }, (ctx) => {
  const next = { ...prefsOf(ctx.user.id), ...cleanPrefs(ctx.body) }; for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
  run('INSERT INTO user_preferences(user_id,data,updated_at) VALUES (?,?,datetime(\'now\')) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at', ctx.user.id, JSON.stringify(next)); return next;
});
router.delete('/me/preferences', { needsPharmacy: false, ok200: true }, (ctx) => { run('DELETE FROM user_preferences WHERE user_id=?', ctx.user.id); return {}; });

// Jetons de notification push (Expo)
router.post('/me/push-token', { needsPharmacy: false, ok200: true }, (ctx) => {
  const t = String(ctx.body.token || ''); if (!/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,60}\]$/.test(t)) throw bad('VALIDATION', 'Jeton push invalide');
  run('DELETE FROM push_tokens WHERE token=?', t); run('INSERT INTO push_tokens(user_id,token,platform) VALUES (?,?,?)', ctx.user.id, t, ['ios', 'android'].includes(ctx.body.platform) ? ctx.body.platform : null); audit(ctx, 'push.register', 'user', ctx.user.id); return { ok: true };
});
router.delete('/me/push-token', { needsPharmacy: false, ok200: true }, (ctx) => { run('DELETE FROM push_tokens WHERE token=? AND user_id=?', String(ctx.body?.token || ctx.query.token || ''), ctx.user.id); return { ok: true }; });
