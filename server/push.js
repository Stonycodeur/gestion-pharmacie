// Notifications push mobiles via Expo (jetons enregistrés par l'application mobile). Désactivé tant que PUSH_ENABLED n'est pas "1".
import { all, run } from './db.js';
export const pushEnabled = () => process.env.PUSH_ENABLED === '1';
export async function sendPush(userId, title, body, data = {}) {
  if (!pushEnabled()) return 0; const tokens = all('SELECT token FROM push_tokens WHERE user_id=?', userId).map((r) => r.token); if (!tokens.length) return 0;
  const url = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send'; const headers = { 'content-type': 'application/json', accept: 'application/json' }; if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = 'Bearer ' + process.env.EXPO_ACCESS_TOKEN;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(tokens.map((to) => ({ to, title, body: body || undefined, sound: 'default', data }))), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('Expo push HTTP ' + res.status);
  const j = await res.json().catch(() => ({})); (j.data || []).forEach((t, i) => { if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') run('DELETE FROM push_tokens WHERE token=?', tokens[i]); }); // jeton périmé : on le retire
  return tokens.length;
}
