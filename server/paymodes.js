// Modes de paiement PROPRES À CHAQUE PHARMACIE : à la caisse, à la livraison, en ligne. Les modes absents sont créés automatiquement
// avec des valeurs par défaut raisonnables (caisse = espèces, TPE, etc.) que la pharmacie peut ensuite régler.
import { get, all, run } from './db.js';

export const defaultsOf = (m) => {
  const manual = m.provider === 'manual';
  return {
    at_counter: m.channel_pos ? 1 : 0,
    on_delivery: m.code === 'cod' || (manual && ['cash', 'card', 'mobile'].includes(m.kind) && m.code !== 'cheque') ? 1 : 0,
    online: m.channel_online ? 1 : 0,
  };
};
// Crée les lignes manquantes (idempotent, très rapide) : appelé à la création d'une pharmacie, d'un mode, et avant toute lecture côté client.
export function ensurePharmacyMethods(pharmacyId) {
  const have = new Set(all('SELECT method_code c FROM pharmacy_payment_methods WHERE pharmacy_id=?', pharmacyId).map((r) => r.c));
  for (const m of all('SELECT * FROM payment_methods')) {
    if (have.has(m.code)) continue; const d = defaultsOf(m);
    run('INSERT INTO pharmacy_payment_methods(pharmacy_id,method_code,enabled,at_counter,on_delivery,online) VALUES (?,?,?,?,?,?)', pharmacyId, m.code, 1, d.at_counter, d.on_delivery, d.online);
  }
}
export const ensureAllPharmacies = () => { for (const p of all('SELECT id FROM pharmacies')) ensurePharmacyMethods(p.id); };
export const currenciesOf = (ph) => String(ph.currencies || ph.currency || '').split(',').filter(Boolean);

// Modes proposés au client pour une pharmacie, regroupés par situation.
export function modesFor(pharmacyId) {
  ensurePharmacyMethods(pharmacyId);
  const ph = get('SELECT p.id,p.currency,p.currencies,c.iso2 FROM pharmacies p LEFT JOIN countries c ON c.id=p.country_id WHERE p.id=?', pharmacyId); const curs = currenciesOf(ph);
  const rows = all('SELECT m.*, x.at_counter x_counter, x.on_delivery x_delivery, x.online x_online FROM payment_methods m JOIN pharmacy_payment_methods x ON x.method_code=m.code AND x.pharmacy_id=? WHERE m.enabled=1 AND x.enabled=1 ORDER BY m.sort_order,m.id', pharmacyId);
  const ok = (m) => (!m.countries || !ph.iso2 || m.countries.split(',').includes(ph.iso2)) && (!m.currencies || m.currencies.split(',').some((c) => curs.includes(c)));
  const view = (m) => ({ code: m.code, label: m.label, kind: m.kind, family: m.family || m.kind, instructions: m.instructions, fields: m.fields ? JSON.parse(m.fields) : [], hosted: m.provider !== 'manual', otp_required: !!m.otp_required, otp_ttl: m.otp_ttl || 120 });
  return {
    counter: rows.filter((m) => m.x_counter).map(view),
    delivery: rows.filter((m) => m.x_delivery).map(view),
    online: rows.filter((m) => m.x_online && m.channel_online && ok(m)).map(view),
  };
}
