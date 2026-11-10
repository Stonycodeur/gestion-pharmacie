// Demandes de prix aux fournisseurs : envoi, saisie des devis reçus, comparatif ligne par ligne, transformation en bon(s) de commande.
import { router, audit } from '../http.js';
import { get, all, run, insert, tx, nextNumber } from '../db.js';
import { bad, conflict, notFound, str, int, date, oneOf } from '../util.js';
import { sendMail, mailEnabled } from '../mailer.js';
import { renderMail, pharmacyBrand } from '../emailtpl.js';

const load = (id, ph) => { const r = get('SELECT * FROM rfqs WHERE id=? AND pharmacy_id=?', id, ph); if (!r) throw notFound('Demande de prix'); return r; };
function detail(r) {
  const lines = all('SELECT l.id, l.product_id, l.qty, p.name, p.sku FROM rfq_lines l JOIN products p ON p.id=l.product_id WHERE l.rfq_id=? ORDER BY l.id', r.id);
  const sups = all('SELECT rs.*, s.name, s.email, s.phone, s.contact_name, s.address FROM rfq_suppliers rs JOIN suppliers s ON s.id=rs.supplier_id WHERE rs.rfq_id=? ORDER BY rs.id', r.id);
  const quotes = all('SELECT q.rfq_supplier_id, q.rfq_line_id, q.unit_price FROM rfq_quotes q JOIN rfq_suppliers rs ON rs.id=q.rfq_supplier_id WHERE rs.rfq_id=?', r.id);
  const price = (sid, lid) => quotes.find((q) => q.rfq_supplier_id === sid && q.rfq_line_id === lid)?.unit_price ?? null;
  const best = Object.fromEntries(lines.map((l) => { const c = sups.map((s) => ({ s, p: price(s.id, l.id) })).filter((x) => x.p != null).sort((a, b) => a.p - b.p || (a.s.lead_days ?? 99) - (b.s.lead_days ?? 99))[0]; return [l.id, c ? c.s.supplier_id : null]; }));
  return { ...r, lines, best,
    suppliers: sups.map((s) => { const prices = Object.fromEntries(lines.map((l) => [l.id, price(s.id, l.id)])); const complete = lines.every((l) => prices[l.id] != null);
      return { id: s.id, supplier_id: s.supplier_id, name: s.name, email: s.email, phone: s.phone, contact_name: s.contact_name, address: s.address, status: s.status, lead_days: s.lead_days, notes: s.notes, sent_at: s.sent_at, quoted_at: s.quoted_at, prices, complete, total: complete ? lines.reduce((a, l) => a + prices[l.id] * l.qty, 0) : null }; }) };
}
router.get('/rfqs', { perm: 'rfq.manage' }, (ctx) => all('SELECT r.*, (SELECT COUNT(*) FROM rfq_suppliers WHERE rfq_id=r.id) suppliers, (SELECT COUNT(*) FROM rfq_suppliers WHERE rfq_id=r.id AND status=\'quoted\') quoted, (SELECT COUNT(*) FROM rfq_lines WHERE rfq_id=r.id) lines FROM rfqs r WHERE r.pharmacy_id=? ORDER BY r.id DESC LIMIT 200', ctx.ph));
router.get('/rfqs/:id', { perm: 'rfq.manage' }, (ctx) => detail(load(ctx.params.id, ctx.ph)));
router.post('/rfqs', { perm: 'rfq.manage' }, (ctx) => tx(() => {
  const title = str(ctx.body.title, 'objet', { required: true, min: 3, max: 120 }); const lines = Array.isArray(ctx.body.lines) ? ctx.body.lines : [], sids = [...new Set(Array.isArray(ctx.body.supplier_ids) ? ctx.body.supplier_ids.map(Number) : [])];
  if (!lines.length || lines.length > 200) throw bad('VALIDATION', 'Ajoutez 1 à 200 produits'); if (sids.length < 1 || sids.length > 20) throw bad('VALIDATION', 'Choisissez 1 à 20 fournisseurs');
  const number = nextNumber(ctx.ph, 'rfq', 'DP');
  const id = insert('INSERT INTO rfqs(pharmacy_id,number,title,deadline,notes,created_by) VALUES (?,?,?,?,?,?)', ctx.ph, number, title, date(ctx.body.deadline, 'date limite'), str(ctx.body.notes, 'notes', { max: 500 }), ctx.user.id);
  const seen = new Set(); for (const l of lines) { const pid = int(l.product_id, 'produit', { required: true, min: 1 }), qty = int(l.qty, 'quantité', { required: true, min: 1, max: 1000000 }); if (seen.has(pid)) throw bad('VALIDATION', 'Produit en double'); seen.add(pid); if (!get('SELECT 1 FROM products WHERE id=?', pid)) throw bad('VALIDATION', 'Produit inconnu'); insert('INSERT INTO rfq_lines(rfq_id,product_id,qty) VALUES (?,?,?)', id, pid, qty); }
  for (const sid of sids) { if (!get("SELECT 1 FROM suppliers WHERE id=? AND status='active'", sid)) throw bad('VALIDATION', 'Fournisseur inconnu ou inactif'); insert('INSERT INTO rfq_suppliers(rfq_id,supplier_id) VALUES (?,?)', id, sid); }
  audit(ctx, 'rfq.create', 'rfq', id, undefined, { number, lines: lines.length, suppliers: sids.length }); return { id, number };
}));
async function mailSupplier(r, d, s, ph) {
  if (!s.email || !mailEnabled()) return false;
  const { html, text } = renderMail({ pharmacyId: r.pharmacy_id, title: `Demande de prix ${r.number}`, preheader: `${ph.name} vous demande vos meilleurs prix`, blocks: [
    { p: `Bonjour${s.contact_name ? ' ' + s.contact_name : ''},\n\nMerci de nous communiquer votre meilleur prix unitaire et votre délai de livraison pour les produits ci-dessous.` },
    { table: [...d.lines.map((l) => [`${l.name} (${l.sku})`, `Quantité : ${l.qty}`]), ...(r.deadline ? [['Réponse souhaitée avant le', r.deadline]] : [])] },
    ...(r.notes ? [{ p: r.notes }] : []),
    { p: `Référence à rappeler dans votre réponse : ${r.number}\nPour nous joindre : ${[ph.name, ph.phone, ph.email].filter(Boolean).join(' · ')}` },
  ] });
  await sendMail({ to: s.email, subject: `Demande de prix ${r.number} — ${ph.name}`, text, html }); return true;
}
// Aperçu du message tel que le fournisseur le recevra (avant l'envoi)
router.get('/rfqs/:id/preview', { perm: 'rfq.manage' }, (ctx) => {
  const r = load(ctx.params.id, ctx.ph); const d = detail(r); const ph = get('SELECT name,phone,email FROM pharmacies WHERE id=?', ctx.ph); const s = d.suppliers[0] || {};
  const { html, text } = renderMail({ pharmacyId: ctx.ph, title: `Demande de prix ${r.number}`, preheader: '', blocks: [{ p: `Bonjour${s.contact_name ? ' ' + s.contact_name : ''},\n\nMerci de nous communiquer votre meilleur prix unitaire et votre délai de livraison pour les produits ci-dessous.` }, { table: d.lines.map((l) => [`${l.name} (${l.sku})`, `Quantité : ${l.qty}`]) }, ...(r.notes ? [{ p: r.notes }] : []), { p: `Référence : ${r.number}\n${[ph.name, ph.phone, ph.email].filter(Boolean).join(' · ')}` }] });
  return { html, text, brand: pharmacyBrand(ctx.ph), recipients: d.suppliers.map((x) => ({ name: x.name, email: x.email, phone: x.phone, contact_name: x.contact_name, address: x.address, has_email: !!x.email })), mail_enabled: mailEnabled() };
});
router.post('/rfqs/:id/send', { perm: 'rfq.manage', ok200: true }, async (ctx) => {
  const r = load(ctx.params.id, ctx.ph); if (r.status !== 'draft') throw conflict('BAD_STATE', 'Cette demande a déjà été envoyée');
  const d = detail(r); const ph = get('SELECT name,email,phone FROM pharmacies WHERE id=?', ctx.ph); let mailed = 0; const missing = [];
  for (const s of d.suppliers) { try { if (await mailSupplier(r, d, s, ph)) { mailed++; run("UPDATE rfq_suppliers SET sent_at=datetime('now') WHERE id=?", s.id); } else missing.push(s.name); } catch (e) { console.error('[rfq]', e.message); missing.push(s.name); } }
  tx(() => { run("UPDATE rfqs SET status='sent' WHERE id=?", r.id); run("UPDATE rfq_suppliers SET sent_at=COALESCE(sent_at, datetime('now')) WHERE rfq_id=?", r.id); });
  audit(ctx, 'rfq.send', 'rfq', r.id, undefined, { mailed }); return { ok: true, mailed, to_contact_manually: missing };
});
// Fournisseurs déjà sollicités par cette pharmacie (pour redemander à un ancien fournisseur)
router.get('/rfq-suppliers/past', { perm: 'rfq.manage' }, (ctx) => all(`SELECT s.id, s.name, s.email, s.phone, s.contact_name, s.address, COUNT(*) requests, MAX(rs.sent_at) last_sent, SUM(CASE WHEN rs.status='quoted' THEN 1 ELSE 0 END) quotes
  FROM rfq_suppliers rs JOIN rfqs r ON r.id=rs.rfq_id JOIN suppliers s ON s.id=rs.supplier_id WHERE r.pharmacy_id=? AND s.status='active' GROUP BY s.id, s.name, s.email, s.phone, s.contact_name, s.address ORDER BY MAX(rs.id) DESC`, ctx.ph));
// Ajouter un fournisseur (ancien ou nouveau) à une demande déjà envoyée et lui écrire tout de suite
router.post('/rfqs/:id/suppliers', { perm: 'rfq.manage' }, async (ctx) => {
  const r = load(ctx.params.id, ctx.ph); if (!['draft', 'sent'].includes(r.status)) throw conflict('BAD_STATE', 'Demande clôturée');
  const sid = int(ctx.body.supplier_id, 'fournisseur', { required: true }); if (!get("SELECT 1 FROM suppliers WHERE id=? AND status='active'", sid)) throw bad('VALIDATION', 'Fournisseur inconnu ou inactif');
  if (get('SELECT 1 FROM rfq_suppliers WHERE rfq_id=? AND supplier_id=?', r.id, sid)) throw conflict('DUPLICATE', 'Ce fournisseur est déjà dans la demande');
  const rsId = insert('INSERT INTO rfq_suppliers(rfq_id,supplier_id) VALUES (?,?)', r.id, sid); let mailed = false;
  if (r.status === 'sent') { const d = detail(r); const s = d.suppliers.find((x) => x.id === rsId); const ph = get('SELECT name,email,phone FROM pharmacies WHERE id=?', ctx.ph); try { mailed = await mailSupplier(r, d, s, ph); if (mailed) run("UPDATE rfq_suppliers SET sent_at=datetime('now') WHERE id=?", rsId); } catch (e) { console.error('[rfq]', e.message); } }
  audit(ctx, 'rfq.add_supplier', 'rfq', r.id, undefined, { supplier_id: sid, mailed }); return { id: rsId, mailed };
});
// Renvoyer la demande à un fournisseur qui n'a pas répondu
router.post('/rfqs/:id/suppliers/:sid/resend', { perm: 'rfq.manage', ok200: true }, async (ctx) => {
  const r = load(ctx.params.id, ctx.ph); if (r.status !== 'sent') throw conflict('BAD_STATE', 'Demande non envoyée');
  const d = detail(r); const s = d.suppliers.find((x) => x.supplier_id === Number(ctx.params.sid)); if (!s) throw notFound('Fournisseur de la demande');
  const ph = get('SELECT name,email,phone FROM pharmacies WHERE id=?', ctx.ph); let mailed = false; try { mailed = await mailSupplier(r, d, s, ph); } catch (e) { console.error('[rfq]', e.message); }
  if (mailed) run("UPDATE rfq_suppliers SET sent_at=datetime('now') WHERE id=?", s.id); audit(ctx, 'rfq.resend', 'rfq', r.id, undefined, { supplier_id: s.supplier_id, mailed }); return { ok: true, mailed };
});
// Nouvelle demande à partir d'une ancienne (mêmes produits, mêmes fournisseurs ou une sélection)
router.post('/rfqs/:id/clone', { perm: 'rfq.manage' }, (ctx) => tx(() => {
  const r = load(ctx.params.id, ctx.ph); const d = detail(r); const picked = Array.isArray(ctx.body.supplier_ids) && ctx.body.supplier_ids.length ? ctx.body.supplier_ids.map(Number) : d.suppliers.map((x) => x.supplier_id);
  const number = nextNumber(ctx.ph, 'rfq', 'DP'); const id = insert('INSERT INTO rfqs(pharmacy_id,number,title,deadline,notes,created_by) VALUES (?,?,?,?,?,?)', ctx.ph, number, str(ctx.body.title, 'objet', { max: 120 }) || `${r.title} (relance)`, null, r.notes, ctx.user.id);
  for (const l of d.lines) insert('INSERT INTO rfq_lines(rfq_id,product_id,qty) VALUES (?,?,?)', id, l.product_id, l.qty);
  for (const sid of new Set(picked)) if (get("SELECT 1 FROM suppliers WHERE id=? AND status='active'", sid)) insert('INSERT INTO rfq_suppliers(rfq_id,supplier_id) VALUES (?,?)', id, sid);
  audit(ctx, 'rfq.clone', 'rfq', id, undefined, { from: r.number }); return { id, number };
}));
router.put('/rfqs/:id/quotes', { perm: 'rfq.manage', ok200: true }, (ctx) => tx(() => {
  const r = load(ctx.params.id, ctx.ph); if (r.status !== 'sent') throw conflict('BAD_STATE', 'Envoyez d\'abord la demande');
  const rs = get('SELECT * FROM rfq_suppliers WHERE rfq_id=? AND supplier_id=?', r.id, int(ctx.body.supplier_id, 'fournisseur', { required: true })); if (!rs) throw notFound('Fournisseur de la demande');
  const prices = ctx.body.prices && typeof ctx.body.prices === 'object' ? ctx.body.prices : {}; const ids = new Set(all('SELECT id FROM rfq_lines WHERE rfq_id=?', r.id).map((x) => String(x.id)));
  run('DELETE FROM rfq_quotes WHERE rfq_supplier_id=?', rs.id); let n = 0;
  for (const [lid, p] of Object.entries(prices)) { if (p === null || p === '') continue; if (!ids.has(lid)) throw bad('VALIDATION', 'Ligne inconnue'); insert('INSERT INTO rfq_quotes(rfq_supplier_id,rfq_line_id,unit_price) VALUES (?,?,?)', rs.id, Number(lid), int(p, 'prix', { required: true, min: 0, max: 100000000 })); n++; }
  if (!n) throw bad('VALIDATION', 'Saisissez au moins un prix');
  run("UPDATE rfq_suppliers SET status='quoted', lead_days=?, notes=?, quoted_at=datetime('now') WHERE id=?", ctx.body.lead_days == null || ctx.body.lead_days === '' ? null : int(ctx.body.lead_days, 'délai', { min: 0, max: 365 }), str(ctx.body.notes, 'notes', { max: 300 }), rs.id);
  audit(ctx, 'rfq.quote', 'rfq', r.id, undefined, { supplier_id: rs.supplier_id, lines: n }); return { ok: true };
}));
router.post('/rfqs/:id/decline', { perm: 'rfq.manage', ok200: true }, (ctx) => { const r = load(ctx.params.id, ctx.ph); if (r.status !== 'sent') throw conflict('BAD_STATE', 'Demande non envoyée'); run("DELETE FROM rfq_quotes WHERE rfq_supplier_id IN (SELECT id FROM rfq_suppliers WHERE rfq_id=? AND supplier_id=?)", r.id, int(ctx.body.supplier_id, 'fournisseur', { required: true })); run("UPDATE rfq_suppliers SET status='declined' WHERE rfq_id=? AND supplier_id=?", r.id, Number(ctx.body.supplier_id)); return { ok: true }; });
router.post('/rfqs/:id/cancel', { perm: 'rfq.manage', ok200: true }, (ctx) => { const r = load(ctx.params.id, ctx.ph); if (!['draft', 'sent'].includes(r.status)) throw conflict('BAD_STATE', 'Demande déjà clôturée'); run("UPDATE rfqs SET status='cancelled' WHERE id=?", r.id); audit(ctx, 'rfq.cancel', 'rfq', r.id); return { ok: true }; });
// Attribution : un seul fournisseur (tout chez lui) ou « meilleur prix par ligne » (un bon de commande par fournisseur retenu). Les bons sont créés en BROUILLON (validation habituelle).
router.post('/rfqs/:id/award', { perm: 'rfq.manage' }, (ctx) => tx(() => {
  const r = load(ctx.params.id, ctx.ph); if (r.status !== 'sent') throw conflict('BAD_STATE', 'Demande non envoyée ou déjà clôturée'); const d = detail(r);
  const mode = oneOf(ctx.body.mode, 'mode', ['single', 'best'], { required: true }); const pick = new Map(); // ligne → supplier_id
  if (mode === 'single') { const s = d.suppliers.find((x) => x.supplier_id === int(ctx.body.supplier_id, 'fournisseur', { required: true })); if (!s || !s.complete) throw conflict('INCOMPLETE_QUOTE', 'Ce fournisseur n\'a pas chiffré toutes les lignes'); d.lines.forEach((l) => pick.set(l.id, s.supplier_id)); }
  else for (const l of d.lines) { if (d.best[l.id] == null) throw conflict('NO_QUOTE', `Aucun prix reçu pour ${l.name}`); pick.set(l.id, d.best[l.id]); }
  const created = []; for (const sid of new Set(pick.values())) {
    const s = d.suppliers.find((x) => x.supplier_id === sid); const number = nextNumber(ctx.ph, 'po', 'BC');
    const po = insert('INSERT INTO purchase_orders(pharmacy_id,supplier_id,number,notes,created_by) VALUES (?,?,?,?,?)', ctx.ph, sid, number, `Issu de la demande de prix ${r.number}`, ctx.user.id);
    for (const l of d.lines) if (pick.get(l.id) === sid) insert('INSERT INTO purchase_order_lines(po_id,product_id,qty_ordered,unit_cost) VALUES (?,?,?,?)', po, l.product_id, l.qty, s.prices[l.id]);
    created.push({ id: po, number, supplier: s.name });
  }
  run("UPDATE rfqs SET status='closed', po_id=? WHERE id=?", created[0].id, r.id); audit(ctx, 'rfq.award', 'rfq', r.id, undefined, { mode, purchase_orders: created.map((c) => c.number) }); return { purchase_orders: created };
}));
