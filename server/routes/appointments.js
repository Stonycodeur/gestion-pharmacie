// Rendez-vous avec les médecins d'une pharmacie : créneaux publiés par le médecin, activation par le super-administrateur pour la pharmacie.
import { router, audit, notify, publish, can } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { bad, conflict, notFound, forbidden, str, int, oneOf } from '../util.js';
import { savePrivate, readPrivate } from '../files.js';

const enabled = (ph) => !!get('SELECT appointments_enabled e FROM pharmacies WHERE id=?', ph)?.e;
const slotDate = (v) => { const d = new Date(String(v)); if (isNaN(d)) throw bad('VALIDATION', 'Date invalide'); if (d.getTime() < Date.now()) throw bad('VALIDATION', 'Le créneau doit être dans le futur'); return d.toISOString().slice(0, 16).replace('T', ' '); };

// ---- médecin ----
router.get('/doctor/slots', { perm: 'doctor.use', needsPharmacy: false }, (ctx) => all("SELECT s.*, (SELECT status FROM appointments a WHERE a.slot_id=s.id AND a.status IN ('requested','confirmed') LIMIT 1) appointment_status FROM appointment_slots s WHERE doctor_user_id=? AND starts_at >= datetime('now','-1 day') ORDER BY starts_at", ctx.user.id));
router.post('/doctor/slots', { perm: 'doctor.use', needsPharmacy: false }, (ctx) => {
  const ph = ctx.user.pharmacy_id; if (!ph) throw forbidden(); const starts = slotDate(ctx.body.starts_at); const dur = int(ctx.body.duration_min ?? 20, 'durée', { min: 5, max: 240 });
  if (get("SELECT 1 FROM appointment_slots WHERE doctor_user_id=? AND starts_at=? AND status != 'cancelled'", ctx.user.id, starts)) throw conflict('DUPLICATE', 'Vous avez déjà un créneau à cette heure');
  const id = insert('INSERT INTO appointment_slots(pharmacy_id,doctor_user_id,starts_at,duration_min,online_enabled) VALUES (?,?,?,?,?)', ph, ctx.user.id, starts, dur, ctx.body.online_enabled === false ? 0 : 1); return { id };
});
router.put('/doctor/slots/:id', { perm: 'doctor.use', needsPharmacy: false, ok200: true }, (ctx) => {
  const s = get('SELECT * FROM appointment_slots WHERE id=? AND doctor_user_id=?', ctx.params.id, ctx.user.id); if (!s) throw notFound('Créneau');
  run('UPDATE appointment_slots SET online_enabled=? WHERE id=?', ctx.body.online_enabled ? 1 : 0, s.id); return { ok: true };
});
router.delete('/doctor/slots/:id', { perm: 'doctor.use', needsPharmacy: false, ok200: true }, (ctx) => {
  const s = get('SELECT * FROM appointment_slots WHERE id=? AND doctor_user_id=?', ctx.params.id, ctx.user.id); if (!s) throw notFound('Créneau');
  if (s.status === 'booked') throw conflict('BOOKED', 'Un client a réservé ce créneau : refusez ou annulez le rendez-vous d\'abord'); run("UPDATE appointment_slots SET status='cancelled' WHERE id=?", s.id); return { ok: true };
});
router.get('/doctor/appointments', { perm: 'doctor.use', needsPharmacy: false }, (ctx) => all("SELECT a.id,a.status,a.reason,a.file_name,a.file_mime,a.doctor_note,a.created_at,s.starts_at,s.duration_min,u.name customer_name,u.phone customer_phone FROM appointments a JOIN appointment_slots s ON s.id=a.slot_id JOIN users u ON u.id=a.customer_user_id WHERE s.doctor_user_id=? ORDER BY s.starts_at DESC LIMIT 200", ctx.user.id));
router.post('/doctor/appointments/:id/decision', { perm: 'doctor.use', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const a = get('SELECT a.*, s.doctor_user_id, s.starts_at FROM appointments a JOIN appointment_slots s ON s.id=a.slot_id WHERE a.id=? AND s.doctor_user_id=?', ctx.params.id, ctx.user.id); if (!a) throw notFound('Rendez-vous');
  const st = oneOf(ctx.body.status, 'décision', ['confirmed', 'refused', 'done'], { required: true }); const ok = { requested: ['confirmed', 'refused'], confirmed: ['done', 'refused'] }[a.status];
  if (!ok || !ok.includes(st)) throw conflict('BAD_TRANSITION', 'Décision impossible dans cet état'); const note = str(ctx.body.note, 'note', { max: 400 });
  run("UPDATE appointments SET status=?, doctor_note=?, updated_at=datetime('now') WHERE id=?", st, note, a.id); if (st === 'refused') run("UPDATE appointment_slots SET status='open' WHERE id=?", a.slot_id);
  notify({ pharmacyId: a.pharmacy_id, userId: a.customer_user_id, kind: 'appointment', title: `Rendez-vous ${{ confirmed: 'confirmé', refused: 'refusé', done: 'terminé' }[st]} — ${a.starts_at}`, body: note, link: `#/portal?tab=appts&id=${a.id}` }); audit({ ...ctx, ph: a.pharmacy_id }, 'appointment.' + st, 'appointment', a.id); return { ok: true };
}));

// ---- client ----
router.get('/portal/appointments/slots', { anyPerm: ['portal.use', 'portal.guest', 'portal.browse'], needsPharmacy: false }, (ctx) => {
  const ph = int(ctx.query.pharmacy_id, 'pharmacie', { required: true, min: 1 }); if (!enabled(ph)) return { enabled: false, slots: [] };
  return { enabled: true, slots: all("SELECT s.id, s.starts_at, s.duration_min, u.name doctor FROM appointment_slots s JOIN users u ON u.id=s.doctor_user_id WHERE s.pharmacy_id=? AND s.status='open' AND s.online_enabled=1 AND u.status='active' AND s.starts_at > datetime('now') ORDER BY s.starts_at LIMIT 200", ph) };
});
router.post('/portal/appointments', { perm: 'portal.use', needsPharmacy: false }, (ctx) => tx(() => {
  const s = get("SELECT * FROM appointment_slots WHERE id=? AND status='open' AND online_enabled=1", int(ctx.body.slot_id, 'créneau', { required: true })); if (!s || !enabled(s.pharmacy_id) || s.starts_at <= new Date().toISOString().slice(0, 16).replace('T', ' ')) throw conflict('UNAVAILABLE', 'Ce créneau n\'est plus disponible');
  const file = ctx.body.file ? savePrivate(ctx.body.file) : null; // image ou PDF, 5 Mo max, stocké en base
  const id = insert('INSERT INTO appointments(pharmacy_id,slot_id,customer_user_id,reason,file_path,file_name,file_mime) VALUES (?,?,?,?,?,?,?)', s.pharmacy_id, s.id, ctx.user.id, str(ctx.body.reason, 'motif', { max: 400 }), file?.path ?? null, file?.name ?? null, file?.mime ?? null);
  run("UPDATE appointment_slots SET status='booked' WHERE id=?", s.id);
  notify({ pharmacyId: s.pharmacy_id, userId: s.doctor_user_id, kind: 'appointment', title: `Demande de rendez-vous — ${s.starts_at}`, body: [ctx.body.reason, file ? `Pièce jointe : ${file.name}` : null].filter(Boolean).join(' — ') || null, link: '#/doctor' }); audit({ ...ctx, ph: s.pharmacy_id }, 'appointment.request', 'appointment', id); return { id };
}));
router.get('/portal/appointments', { perm: 'portal.use', needsPharmacy: false }, (ctx) => all("SELECT a.id,a.status,a.reason,a.file_name,a.file_mime,a.doctor_note,s.starts_at,s.duration_min,u.name doctor,p.name pharmacy_name FROM appointments a JOIN appointment_slots s ON s.id=a.slot_id JOIN users u ON u.id=s.doctor_user_id JOIN pharmacies p ON p.id=a.pharmacy_id WHERE a.customer_user_id=? ORDER BY s.starts_at DESC LIMIT 100", ctx.user.id));
router.post('/portal/appointments/:id/cancel', { perm: 'portal.use', needsPharmacy: false, ok200: true }, (ctx) => tx(() => {
  const a = get('SELECT a.*, s.doctor_user_id FROM appointments a JOIN appointment_slots s ON s.id=a.slot_id WHERE a.id=? AND a.customer_user_id=?', ctx.params.id, ctx.user.id); if (!a) throw notFound('Rendez-vous');
  if (!['requested', 'confirmed'].includes(a.status)) throw conflict('BAD_STATE', 'Rendez-vous déjà clos'); run("UPDATE appointments SET status='cancelled', updated_at=datetime('now') WHERE id=?", a.id); run("UPDATE appointment_slots SET status='open' WHERE id=?", a.slot_id);
  notify({ pharmacyId: a.pharmacy_id, userId: a.doctor_user_id, kind: 'appointment', title: 'Rendez-vous annulé par le client', link: '#/doctor' }); return { ok: true };
}));
// ---- personnel de la pharmacie : vue d'ensemble ----
router.get('/appointments', { perm: 'help.view' }, (ctx) => all("SELECT a.id,a.status,a.reason,a.file_name,a.file_mime,s.starts_at,d.name doctor,u.name customer_name FROM appointments a JOIN appointment_slots s ON s.id=a.slot_id JOIN users d ON d.id=s.doctor_user_id JOIN users u ON u.id=a.customer_user_id WHERE a.pharmacy_id=? ORDER BY s.starts_at DESC LIMIT 200", ctx.ph));

// Pièce jointe d'un rendez-vous : visible par le client, le médecin du créneau et le personnel habilité de la pharmacie (jamais par un autre client)
router.get('/appointments/:id/file', { anyPerm: ['portal.use', 'doctor.use', 'help.view'], needsPharmacy: false }, (ctx) => {
  const a = get('SELECT a.*, s.doctor_user_id FROM appointments a JOIN appointment_slots s ON s.id=a.slot_id WHERE a.id=?', ctx.params.id); if (!a || !a.file_path) throw notFound('Fichier');
  const ok = a.customer_user_id === ctx.user.id || a.doctor_user_id === ctx.user.id || ctx.user.role_code === 'super_admin' || (can(ctx.user, 'help.view') && ctx.ph && a.pharmacy_id === ctx.ph);
  if (!ok) throw notFound('Fichier'); const buf = readPrivate(a.file_path); if (!buf) throw notFound('Fichier');
  audit({ ...ctx, ph: a.pharmacy_id }, 'view.appointment_file', 'appointment', a.id);
  ctx.res.writeHead(200, { 'Content-Type': a.file_mime, 'Content-Disposition': `inline; filename="${String(a.file_name).replace(/[^\w.\- ]/g, '_')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox" });
  ctx.res.end(buf);
});
