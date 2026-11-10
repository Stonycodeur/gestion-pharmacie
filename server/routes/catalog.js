import { normalizePhone, dialOfPharmacy } from '../phone.js';
import { moveToTrash } from './network.js';
import { router, audit, paged, can } from '../http.js';
import { get, all, run, insert, tx } from '../db.js';
import { HttpError, bad, notFound, str, int, num, oneOf, bool, norm, lev, parseCsv, toCsv, paging } from '../util.js';
import { need } from '../http.js';

// ---- recherche tolérante : accents, fautes de frappe, DCI, synonymes ----
const SYN = { acetaminophene: 'paracetamol', acetaminophen: 'paracetamol', aspirine: 'acide acetylsalicylique', ibuprofene: 'ibuprofen', 'vitamine c': 'acide ascorbique' };
let catalogCache = null;
export const invalidateCatalog = () => { catalogCache = null; };
function loadCatalog() {
  if (!catalogCache) catalogCache = all("SELECT p.*, c.name category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.status='active'").map((p) => ({ p, hay: norm([p.name, p.dci, p.generic_group, p.sku, p.barcode].join(' ')), name: norm(p.name), words: norm([p.name, p.dci].join(' ')).split(' ').filter((w) => w.length > 2) }));
  return catalogCache;
}
export function searchProducts(q, limit = 20, filter = null) {
  let nq = norm(q); if (!nq) return [];
  nq = SYN[nq] || nq;
  const tokens = nq.split(' ');
  const out = [];
  for (const e of loadCatalog()) {
    if (filter && !filter(e.p)) continue;
    let s = 0;
    if (e.p.barcode === q.trim() || e.p.sku.toLowerCase() === nq) s = 100;
    else if (e.name.startsWith(nq)) s = 80;
    else if (tokens.every((t) => e.hay.includes(t))) s = 60;
    else if (tokens.every((t) => t.length >= 4 ? e.words.some((w) => lev(t, w.slice(0, t.length + 1), 2) <= (t.length >= 7 ? 2 : 1)) : e.hay.includes(t))) s = 30;
    if (s) out.push({ s, p: e.p });
  }
  return out.sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).slice(0, limit).map((x) => x.p);
}

function productInput(b, partial = false) {
  const r = (v, f) => (partial && v === undefined ? undefined : f());
  const o = {
    sku: r(b.sku, () => str(b.sku, 'référence', { required: true, max: 60 })),
    name: r(b.name, () => str(b.name, 'nom', { required: true, max: 200 })),
    dci: r(b.dci, () => str(b.dci, 'DCI', { max: 200 })), dosage: r(b.dosage, () => str(b.dosage, 'dosage', { max: 80 })),
    form: r(b.form, () => str(b.form, 'forme', { max: 80 })), route: r(b.route, () => str(b.route, 'voie', { max: 80 })),
    packaging: r(b.packaging, () => str(b.packaging, 'conditionnement', { max: 120 })),
    manufacturer_id: r(b.manufacturer_id, () => int(b.manufacturer_id, 'fabricant', { min: 1 })), category_id: r(b.category_id, () => int(b.category_id, 'catégorie', { min: 1 })),
    barcode: r(b.barcode, () => str(b.barcode, 'code-barres', { max: 64 })),
    rx_status: r(b.rx_status, () => oneOf(b.rx_status || 'free', 'statut de prescription', ['free', 'prescription', 'controlled'])),
    storage_conditions: r(b.storage_conditions, () => str(b.storage_conditions, 'conservation', { max: 200 })),
    cold_chain: r(b.cold_chain, () => bool(b.cold_chain)), generic_group: r(b.generic_group, () => str(b.generic_group, 'groupe générique', { max: 120 })),
    min_stock: r(b.min_stock, () => int(b.min_stock ?? 0, 'seuil min', { min: 0 })), critical_stock: r(b.critical_stock, () => int(b.critical_stock ?? 0, 'seuil critique', { min: 0 })),
    max_stock: r(b.max_stock, () => int(b.max_stock ?? 0, 'seuil max', { min: 0 })),
    tax_rate: r(b.tax_rate, () => num(b.tax_rate ?? 0, 'taxe', { min: 0, max: 100 })),
    purchase_price: r(b.purchase_price, () => int(b.purchase_price ?? 0, 'prix d\'achat', { min: 0 })), sale_price: r(b.sale_price, () => int(b.sale_price ?? 0, 'prix de vente', { min: 0 })),
    image_url: r(b.image_url, () => { const u = str(b.image_url, 'image', { max: 500 }); if (u && !/^(https?:\/\/|\/)/.test(u)) throw bad('VALIDATION', 'URL d\'image invalide'); return u; }),
    status: r(b.status, () => oneOf(b.status || 'active', 'statut', ['active', 'inactive'])),
  };
  if (!partial && o.critical_stock > o.min_stock && o.min_stock) throw bad('VALIDATION', 'Le seuil critique doit être ≤ au seuil minimum');
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

router.get('/products', { perm: 'products.view', needsPharmacy: false }, (ctx) => {
  const { q, category_id, rx, status } = ctx.query;
  if (q) {
    const { page, limit, offset } = paging(ctx.query);
    const inCat = new Set(all('SELECT product_id FROM pharmacy_catalog WHERE pharmacy_id=?', ctx.ph).map((r) => r.product_id));
    const rows = searchProducts(q, 500, (p) => inCat.has(p.id) && (!category_id || p.category_id == category_id) && (!rx || p.rx_status === rx));
    return { data: rows.slice(offset, offset + limit), total: rows.length, page, limit };
  }
  const w = ['EXISTS (SELECT 1 FROM pharmacy_catalog pc WHERE pc.product_id=p.id AND pc.pharmacy_id=?)'], p = [ctx.ph];
  if (category_id) { w.push('p.category_id=?'); p.push(category_id); }
  if (rx) { w.push('p.rx_status=?'); p.push(rx); }
  w.push('p.status=?'); p.push(status === 'inactive' ? 'inactive' : 'active');
  return paged(ctx, `SELECT COUNT(*) n FROM products p WHERE ${w.join(' AND ')}`,
    `SELECT p.*, c.name category, m.name manufacturer FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN manufacturers m ON m.id=p.manufacturer_id WHERE ${w.join(' AND ')} ORDER BY p.name`, p);
});
router.get('/products/export.csv', { perm: 'products.manage', needsPharmacy: false }, (ctx) => {
  const rows = all('SELECT sku,name,dci,dosage,form,packaging,barcode,rx_status,tax_rate,purchase_price,sale_price,min_stock,critical_stock,max_stock FROM products ORDER BY name');
  audit(ctx, 'products.export', 'products', null, undefined, { count: rows.length });
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="produits.csv"' });
  ctx.res.end(toCsv(rows, ['sku', 'name', 'dci', 'dosage', 'form', 'packaging', 'barcode', 'rx_status', 'tax_rate', 'purchase_price', 'sale_price', 'min_stock', 'critical_stock', 'max_stock']));
});
router.get('/products/:id', { perm: 'products.view', needsPharmacy: false }, (ctx) => {
  const p = get('SELECT p.*, c.name category, m.name manufacturer FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN manufacturers m ON m.id=p.manufacturer_id WHERE p.id=?', ctx.params.id);
  if (!p) throw notFound('Produit');
  p.price_history = all('SELECT purchase_price, sale_price, created_at FROM product_price_history WHERE product_id=? ORDER BY id DESC LIMIT 20', p.id);
  return p;
});
// Alternatives / génériques : simple proposition, toute substitution reste soumise à la validation du pharmacien.
router.get('/products/:id/alternatives', { perm: 'products.view', needsPharmacy: false }, (ctx) => {
  const p = get('SELECT * FROM products WHERE id=?', ctx.params.id); if (!p) throw notFound('Produit');
  const rows = all("SELECT id,name,dci,dosage,form,sale_price,rx_status FROM products WHERE status='active' AND id!=? AND ((dci IS NOT NULL AND dci=?) OR (generic_group IS NOT NULL AND generic_group=?))", p.id, p.dci, p.generic_group);
  return { requires_pharmacist_validation: true, data: rows };
});
router.post('/products', { perm: 'products.manage', needsPharmacy: false }, (ctx) => {
  const o = productInput(ctx.body);
  if ((o.purchase_price || o.sale_price) && !can(ctx.user, 'prices.manage')) throw new HttpError(403, 'PERMISSION_DENIED', 'Permission requise : prices.manage');
  const id = tx(() => {
    const id = insert(`INSERT INTO products(${Object.keys(o).join(',')},created_by) VALUES (${Object.keys(o).map(() => '?').join(',')},?)`, ...Object.values(o), ctx.user.id);
    insert('INSERT INTO product_price_history(product_id,purchase_price,sale_price,changed_by) VALUES (?,?,?,?)', id, o.purchase_price ?? 0, o.sale_price ?? 0, ctx.user.id);
    const targets = ctx.user.role === 'super_admin' && ctx.body.pharmacy_ids === 'all' ? all('SELECT id FROM pharmacies').map((x) => x.id) : ctx.user.role === 'super_admin' && Array.isArray(ctx.body.pharmacy_ids) ? ctx.body.pharmacy_ids.map(Number).filter((x) => get('SELECT 1 FROM pharmacies WHERE id=?', x)) : [ctx.ph];
    for (const ph of new Set(targets)) run('INSERT OR IGNORE INTO pharmacy_catalog(pharmacy_id,product_id) VALUES (?,?)', ph, id);
    audit(ctx, 'product.create', 'product', id, undefined, o); return id;
  });
  invalidateCatalog(); return get('SELECT * FROM products WHERE id=?', id);
});
router.put('/products/:id', { perm: 'products.manage', needsPharmacy: false }, (ctx) => {
  const old = get('SELECT * FROM products WHERE id=?', ctx.params.id); if (!old) throw notFound('Produit');
  const o = productInput(ctx.body, true);
  const priceChange = ('purchase_price' in o && o.purchase_price !== old.purchase_price) || ('sale_price' in o && o.sale_price !== old.sale_price);
  if (priceChange && !can(ctx.user, 'prices.manage')) throw new HttpError(403, 'PERMISSION_DENIED', 'Permission requise : prices.manage');
  if (!Object.keys(o).length) throw bad('VALIDATION', 'Aucune modification');
  tx(() => {
    run(`UPDATE products SET ${Object.keys(o).map((k) => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`, ...Object.values(o), old.id);
    if (priceChange) insert('INSERT INTO product_price_history(product_id,purchase_price,sale_price,changed_by) VALUES (?,?,?,?)', old.id, o.purchase_price ?? old.purchase_price, o.sale_price ?? old.sale_price, ctx.user.id);
    audit(ctx, 'product.update', 'product', old.id, old, o);
  });
  invalidateCatalog(); return get('SELECT * FROM products WHERE id=?', old.id);
});
router.delete('/products/:id', { perm: 'products.manage', needsPharmacy: false }, (ctx) => { // suppression logique uniquement
  const old = get('SELECT * FROM products WHERE id=?', ctx.params.id); if (!old) throw notFound('Produit');
  const r = moveToTrash(ctx, 'product', old); invalidateCatalog(); return r;
});

// Import CSV contrôlé : simulation par défaut (dry_run), détection des doublons, journalisation.
router.post('/products/import', { perm: 'products.manage', needsPharmacy: false, ok200: true, bodyLimit: 4e6 }, (ctx) => {
  const rows = parseCsv(String(ctx.body.csv || ''));
  if (!rows.length) throw bad('VALIDATION', 'CSV vide');
  if (rows.length > 5000) throw bad('VALIDATION', 'Maximum 5000 lignes par import');
  const dry = ctx.body.dry_run !== false;
  const report = { created: 0, updated: 0, duplicates: [], errors: [] };
  const seen = new Set();
  const apply = () => rows.forEach((r, i) => {
    const line = i + 2;
    try {
      const o = productInput({ ...r, tax_rate: r.tax_rate === '' ? 0 : Number(r.tax_rate), purchase_price: Number(r.purchase_price || 0), sale_price: Number(r.sale_price || 0), min_stock: Number(r.min_stock || 0), critical_stock: Number(r.critical_stock || 0), max_stock: Number(r.max_stock || 0), barcode: r.barcode || null });
      if (seen.has(o.sku)) { report.duplicates.push({ line, sku: o.sku, why: 'SKU en double dans le fichier' }); return; }
      seen.add(o.sku);
      const ex = get('SELECT * FROM products WHERE sku=?', o.sku);
      const bc = o.barcode ? get('SELECT sku FROM products WHERE barcode=? AND sku!=?', o.barcode, o.sku) : null;
      if (bc) { report.duplicates.push({ line, sku: o.sku, why: `code-barres déjà utilisé par ${bc.sku}` }); return; }
      if (ex) {
        if (ctx.body.update_existing !== true) { report.duplicates.push({ line, sku: o.sku, why: 'SKU existant (mise à jour non demandée)' }); return; }
        if ((o.sale_price !== ex.sale_price || o.purchase_price !== ex.purchase_price) && !can(ctx.user, 'prices.manage')) throw new Error('prices.manage requis');
        if (!dry) { run(`UPDATE products SET ${Object.keys(o).map((k) => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`, ...Object.values(o), ex.id); }
        report.updated++;
      } else {
        if (!can(ctx.user, 'prices.manage') && (o.sale_price || o.purchase_price)) throw new Error('prices.manage requis');
        if (!dry) { const id = insert(`INSERT INTO products(${Object.keys(o).join(',')},created_by) VALUES (${Object.keys(o).map(() => '?').join(',')},?)`, ...Object.values(o), ctx.user.id); insert('INSERT INTO product_price_history(product_id,purchase_price,sale_price,changed_by) VALUES (?,?,?,?)', id, o.purchase_price, o.sale_price, ctx.user.id); run('INSERT OR IGNORE INTO pharmacy_catalog(pharmacy_id,product_id) VALUES (?,?)', ctx.ph, id); }
        report.created++;
      }
    } catch (e) { report.errors.push({ line, message: e.message }); }
  });
  if (dry) apply(); else tx(() => { apply(); if (report.errors.length) throw new HttpError(422, 'IMPORT_ERRORS', 'Import annulé : corrigez les erreurs', report); audit(ctx, 'products.import', 'products', null, undefined, { created: report.created, updated: report.updated }); });
  invalidateCatalog();
  return { dry_run: dry, ...report };
});

// ---- référentiels ----
router.get('/categories', { perm: 'products.view', needsPharmacy: false }, () => all('SELECT * FROM categories ORDER BY name'));
router.post('/categories', { perm: 'products.manage', needsPharmacy: false }, (ctx) => {
  const name = str(ctx.body.name, 'nom', { required: true, max: 100 });
  const id = insert('INSERT INTO categories(name,kind) VALUES (?,?)', name, str(ctx.body.kind, 'type', { max: 40 }) || 'medicament'); audit(ctx, 'category.create', 'category', id, undefined, { name }); return { id, name };
});
router.get('/manufacturers', { perm: 'products.view', needsPharmacy: false }, () => all('SELECT * FROM manufacturers ORDER BY name'));
router.post('/manufacturers', { perm: 'products.manage', needsPharmacy: false }, (ctx) => {
  const name = str(ctx.body.name, 'nom', { required: true, max: 120 }); const id = insert('INSERT INTO manufacturers(name) VALUES (?)', name); return { id, name };
});

// ---- fournisseurs ----
const supplierInput = (b, ctx) => ({
  name: str(b.name, 'nom', { required: true, max: 160 }), contact_name: str(b.contact_name, 'contact', { max: 120 }), phone: normalizePhone(b.phone, b.dial || dialOfPharmacy(ctx?.ph ?? ctx?.user?.pharmacy_id ?? 0)),
  email: str(b.email, 'e-mail', { max: 160 }), address: str(b.address, 'adresse', { max: 300 }), legal_id: str(b.legal_id, 'identifiant légal', { max: 60 }),
  payment_terms: str(b.payment_terms, 'conditions', { max: 200 }), lead_days: int(b.lead_days ?? 2, 'délai', { min: 0, max: 365 }), rating: int(b.rating ?? 0, 'note', { min: 0, max: 5 }),
  status: oneOf(b.status || 'active', 'statut', ['active', 'inactive']),
});
router.get('/suppliers', { perm: 'suppliers.view', needsPharmacy: false }, (ctx) => {
  const q = `%${ctx.query.q || ''}%`;
  return paged(ctx, "SELECT COUNT(*) n FROM suppliers WHERE name LIKE ? AND status != 'trashed'", "SELECT * FROM suppliers WHERE name LIKE ? AND status != 'trashed' ORDER BY name", [q]);
});
router.post('/suppliers', { perm: 'suppliers.manage', needsPharmacy: false }, (ctx) => {
  const o = supplierInput(ctx.body, ctx); const id = insert(`INSERT INTO suppliers(${Object.keys(o).join(',')}) VALUES (${Object.keys(o).map(() => '?').join(',')})`, ...Object.values(o));
  audit(ctx, 'supplier.create', 'supplier', id, undefined, o); return get('SELECT * FROM suppliers WHERE id=?', id);
});
router.put('/suppliers/:id', { perm: 'suppliers.manage', needsPharmacy: false }, (ctx) => {
  const old = get('SELECT * FROM suppliers WHERE id=?', ctx.params.id); if (!old) throw notFound('Fournisseur');
  const o = supplierInput({ ...old, ...ctx.body }, ctx);
  run(`UPDATE suppliers SET ${Object.keys(o).map((k) => k + '=?').join(',')} WHERE id=?`, ...Object.values(o), old.id);
  audit(ctx, 'supplier.update', 'supplier', old.id, old, o); return get('SELECT * FROM suppliers WHERE id=?', old.id);
});
// Évaluation fournisseur : respect des délais (réception vs date attendue) et taux de service
router.get('/suppliers/:id/performance', { perm: 'suppliers.view' }, (ctx) => {
  const s = get('SELECT * FROM suppliers WHERE id=?', ctx.params.id); if (!s) throw notFound('Fournisseur');
  const po = all("SELECT id, expected_date, status FROM purchase_orders WHERE supplier_id=? AND pharmacy_id=? AND status!='draft' AND status!='cancelled'", s.id, ctx.ph);
  const lines = get('SELECT COALESCE(SUM(l.qty_ordered),0) o, COALESCE(SUM(l.qty_received),0) r FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.po_id WHERE p.supplier_id=? AND p.pharmacy_id=? AND p.status IN (\'partial\',\'received\')', s.id, ctx.ph);
  const late = po.filter((p) => p.expected_date && get('SELECT MIN(created_at) d FROM goods_receipts WHERE po_id=?', p.id)?.d?.slice(0, 10) > p.expected_date).length;
  return { orders: po.length, late_orders: late, service_rate: lines.o ? Math.round((lines.r / lines.o) * 100) : null };
});
