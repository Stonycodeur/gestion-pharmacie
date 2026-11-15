import { AFF } from './drivers.js';
import { portalCustomer, isGuest, OWN, ORDER_ACTIVE } from '../portal.js';
import { router, audit, paged, can, need, notify, publish } from '../http.js';
import { get, all, run, insert, tx, nextNumber, getSetting } from '../db.js';
import { HttpError, bad, conflict, notFound, forbidden, str, int, date, oneOf, bool, arr, nowSql, addDays, addHours, todaySql } from '../util.js';
import { allocate, applyMovement, reserve } from '../stock.js';
import { createSale, recomputePrescriptionStatus } from '../sales.js';
import { storeBlob, readBlob, dropBlob } from '../files.js';
import { avEnabled, scanBuffer } from '../antivirus.js';
import { scanUpload } from '../scanner.js';

// ================= CLIENTS =================
const custInput = (b) => ({
  name: str(b.name, 'nom', { required: true, max: 160 }), phone: str(b.phone, 'téléphone', { max: 40 }), email: str(b.email, 'e-mail', { max: 160 }),
  address: str(b.address, 'adresse', { max: 300 }), birth_date: date(b.birth_date, 'date de naissance'), marketing_consent: bool(b.marketing_consent),
});
router.get('/customers', { perm: 'customers.view' }, (ctx) => {
  const q = `%${ctx.query.q || ''}%`;
  return paged(ctx, "SELECT COUNT(*) n FROM customers WHERE pharmacy_id=? AND status='active' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)", "SELECT id,name,phone,email,loyalty_points,marketing_consent,created_at FROM customers WHERE pharmacy_id=? AND status='active' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?) ORDER BY name", [ctx.ph, q, q, q]);
});
router.post('/customers', { perm: 'customers.manage' }, (ctx) => {
  const o = custInput(ctx.body); if (o.marketing_consent) o.consent_at = nowSql();
  const id = insert(`INSERT INTO customers(pharmacy_id,${Object.keys(o).join(',')}) VALUES (?,${Object.keys(o).map(() => '?').join(',')})`, ctx.ph, ...Object.values(o));
  audit(ctx, 'customer.create', 'customer', id); return get('SELECT * FROM customers WHERE id=?', id);
});
router.get('/customers/:id', { perm: 'customers.view' }, (ctx) => {
  const c = get("SELECT * FROM customers WHERE id=? AND pharmacy_id=?", ctx.params.id, ctx.ph); if (!c) throw notFound('Client');
  audit(ctx, 'view.customer', 'customer', c.id); return c;
});
router.put('/customers/:id', { perm: 'customers.manage' }, (ctx) => {
  const old = get('SELECT * FROM customers WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!old) throw notFound('Client');
  const o = custInput({ ...old, ...ctx.body }); o.consent_at = o.marketing_consent !== old.marketing_consent ? nowSql() : old.consent_at;
  run(`UPDATE customers SET ${Object.keys(o).map((k) => k + '=?').join(',')} WHERE id=?`, ...Object.values(o), old.id);
  audit(ctx, 'customer.update', 'customer', old.id, { marketing_consent: old.marketing_consent }, { marketing_consent: o.marketing_consent }); return get('SELECT * FROM customers WHERE id=?', old.id);
});
// Historique d'achats : donnée sensible → permission dédiée + journalisation de la consultation
router.get('/customers/:id/history', { perm: 'customers.history' }, (ctx) => {
  const c = get('SELECT id,name FROM customers WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!c) throw notFound('Client');
  audit(ctx, 'view.customer_history', 'customer', c.id);
  return { customer: c, sales: all('SELECT id,number,total,status,created_at FROM sales WHERE customer_id=? ORDER BY id DESC LIMIT 100', c.id), loyalty: all('SELECT points,kind,created_at FROM loyalty_transactions WHERE customer_id=? ORDER BY id DESC LIMIT 50', c.id) };
});
// Droit à l'effacement : anonymisation (les écritures comptables et pharmaceutiques sont conservées sans identité)
router.post('/customers/:id/anonymize', { perm: 'customers.manage', ok200: true }, (ctx) => {
  if (!can(ctx.user, 'settings.manage') && !can(ctx.user, 'prescriptions.review')) throw forbidden('Réservé à un responsable');
  const c = get('SELECT * FROM customers WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!c) throw notFound('Client');
  tx(() => {
    run("UPDATE customers SET name=?, phone=NULL, email=NULL, address=NULL, birth_date=NULL, marketing_consent=0, status='anonymized' WHERE id=?", `Client anonymisé #${c.id}`, c.id);
    run("UPDATE prescriptions SET patient_name=? WHERE customer_id=?", `Patient anonymisé #${c.id}`, c.id);
    if (c.user_id) run("UPDATE users SET email=?, name=?, phone=NULL, status='disabled' WHERE id=?", `anonymized-${c.user_id}@invalid.local`, `Anonymisé #${c.user_id}`, c.user_id);
    audit(ctx, 'customer.anonymize', 'customer', c.id);
  }); return { ok: true };
});

// ================= ORDONNANCES =================
const MAX_FILE = 3 * 1024 * 1024;
function saveFile(f) {
  if (!f) return {};
  const mime = oneOf(f.mime, 'type de fichier', ['image/jpeg', 'image/png', 'application/pdf'], { required: true });
  const buf = Buffer.from(String(f.data_base64 || ''), 'base64');
  if (!buf.length || buf.length > MAX_FILE) throw bad('FILE_SIZE', `Fichier vide ou > ${MAX_FILE / 1048576} Mo`);
  const magic = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'application/pdf': [0x25, 0x50, 0x44, 0x46] }[mime];
  if (!magic.every((b, i) => buf[i] === b)) throw bad('FILE_TYPE', 'Le contenu du fichier ne correspond pas à son type');
  const av = scanUpload(buf, mime, f.name); if (av.infected) throw bad('MALWARE', `Fichier refusé par l'antivirus : ${av.reason}`); // antivirus intégré, avant tout stockage
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }[mime], name = storeBlob(buf, mime, ext, false);
  if (avEnabled()) setImmediate(async () => {
    try { const r = await scanBuffer(buf); if (!r.infected) return; dropBlob(name); run("UPDATE prescriptions SET file_path=NULL, file_name='FICHIER REFUSÉ (antivirus)' WHERE file_path=?", name); audit({ ph: null, ip: null }, 'upload.infected', 'file', name, undefined, { signature: r.signature }); console.error('[antivirus] fichier infecté supprimé :', r.signature); }
    catch (e) { console.error('[antivirus]', e.message); if (process.env.CLAMD_REQUIRED === 'true') { try { dropBlob(name); run("UPDATE prescriptions SET file_path=NULL, file_name='FICHIER NON VÉRIFIÉ (antivirus indisponible)' WHERE file_path=?", name); } catch {} } }
  });
  return { file_path: name, file_mime: mime, file_name: str(f.name, 'nom du fichier', { max: 120 }) || 'ordonnance.' + ext };
}
const presLines = (b) => arr(b.lines, 'lignes', { max: 60 }).map((l) => ({ product_id: int(l.product_id, 'produit', { required: true, min: 1 }), qty_prescribed: int(l.qty_prescribed ?? l.qty, 'quantité', { required: true, min: 1, max: 1000 }), posology: str(l.posology, 'posologie', { max: 200 }) }));
export function createPrescription(ctx, b, customerId) {
  const patient = str(b.patient_name, 'patient', { required: true, max: 160 });
  const f = saveFile(b.file); const lines = presLines(b);
  if (!f.file_path && !lines.length) throw bad('VALIDATION', 'Joindre un fichier ou saisir des lignes');
  return tx(() => {
    const number = nextNumber(ctx.ph, 'rx', 'ORD');
    const pdate = date(b.prescription_date, 'date de prescription');
    const validity = getSetting(ctx.ph, 'prescription_validity_days', 90);
    const id = insert('INSERT INTO prescriptions(pharmacy_id,number,customer_id,patient_name,prescriber_name,prescription_date,valid_until,renewals_allowed,file_name,file_path,file_mime,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ctx.ph, number, customerId ?? (b.customer_id ? int(b.customer_id, 'client') : null), patient, str(b.prescriber_name, 'prescripteur', { max: 160 }), pdate, pdate ? addDays(pdate, validity).slice(0, 10) : null, int(b.renewals_allowed ?? 0, 'renouvellements', { min: 0, max: 24 }), f.file_name ?? null, f.file_path ?? null, f.file_mime ?? null, str(b.notes, 'notes', { max: 500 }), ctx.user.id);
    for (const l of lines) { if (!get('SELECT 1 FROM products WHERE id=?', l.product_id)) throw bad('VALIDATION', 'Produit inconnu'); insert('INSERT INTO prescription_lines(prescription_id,product_id,qty_prescribed,posology) VALUES (?,?,?,?)', id, l.product_id, l.qty_prescribed, l.posology); }
    insert('INSERT INTO prescription_reviews(prescription_id,from_status,to_status,reason,user_id) VALUES (?,?,?,?,?)', id, null, 'received', 'Ordonnance reçue', ctx.user.id);
    audit(ctx, 'prescription.create', 'prescription', id, undefined, { number, patient });
    notify({ pharmacyId: ctx.ph, audience: 'pharmacist', kind: 'prescription', title: `Nouvelle ordonnance à vérifier : ${number}`, body: patient, link: `#/prescriptions?id=${id}` });
    return { id, number };
  });
}
router.get('/prescriptions', { perm: 'prescriptions.view' }, (ctx) => {
  const w = ['p.pharmacy_id=?'], a = [ctx.ph]; if (ctx.query.status) { w.push('p.status=?'); a.push(ctx.query.status); }
  if (ctx.query.q) { w.push('(p.number LIKE ? OR p.patient_name LIKE ?)'); a.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`); }
  return paged(ctx, `SELECT COUNT(*) n FROM prescriptions p WHERE ${w.join(' AND ')}`, `SELECT p.id,p.number,p.patient_name,p.prescriber_name,p.prescription_date,p.valid_until,p.status,p.created_at, (p.file_path IS NOT NULL) has_file FROM prescriptions p WHERE ${w.join(' AND ')} ORDER BY p.id DESC`, a);
});
router.post('/prescriptions', { perm: 'prescriptions.create', bodyLimit: 6e6 }, (ctx) => createPrescription(ctx, ctx.body, null));
router.get('/prescriptions/:id', { perm: 'prescriptions.view' }, (ctx) => {
  const p = get('SELECT p.*, u.name validated_by_name FROM prescriptions p LEFT JOIN users u ON u.id=p.validated_by WHERE p.id=? AND p.pharmacy_id=?', ctx.params.id, ctx.ph); if (!p) throw notFound('Ordonnance');
  p.lines = all('SELECT l.*, pr.name product_name, pr.rx_status FROM prescription_lines l JOIN products pr ON pr.id=l.product_id WHERE l.prescription_id=?', p.id);
  p.history = all('SELECT r.*, u.name user_name FROM prescription_reviews r LEFT JOIN users u ON u.id=r.user_id WHERE r.prescription_id=? ORDER BY r.id', p.id);
  p.dispensings = all('SELECT d.qty, d.created_at, pr.name product_name, b.batch_no, s.number sale_number, u.name pharmacist_name FROM dispensing_records d JOIN products pr ON pr.id=d.product_id JOIN batches b ON b.id=d.batch_id JOIN sales s ON s.id=d.sale_id JOIN users u ON u.id=d.pharmacist_id WHERE d.prescription_id=?', p.id);
  delete p.file_path; audit(ctx, 'view.prescription', 'prescription', p.id); return p;
});
router.put('/prescriptions/:id/lines', { perm: 'prescriptions.create', ok200: true }, (ctx) => {
  const p = get('SELECT * FROM prescriptions WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!p) throw notFound('Ordonnance');
  if (!['received', 'to_verify', 'complement_requested'].includes(p.status)) throw conflict('BAD_STATE', 'Ordonnance déjà traitée : lignes non modifiables');
  const lines = presLines(ctx.body); if (!lines.length) throw bad('VALIDATION', 'Au moins une ligne');
  tx(() => { run('DELETE FROM prescription_lines WHERE prescription_id=?', p.id); for (const l of lines) insert('INSERT INTO prescription_lines(prescription_id,product_id,qty_prescribed,posology) VALUES (?,?,?,?)', p.id, l.product_id, l.qty_prescribed, l.posology); audit(ctx, 'prescription.lines', 'prescription', p.id, undefined, { lines: lines.length }); });
  return { ok: true };
});
// Pièce jointe : accès authentifié uniquement, jamais d'URL publique ; chaque consultation est tracée.
router.get('/prescriptions/:id/file', { perm: 'prescriptions.view' }, (ctx) => {
  const p = get('SELECT * FROM prescriptions WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!p?.file_path) throw notFound('Fichier');
  const fileBuf = readBlob(p.file_path, false); if (!fileBuf) throw notFound('Fichier');
  audit(ctx, 'view.prescription_file', 'prescription', p.id);
  ctx.res.writeHead(200, { 'Content-Type': p.file_mime, 'Content-Disposition': `inline; filename="${p.number}.${p.file_mime.split('/')[1].replace('jpeg', 'jpg')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  ctx.res.end(fileBuf);
});
const FLOW = { received: ['to_verify', 'rejected'], to_verify: ['complement_requested', 'validated', 'rejected'], complement_requested: ['to_verify', 'rejected'] };
// Workflow de vérification : réservé au pharmacien (prescriptions.review). Aucune validation automatique/OCR.
router.post('/prescriptions/:id/transition', { perm: 'prescriptions.create', ok200: true }, (ctx) => {
  const to = oneOf(ctx.body.to, 'statut', ['to_verify', 'complement_requested', 'validated', 'rejected'], { required: true });
  const reason = str(ctx.body.reason, 'motif', { max: 300 });
  const p = get('SELECT * FROM prescriptions WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!p) throw notFound('Ordonnance');
  if (!(FLOW[p.status] || []).includes(to)) throw conflict('BAD_TRANSITION', `Transition ${p.status} → ${to} impossible`);
  if (to !== 'to_verify') need(ctx, 'prescriptions.review');
  if (['complement_requested', 'rejected'].includes(to) && !reason) throw bad('VALIDATION', 'Un motif est obligatoire');
  if (to === 'validated') {
    const c = ctx.body.checklist || {};
    for (const k of ['identity', 'legible', 'date_valid', 'prescriber', 'products_posology']) if (c[k] !== true) throw conflict('CHECKLIST_INCOMPLETE', 'Tous les points de contrôle doivent être confirmés par le pharmacien', { missing: k });
    if (!get('SELECT 1 FROM prescription_lines WHERE prescription_id=?', p.id)) throw conflict('NO_LINES', 'Saisir les lignes de produits avant validation');
    if (p.valid_until && p.valid_until < todaySql()) throw conflict('PRESCRIPTION_EXPIRED', 'Ordonnance périmée');
  }
  tx(() => {
    run("UPDATE prescriptions SET status=?, status_reason=?, validated_by=?, updated_at=datetime('now') WHERE id=?", to, reason, to === 'validated' ? ctx.user.id : p.validated_by, p.id);
    insert('INSERT INTO prescription_reviews(prescription_id,from_status,to_status,reason,user_id) VALUES (?,?,?,?,?)', p.id, p.status, to, to === 'validated' ? 'Contrôle pharmacien : identité, lisibilité, date, prescripteur, produits/posologie' : reason, ctx.user.id);
    audit(ctx, 'prescription.' + to, 'prescription', p.id, { status: p.status }, { status: to, reason });
    if (p.customer_id) { const cu = get('SELECT user_id FROM customers WHERE id=?', p.customer_id); if (cu?.user_id) notify({ pharmacyId: ctx.ph, userId: cu.user_id, kind: 'prescription_status', title: `Ordonnance ${p.number} : ${to}`, body: reason, link: `#/portal?tab=rx&id=${p.id}` }); }
  });
  return { ok: true, status: to };
});

// ================= COMMANDES & RÉSERVATIONS =================
export function createOrder(ctx, { customerId, kind, lines, notes, address }) {
  if (!lines.length) throw bad('VALIDATION', 'Aucune ligne');
  return tx(() => {
    const number = nextNumber(ctx.ph, 'order', 'CMD'), hours = getSetting(ctx.ph, 'reservation_hours', 24);
    const id = insert('INSERT INTO customer_orders(pharmacy_id,number,customer_id,kind,expires_at,delivery_address,notes,created_by) VALUES (?,?,?,?,?,?,?,?)', ctx.ph, number, customerId, kind, addHours(hours), address ?? null, notes ?? null, ctx.user.id);
    insert('INSERT INTO order_status_history(order_id,from_status,to_status,user_id) VALUES (?,?,?,?)', id, null, 'pending', ctx.user.id);
    for (const l of lines) {
      const prod = get("SELECT * FROM products WHERE id=? AND status='active' AND EXISTS (SELECT 1 FROM pharmacy_catalog pc WHERE pc.product_id=products.id AND pc.pharmacy_id=?)", l.product_id, ctx.ph); if (!prod) throw bad('VALIDATION', 'Produit introuvable');
      const lid = insert('INSERT INTO order_lines(order_id,product_id,qty) VALUES (?,?,?)', id, l.product_id, l.qty);
      for (const a of allocate(ctx.ph, l.product_id, l.qty)) { // la réservation suit FEFO, comme la vente
        insert('INSERT INTO stock_reservations(order_line_id,pharmacy_id,batch_id,qty) VALUES (?,?,?,?)', lid, ctx.ph, a.batch.id, a.qty); reserve(ctx.ph, a.batch.id, a.qty);
      }
    }
    audit(ctx, 'order.create', 'order', id, undefined, { number, kind });
    notify({ pharmacyId: ctx.ph, audience: 'staff', kind: 'order', title: `Nouvelle ${kind === 'order' ? 'commande' : 'réservation'} ${number}`, link: `#/orders?id=${id}` });
    return { id, number, expires_at: get('SELECT expires_at e FROM customer_orders WHERE id=?', id).e };
  });
}
export function releaseOrder(orderId) {
  for (const r of all('SELECT * FROM stock_reservations WHERE released=0 AND order_line_id IN (SELECT id FROM order_lines WHERE order_id=?)', orderId)) {
    reserve(r.pharmacy_id, r.batch_id, -r.qty); run('UPDATE stock_reservations SET released=1 WHERE id=?', r.id);
  }
}
export function expireOrders() { // libération automatique des réservations échues
  let n = 0;
  for (const o of all("SELECT * FROM customer_orders WHERE status IN ('pending','confirmed','preparing','ready') AND expires_at < datetime('now')")) {
    tx(() => { releaseOrder(o.id); run("UPDATE customer_orders SET status='expired', updated_at=datetime('now') WHERE id=?", o.id); insert('INSERT INTO order_status_history(order_id,from_status,to_status) VALUES (?,?,?)', o.id, o.status, 'expired'); n++; });
  }
  return n;
}
const olines = (b) => arr(b.lines, 'lignes', { required: true, max: 50 }).map((l) => ({ product_id: int(l.product_id, 'produit', { required: true, min: 1 }), qty: int(l.qty, 'quantité', { required: true, min: 1, max: 1000 }) }));
// « Prêt pour la livraison » : la commande est prête et une livraison est demandée → le chauffeur affecté est prévenu et part vers la pharmacie.
export function readyForDelivery(d, userId) {
  if (d.status === 'issued') run("UPDATE deliveries SET status='received', updated_at=datetime('now') WHERE id=?", d.id);
  const drv = d.driver_id ? get('SELECT name,matricule,user_id FROM drivers WHERE id=?', d.driver_id) : null;
  insert('INSERT INTO delivery_events(delivery_id,status,note,user_id,driver_name,driver_matricule) VALUES (?,?,?,?,?,?)', d.id, 'received', drv ? 'Commande prête — chauffeur en route vers la pharmacie' : 'Commande prête pour la livraison', userId, drv?.name ?? null, drv?.matricule ?? null);
  if (drv?.user_id) notify({ pharmacyId: d.pharmacy_id, userId: drv.user_id, kind: 'delivery', title: `Commande prête : rendez-vous à la pharmacie (${d.number})`, link: `#/driver?id=${d.id}` });
  const cu = get('SELECT user_id FROM customers WHERE id=?', d.customer_id)?.user_id; publish(d.pharmacy_id, 'delivery', { id: d.id, order_id: d.order_id, number: d.number, status: 'received' }, cu); publish(d.pharmacy_id, 'delivery', { id: d.id, order_id: d.order_id, number: d.number, status: 'received' });
}
router.get('/orders', { perm: 'orders.view' }, (ctx) => {
  const w = ['o.pharmacy_id=?'], p = [ctx.ph]; if (ctx.query.status) { w.push('o.status=?'); p.push(ctx.query.status); }
  if (ctx.query.scope === 'current') w.push("o.status IN ('pending','confirmed','preparing','ready')"); else if (ctx.query.scope === 'past') w.push("o.status IN ('picked_up','cancelled','expired')"); // commandes actuelles / passées
  return paged(ctx, `SELECT COUNT(*) n FROM customer_orders o WHERE ${w.join(' AND ')}`, `SELECT o.*, c.name customer_name, (SELECT COUNT(*) FROM order_lines WHERE order_id=o.id) lines FROM customer_orders o JOIN customers c ON c.id=o.customer_id WHERE ${w.join(' AND ')} ORDER BY o.id DESC`, p);
});
router.get('/orders/:id', { perm: 'orders.view' }, (ctx) => {
  const o = get('SELECT o.*, c.name customer_name, c.phone customer_phone FROM customer_orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=? AND o.pharmacy_id=?', ctx.params.id, ctx.ph); if (!o) throw notFound('Commande');
  o.lines = all('SELECT l.*, p.name product_name, p.sale_price, p.rx_status FROM order_lines l JOIN products p ON p.id=l.product_id WHERE l.order_id=?', o.id);
  o.history = all('SELECT h.*, u.name user_name FROM order_status_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.order_id=? ORDER BY h.id', o.id);
  o.delivery_id = get("SELECT id FROM deliveries WHERE order_id=? AND status NOT IN ('cancelled','delivered','failed')", o.id)?.id ?? null; return o;
});
router.post('/orders', { perm: 'orders.manage' }, (ctx) => {
  const cid = int(ctx.body.customer_id, 'client', { required: true, min: 1 }); if (!get('SELECT 1 FROM customers WHERE id=? AND pharmacy_id=?', cid, ctx.ph)) throw bad('VALIDATION', 'Client inconnu');
  return createOrder(ctx, { customerId: cid, kind: oneOf(ctx.body.kind || 'reservation', 'type', ['reservation', 'order']), lines: olines(ctx.body), notes: str(ctx.body.notes, 'notes', { max: 500 }), address: str(ctx.body.delivery_address, 'adresse', { max: 300 }) });
});
const NEXT = { pending: ['confirmed', 'cancelled'], confirmed: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['cancelled'] };
router.post('/orders/:id/status', { perm: 'orders.manage', ok200: true }, (ctx) => {
  const to = oneOf(ctx.body.status, 'statut', ['confirmed', 'preparing', 'ready', 'cancelled'], { required: true });
  const o = get('SELECT * FROM customer_orders WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!o) throw notFound('Commande');
  if (!(NEXT[o.status] || []).includes(to)) throw conflict('BAD_TRANSITION', `Transition ${o.status} → ${to} impossible`);
  tx(() => {
    if (to === 'cancelled') releaseOrder(o.id);
    run("UPDATE customer_orders SET status=?, updated_at=datetime('now') WHERE id=?", to, o.id);
    insert('INSERT INTO order_status_history(order_id,from_status,to_status,user_id) VALUES (?,?,?,?)', o.id, o.status, to, ctx.user.id);
    audit(ctx, 'order.' + to, 'order', o.id, { status: o.status }, { status: to });
    const dl = to === 'ready' ? get("SELECT * FROM deliveries WHERE order_id=? AND status IN ('issued','received')", o.id) : null; if (dl) readyForDelivery(dl, ctx.user.id);
    const cu = get('SELECT user_id FROM customers WHERE id=?', o.customer_id);
    if (cu?.user_id) notify({ pharmacyId: ctx.ph, userId: cu.user_id, kind: 'order_status', title: `Commande ${o.number} : ${to === 'ready' ? (dl ? 'prête pour la livraison' : 'prête au retrait') : to}`, link: `#/portal?tab=orders&id=${o.id}` });
  });
  return { ok: true };
});
// Retrait : libère la réservation et crée la vente (mêmes lots) dans la même transaction.
router.post('/orders/:id/pickup', { perm: 'sales.create', ok200: true }, (ctx) => {
  need(ctx, 'orders.manage');
  return tx(() => {
    const o = get('SELECT * FROM customer_orders WHERE id=? AND pharmacy_id=?', ctx.params.id, ctx.ph); if (!o) throw notFound('Commande');
    if (!['ready', 'confirmed', 'preparing', 'pending'].includes(o.status)) throw conflict('BAD_STATE', 'Commande non retirable');
    const resv = all('SELECT r.*, l.product_id FROM stock_reservations r JOIN order_lines l ON l.id=r.order_line_id WHERE r.released=0 AND l.order_id=?', o.id);
    if (!resv.length) throw conflict('NO_RESERVATION', 'Aucun stock réservé pour cette commande');
    releaseOrder(o.id);
    const deposits = all("SELECT * FROM order_deposits WHERE order_id=? AND status='held'", o.id);
    const sale = createSale(ctx, { customer_id: o.customer_id, prescription_id: ctx.body.prescription_id, payments: ctx.body.payments, allow_credit: ctx.body.allow_credit === true, lines: resv.map((r) => ({ product_id: r.product_id, qty: r.qty, batch_id: r.batch_id })) }, { fromOrder: o.id, deposits });
    run("UPDATE customer_orders SET status='picked_up', updated_at=datetime('now') WHERE id=?", o.id);
    insert('INSERT INTO order_status_history(order_id,from_status,to_status,user_id) VALUES (?,?,?,?)', o.id, o.status, 'picked_up', ctx.user.id);
    audit(ctx, 'order.pickup', 'order', o.id, undefined, { sale: sale.number }); return sale;
  });
});

// ================= ESPACE CLIENT (portail) =================
const me = (ctx) => portalCustomer(ctx);
router.get('/portal/catalog', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => { // catalogue public : disponibilité en booléen, jamais les quantités ni les prix d'achat
  const c = me(ctx); const q = `%${ctx.query.q || ''}%`;
  return all(`SELECT p.id, p.name, p.dci, p.dosage, p.form, p.sale_price, p.rx_status,
    (SELECT COALESCE(SUM(s.qty_available - s.qty_reserved),0) FROM stock_levels s JOIN batches b ON b.id=s.batch_id WHERE s.pharmacy_id=? AND b.product_id=p.id AND b.status='ok' AND b.exp_date >= date('now')) > 0 AS available
    FROM products p WHERE p.status='active' AND EXISTS (SELECT 1 FROM pharmacy_catalog pc WHERE pc.product_id=p.id AND pc.pharmacy_id=?) AND (p.name LIKE ? OR p.dci LIKE ?) ORDER BY p.name LIMIT 50`, c.pharmacy_id, c.pharmacy_id, q, q);
});
router.get('/portal/orders', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => { return all(`SELECT o.pharmacy_id, (SELECT name FROM pharmacies WHERE id=o.pharmacy_id) pharmacy_name, o.notes, o.id,o.number,o.kind,o.status,o.expires_at,o.created_at,(SELECT COALESCE(SUM(l.qty*p.sale_price),0) FROM order_lines l JOIN products p ON p.id=l.product_id WHERE l.order_id=o.id) total,(SELECT COALESCE(SUM(d.amount),0) FROM order_deposits d WHERE d.order_id=o.id AND d.status IN ('held','applied')) paid,(SELECT x.id FROM deliveries x WHERE x.order_id=o.id) delivery_id,(SELECT x.status FROM deliveries x WHERE x.order_id=o.id) delivery_status FROM customer_orders o WHERE o.customer_id IN (SELECT id FROM customers WHERE user_id=?) ${isGuest(ctx) ? "AND o.status IN ('pending','confirmed','preparing','ready')" : ''} ORDER BY o.id DESC`, ctx.user.id).map((o) => ({ ...o, drivers_available: ['preparing', 'ready'].includes(o.status) && !o.delivery_id ? get("SELECT COUNT(*) n FROM drivers d WHERE " + AFF + " AND d.status='active' AND d.availability='available'", o.pharmacy_id, o.pharmacy_id).n : 0 })); });
router.post('/portal/orders', { anyPerm: ['portal.use', 'portal.guest'], needsPharmacy: false }, (ctx) => {
  const c = me(ctx); const lines = olines(ctx.body);
  for (const l of lines) { // produit sur ordonnance : possible seulement avec une ordonnance du client VALIDÉE par la pharmacie (jamais pour les produits contrôlés)
    const rx = get('SELECT rx_status FROM products WHERE id=?', l.product_id)?.rx_status; if (rx === 'free') continue;
    if (rx === 'controlled' || !get("SELECT 1 FROM prescriptions pr JOIN prescription_lines pl ON pl.prescription_id=pr.id WHERE pr.customer_id=? AND pr.pharmacy_id=? AND pl.product_id=? AND pr.status IN ('validated','partially_delivered') AND (pr.valid_until IS NULL OR pr.valid_until>=date('now'))", c.id, ctx.ph, l.product_id))
      throw conflict('PRESCRIPTION_REQUIRED', 'Ce médicament nécessite une ordonnance transmise à cette pharmacie et validée par le pharmacien avant la commande');
  }
  return createOrder({ ...ctx, user: { ...ctx.user, id: ctx.user.id } }, { customerId: c.id, kind: 'reservation', lines, notes: str(ctx.body.notes, 'notes', { max: 500 }) });
});
router.get('/portal/prescriptions', { perm: 'portal.use', needsPharmacy: false }, (ctx) => { const c = me(ctx); return all('SELECT id,number,subject,notes,status,status_reason,created_at FROM prescriptions WHERE customer_id=? ORDER BY id DESC', c.id); });
router.post('/portal/prescriptions', { perm: 'portal.use', needsPharmacy: false, bodyLimit: 6e6 }, (ctx) => {
  const c = me(ctx); if (!ctx.body.file) throw bad('VALIDATION', 'Joindre la photo ou le PDF de l\'ordonnance');
  const subject = str(ctx.body.subject, 'objet', { max: 160 });
  const r = createPrescription(ctx, { patient_name: c.name, file: ctx.body.file, notes: ctx.body.notes }, c.id); if (subject && r?.id) run('UPDATE prescriptions SET subject=? WHERE id=?', subject, r.id); return r;
});
