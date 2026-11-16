// Centre d'aide (messages, réclamations, contacts entre pharmacies), recherche inter-pharmacies et centre de fichiers (envoyés/reçus).
import { router, audit, notify, publish, can } from '../http.js';
import { get, all, run, insert, tx, nextNumber } from '../db.js';
import { bad, notFound, forbidden, conflict, str, oneOf } from '../util.js';
import { savePrivate, readPrivate } from '../files.js';
import { haversineKm } from './discover.js';
import { isAffiliated } from './drivers.js';

const isSuper = (ctx) => ctx.user.role === 'super_admin';
const isStaff = (ctx) => !['customer', 'guest', 'driver'].includes(ctx.user.role);
const myPh = (ctx) => ctx.ph ?? ctx.user.pharmacy_id;
const phName = (id) => get('SELECT name FROM pharmacies WHERE id=?', id)?.name || '';

// ---- accès à un ticket ----
function loadTicket(ctx, id) {
  const t = get('SELECT * FROM help_tickets WHERE id=?', id); if (!t) throw notFound('Conversation');
  const owner = t.from_user_id === ctx.user.id;
  const staffOf = isStaff(ctx) && can(ctx.user, 'help.view') && [t.pharmacy_id, t.from_pharmacy_id].includes(myPh(ctx));
  if (!(owner || staffOf || isSuper(ctx))) throw notFound('Conversation'); // 404 : ne révèle pas l'existence
  return { t, owner, staff: staffOf || isSuper(ctx) };
}
const view = (t) => ({ ...t, pharmacy_name: phName(t.pharmacy_id), from_pharmacy_name: t.from_pharmacy_id ? phName(t.from_pharmacy_id) : null, from_name: get('SELECT name FROM users WHERE id=?', t.from_user_id)?.name });

router.post('/help/tickets', { anyPerm: ['portal.use', 'driver.use', 'help.reply', 'inter.search'], needsPharmacy: false, bodyLimit: 8e6 }, (ctx) => {
  const b = ctx.body, staff = isStaff(ctx);
  const target = get("SELECT id FROM pharmacies WHERE id=? AND status='active'", Number(b.pharmacy_id)); if (!target) throw bad('VALIDATION', 'Pharmacie destinataire requise');
  if (!staff && ctx.user.role === 'driver') { const d = get("SELECT * FROM drivers WHERE user_id=? AND status='active'", ctx.user.id); if (!d || !isAffiliated(d, target.id)) throw forbidden('Vous ne pouvez écrire qu\'aux pharmacies auxquelles vous êtes rattaché'); }
  const kind = staff ? 'interpharmacy' : oneOf(b.kind || 'message', 'type', ['message', 'claim']);
  if (staff && (!can(ctx.user, 'inter.search') || !myPh(ctx))) throw forbidden();
  if (staff && target.id === myPh(ctx)) throw bad('VALIDATION', 'Choisissez une autre pharmacie');
  const subject = str(b.subject, 'objet', { required: true, max: 160 }), body = str(b.body, 'message', { required: true, max: 4000 });
  const file = b.file ? savePrivate(b.file) : null;
  return tx(() => {
    const number = nextNumber(target.id, 'help', 'AID');
    const id = insert('INSERT INTO help_tickets(number,kind,pharmacy_id,from_pharmacy_id,from_user_id,subject) VALUES (?,?,?,?,?,?)', number, kind, target.id, staff ? myPh(ctx) : null, ctx.user.id, subject);
    const sig = staff ? `${ctx.user.name} — ${phName(myPh(ctx))}` : null;
    const mid = insert('INSERT INTO help_messages(ticket_id,author_user_id,from_staff,reply_as,signature,body) VALUES (?,?,?,?,?,?)', id, ctx.user.id, staff ? 1 : 0, 'user', sig, body);
    if (file) insert('INSERT INTO attachments(pharmacy_id,owner_type,owner_id,sender_user_id,name,mime,size,path) VALUES (?,?,?,?,?,?,?,?)', target.id, 'help_message', mid, ctx.user.id, file.name, file.mime, file.size, file.path);
    notify({ pharmacyId: target.id, audience: 'staff', kind: 'help', title: `${kind === 'claim' ? 'Réclamation' : kind === 'interpharmacy' ? 'Message d\'une pharmacie' : 'Nouveau message'} — ${subject}`, body: body.slice(0, 140), link: `#/help?ticket=${id}` });
    audit({ ...ctx, ph: target.id }, 'help.create', 'help_ticket', id, undefined, { kind, subject }); return { id, number };
  });
});
router.get('/help/tickets', { anyPerm: ['portal.use', 'driver.use', 'help.view'], needsPharmacy: false }, (ctx) => {
  const w = [], p = [];
  if (isStaff(ctx) && !isSuper(ctx)) {
    if (!can(ctx.user, 'help.view')) throw forbidden();
    const box = ctx.query.box === 'out' ? 'out' : 'in';
    if (box === 'in') { w.push('pharmacy_id=?'); p.push(myPh(ctx)); } else { w.push('from_pharmacy_id=?'); p.push(myPh(ctx)); }
  } else if (!isSuper(ctx)) { w.push('from_user_id=?'); p.push(ctx.user.id); }
  if (ctx.query.status) { w.push('status=?'); p.push(ctx.query.status); } if (ctx.query.kind) { w.push('kind=?'); p.push(ctx.query.kind); }
  return all(`SELECT * FROM help_tickets ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY updated_at DESC, id DESC LIMIT 300`, ...p).map(view);
});
router.get('/help/tickets/:id', { anyPerm: ['portal.use', 'driver.use', 'help.view'], needsPharmacy: false }, (ctx) => {
  const { t } = loadTicket(ctx, ctx.params.id);
  const msgs = all('SELECT m.*, u.name author_name FROM help_messages m JOIN users u ON u.id=m.author_user_id WHERE ticket_id=? ORDER BY m.id', t.id).map((m) => ({
    id: m.id, body: m.body, from_staff: !!m.from_staff, reply_as: m.reply_as, signature: m.signature, author_name: m.author_name, created_at: m.created_at,
    attachments: all('SELECT id,name,mime,size,status FROM attachments WHERE owner_type=? AND owner_id=?', 'help_message', m.id),
  }));
  return { ...view(t), messages: msgs };
});
router.post('/help/tickets/:id/messages', { anyPerm: ['portal.use', 'driver.use', 'help.reply'], needsPharmacy: false, bodyLimit: 8e6 }, (ctx) => {
  const { t, owner, staff } = loadTicket(ctx, ctx.params.id); const b = ctx.body;
  if (t.status === 'closed') throw conflict('CLOSED', 'Cette conversation est clôturée');
  const asStaff = isStaff(ctx) && staff && !(owner && !isSuper(ctx) && t.from_pharmacy_id == null);
  if (asStaff && !can(ctx.user, 'help.reply')) throw forbidden('Vous n\'avez pas le droit de répondre');
  const body = str(b.body, 'message', { required: true, max: 4000 }); const file = b.file ? savePrivate(b.file) : null;
  const mine = myPh(ctx); const reply_as = asStaff ? oneOf(b.reply_as || 'user', 'signature', ['user', 'pharmacy']) : 'user';
  // La signature de la pharmacie d'affectation est toujours présente : « Pharmacie » seule, ou « Nom — Pharmacie ».
  const sig = asStaff ? (reply_as === 'pharmacy' ? phName(mine) : `${ctx.user.name} — ${phName(mine)}`) : null;
  return tx(() => {
    const id = insert('INSERT INTO help_messages(ticket_id,author_user_id,from_staff,reply_as,signature,body) VALUES (?,?,?,?,?,?)', t.id, ctx.user.id, asStaff ? 1 : 0, reply_as, sig, body);
    const other = asStaff ? (t.kind === 'interpharmacy' ? (mine === t.pharmacy_id ? t.from_pharmacy_id : t.pharmacy_id) : null) : t.pharmacy_id;
    if (file) insert('INSERT INTO attachments(pharmacy_id,owner_type,owner_id,sender_user_id,recipient_user_id,name,mime,size,path) VALUES (?,?,?,?,?,?,?,?,?)', other ?? mine, 'help_message', id, ctx.user.id, asStaff && t.kind !== 'interpharmacy' ? t.from_user_id : null, file.name, file.mime, file.size, file.path);
    run("UPDATE help_tickets SET status=?, updated_at=datetime('now') WHERE id=?", asStaff ? 'answered' : 'open', t.id);
    if (asStaff && t.kind !== 'interpharmacy') notify({ pharmacyId: t.pharmacy_id, userId: t.from_user_id, kind: 'help', title: `Réponse de ${phName(mine)} — ${t.subject}`, body: body.slice(0, 140), link: `#/help?ticket=${t.id}` });
    else notify({ pharmacyId: other ?? t.pharmacy_id, audience: 'staff', kind: 'help', title: `Nouveau message — ${t.subject}`, body: body.slice(0, 140), link: `#/help?ticket=${t.id}` });
    publish(t.pharmacy_id, 'help', { id: t.id }, null); return { id, signature: sig };
  });
});
router.post('/help/tickets/:id/close', { anyPerm: ['portal.use', 'driver.use', 'help.reply'], needsPharmacy: false, ok200: true }, (ctx) => {
  const { t, owner, staff } = loadTicket(ctx, ctx.params.id); if (!owner && !(staff && can(ctx.user, 'help.reply'))) throw forbidden();
  run("UPDATE help_tickets SET status='closed', updated_at=datetime('now') WHERE id=?", t.id); audit(ctx, 'help.close', 'help_ticket', t.id); return { ok: true };
});

// ---- recherche inter-pharmacies : un produit est-il disponible ailleurs ? ----
router.get('/inter/search', { perm: 'inter.search' }, (ctx) => {
  const q = String(ctx.query.q || '').trim(); if (q.length < 2) throw bad('VALIDATION', 'Saisissez au moins 2 caractères');
  const me = get('SELECT lat,lng FROM pharmacies WHERE id=?', ctx.ph);
  const rows = all(`SELECT pr.id product_id, pr.name, pr.dosage, ph.id pharmacy_id, ph.name pharmacy_name, ph.city, ph.phone, ph.lat, ph.lng
    FROM products pr JOIN pharmacy_catalog pc ON pc.product_id=pr.id JOIN pharmacies ph ON ph.id=pc.pharmacy_id
    WHERE pr.status='active' AND ph.status='active' AND ph.id != ? AND (pr.name LIKE ? OR pr.dci LIKE ?)
    AND COALESCE((SELECT SUM(s.qty_available - s.qty_reserved) FROM stock_levels s JOIN batches b ON b.id=s.batch_id WHERE s.pharmacy_id=ph.id AND b.product_id=pr.id AND b.status='ok' AND b.exp_date >= date('now')),0) > 0
    ORDER BY pr.name LIMIT 300`, ctx.ph, `%${q}%`, `%${q}%`);
  return rows.map((r) => ({ ...r, lat: undefined, lng: undefined, available: true, distance_km: me?.lat != null && r.lat != null ? Math.round(haversineKm(me.lat, me.lng, r.lat, r.lng) * 10) / 10 : null }))
    .sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
});
router.get('/inter/pharmacies', { perm: 'inter.search' }, (ctx) => all("SELECT id,name,city,phone,email FROM pharmacies WHERE status='active' AND id != ? ORDER BY name", ctx.ph));

// ---- centre de fichiers ----
router.get('/files', { anyPerm: ['files.view', 'portal.use'], needsPharmacy: false }, (ctx) => {
  const box = ctx.query.box === 'out' ? 'out' : 'in'; const staff = isStaff(ctx) && !isSuper(ctx);
  if (staff && !can(ctx.user, 'files.view')) throw forbidden();
  let rows;
  const SEL = "SELECT a.id,a.name,a.mime,a.size,a.status,a.note,a.created_at,a.decided_at,a.owner_type,a.owner_id,a.pharmacy_id,a.sender_user_id,a.recipient_user_id,(SELECT name FROM users WHERE id=a.sender_user_id) sender_name FROM attachments a";
  if (staff) rows = box === 'in' ? all(`${SEL} WHERE a.pharmacy_id=? AND a.sender_user_id NOT IN (SELECT id FROM users WHERE pharmacy_id=? AND role_code NOT IN ('customer','guest')) ORDER BY a.id DESC LIMIT 300`, myPh(ctx), myPh(ctx)) : all(`${SEL} WHERE a.sender_user_id IN (SELECT id FROM users WHERE pharmacy_id=? AND role_code NOT IN ('customer','guest')) ORDER BY a.id DESC LIMIT 300`, myPh(ctx));
  else if (isSuper(ctx)) rows = all(`${SEL} ORDER BY a.id DESC LIMIT 300`);
  else rows = box === 'in' ? all(`${SEL} WHERE a.recipient_user_id=? ORDER BY a.id DESC LIMIT 300`, ctx.user.id) : all(`${SEL} WHERE a.sender_user_id=? ORDER BY a.id DESC LIMIT 300`, ctx.user.id);
  const out = rows.map((r) => ({ ...r, pharmacy_name: phName(r.pharmacy_id) }));
  if (staff && box === 'in' && can(ctx.user, 'prescriptions.view')) for (const p of all("SELECT id,number,file_name name,file_mime mime,status,created_at,customer_id FROM prescriptions WHERE pharmacy_id=? AND file_path IS NOT NULL ORDER BY id DESC LIMIT 100", myPh(ctx)))
    out.push({ id: 'rx' + p.id, name: p.name, mime: p.mime, status: p.status, created_at: p.created_at, owner_type: 'prescription', owner_id: p.id, number: p.number, sender_name: get('SELECT name FROM customers WHERE id=?', p.customer_id)?.name });
  return out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
});
function loadFile(ctx, id) {
  const a = get('SELECT * FROM attachments WHERE id=?', id); if (!a) throw notFound('Fichier');
  const staff = isStaff(ctx) && myPh(ctx) && can(ctx.user, 'files.view');
  const sentByMyPh = staff && get("SELECT 1 FROM users WHERE id=? AND pharmacy_id=? AND role_code NOT IN ('customer','guest')", a.sender_user_id, myPh(ctx));
  const isRecipientStaff = staff && a.pharmacy_id === myPh(ctx) && !sentByMyPh;
  const ok = isSuper(ctx) || a.sender_user_id === ctx.user.id || a.recipient_user_id === ctx.user.id || isRecipientStaff || sentByMyPh;
  if (!ok) throw notFound('Fichier'); return { a, recipient: isSuper(ctx) || isRecipientStaff || a.recipient_user_id === ctx.user.id };
}
router.get('/files/:id/content', { anyPerm: ['files.view', 'portal.use'], needsPharmacy: false }, (ctx) => {
  const { a } = loadFile(ctx, ctx.params.id); const buf = readPrivate(a.path); if (!buf) throw notFound('Fichier');
  audit(ctx, 'view.file', 'attachment', a.id);
  ctx.res.writeHead(200, { 'Content-Type': a.mime, 'Content-Disposition': `inline; filename="${a.name.replace(/[^\w.\- ]/g, '_')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:" });
  ctx.res.end(buf);
});
// Le destinataire valide, enregistre ou rejette ; l'expéditeur est notifié.
router.post('/files/:id/decision', { anyPerm: ['files.view', 'portal.use'], needsPharmacy: false, ok200: true }, (ctx) => {
  const { a, recipient } = loadFile(ctx, ctx.params.id); if (!recipient || a.sender_user_id === ctx.user.id) throw forbidden('Seul le destinataire peut décider');
  const d = oneOf(ctx.body.decision, 'décision', ['accepted', 'saved', 'rejected'], { required: true }); const note = str(ctx.body.note, 'note', { max: 300 });
  run("UPDATE attachments SET status=?, decided_by=?, decided_at=datetime('now'), note=? WHERE id=?", d, ctx.user.id, note, a.id);
  notify({ pharmacyId: a.pharmacy_id, userId: a.sender_user_id, kind: 'file', title: `Fichier « ${a.name} » : ${{ accepted: 'validé', saved: 'enregistré', rejected: 'rejeté' }[d]}`, body: note, link: '#/files' });
  audit(ctx, 'file.decision', 'attachment', a.id, { status: a.status }, { status: d }); return { ok: true };
});
