// Données FICTIVES de démonstration (aucune donnée réelle) — JAMAIS en production. Usage : npm run demo (efface la base !)
import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.NODE_ENV === 'production') { console.error('Refus : jeu de démonstration interdit en production.'); process.exit(1); }
if (process.argv.includes('--reset')) {
  const f = resolve(process.cwd(), process.env.DB_FILE || './data/dev.sqlite');
  for (const s of ['', '-wal', '-shm']) if (existsSync(f + s)) rmSync(f + s);
}
const { get, run, insert, tx, nextNumber } = await import('./db.js');
const { seedRbac } = await import('./rbac.js');
const { hashPassword } = await import('./security.js');
const { applyMovement } = await import('./stock.js');
const { createSale } = await import('./sales.js');
const { addDays, todaySql } = await import('./util.js');

seedRbac();
(await import('./boot.js')).bootNetwork();
if (get('SELECT 1 FROM pharmacies LIMIT 1')) { console.log('Base déjà initialisée (utilisez npm run reset pour repartir de zéro).'); process.exit(0); }

const PASSWORD = process.env.SEED_PASSWORD || 'Demo#Pharma2026';
let seedN = 42; const rnd = () => ((seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const day = (n) => addDays(todaySql(), n).slice(0, 10);

tx(() => {
  const ph = insert("INSERT INTO pharmacies(name,address,phone,email,currency,currency_decimals,timezone,invoice_prefix,legal_notice) VALUES (?,?,?,?,?,?,?,?,?)",
    'Pharmacie Centrale (démo)', '12 avenue de la Santé, Tunis', '+216 71 000 000', 'contact@pharmacie-demo.example', 'TND', 3, 'Africa/Tunis', 'F', 'Document de démonstration — données fictives.');
  const reg1 = insert('INSERT INTO cash_registers(pharmacy_id,name) VALUES (?,?)', ph, 'Caisse 1'); insert('INSERT INTO cash_registers(pharmacy_id,name) VALUES (?,?)', ph, 'Caisse 2');

  const users = [
    ['superadmin@demo.local', 'Super Administrateur', 'super_admin', null], ['admin@demo.local', 'Amel Admin', 'pharmacy_admin', ph],
    ['responsable@demo.local', 'Dr. Karim Responsable', 'pharmacist_in_charge', ph], ['pharmacien@demo.local', 'Dr. Sana Pharmacienne', 'pharmacist', ph],
    ['preparateur@demo.local', 'Youssef Préparateur', 'assistant', ph], ['caissier@demo.local', 'Leila Caissière', 'cashier', ph],
    ['stock@demo.local', 'Omar Stock', 'stock_manager', ph], ['comptable@demo.local', 'Nadia Comptable', 'accountant', ph], ['auditeur@demo.local', 'Walid Auditeur', 'auditor', ph],
  ];
  const U = {}; const hash = hashPassword(PASSWORD);
  for (const [e, n, r, p] of users) U[r] = insert('INSERT INTO users(email,password_hash,name,role_code,pharmacy_id) VALUES (?,?,?,?,?)', e, hash, n, r, p);
  const custUser = insert("INSERT INTO users(email,password_hash,name,role_code,pharmacy_id) VALUES (?,?,?,'customer',?)", 'client@demo.local', hash, 'Salma Cliente', ph);

  const cat = {}; for (const [n, k] of [['Médicaments', 'medicament'], ['Dispositifs médicaux', 'dispositif'], ['Parapharmacie', 'parapharmacie'], ['Hygiène & soins', 'hygiene'], ['Nutrition', 'nutrition']]) cat[n] = insert('INSERT INTO categories(name,kind) VALUES (?,?)', n, k);
  const mf = {}; for (const n of ['Laboratoire Alpha', 'Laboratoire Beta', 'MedTech Demo', 'Nutri Demo']) mf[n] = insert('INSERT INTO manufacturers(name) VALUES (?)', n);
  const sup = {}; for (const [n, c, lead] of [['Grossiste Santé Plus', 'M. Ben Ali', 1], ['Distribution Pharma Sud', 'Mme Trabelsi', 2], ['MedTech Fournitures', 'M. Gharbi', 4]])
    sup[n] = insert('INSERT INTO suppliers(name,contact_name,phone,email,lead_days,payment_terms,rating) VALUES (?,?,?,?,?,?,?)', n, c, '+216 70 111 222', `contact@${n.toLowerCase().replace(/[^a-z]/g, '')}.example`, lead, '30 jours', 4);

  // [sku, nom, dci, dosage, forme, catégorie, fabricant, rx, achat, vente, taxe, min, crit, max, fournisseur, froid]
  const P = [
    ['PAR500', 'Paracétamol 500 mg comprimés B/16', 'Paracétamol', '500 mg', 'Comprimé', 'Médicaments', 'Laboratoire Alpha', 'free', 600, 1200, 0, 40, 15, 300, 'Grossiste Santé Plus'],
    ['PAR1G', 'Paracétamol 1 g comprimés B/8', 'Paracétamol', '1 g', 'Comprimé', 'Médicaments', 'Laboratoire Beta', 'free', 700, 1500, 0, 30, 10, 200, 'Grossiste Santé Plus'],
    ['IBU400', 'Ibuprofène 400 mg comprimés B/20', 'Ibuprofène', '400 mg', 'Comprimé', 'Médicaments', 'Laboratoire Alpha', 'free', 1100, 2200, 0, 30, 10, 200, 'Grossiste Santé Plus'],
    ['ASP500', 'Acide acétylsalicylique 500 mg B/20', 'Acide acétylsalicylique', '500 mg', 'Comprimé', 'Médicaments', 'Laboratoire Beta', 'free', 800, 1700, 0, 20, 8, 150, 'Distribution Pharma Sud'],
    ['LOR10', 'Loratadine 10 mg comprimés B/15', 'Loratadine', '10 mg', 'Comprimé', 'Médicaments', 'Laboratoire Alpha', 'free', 1500, 3100, 0, 15, 5, 100, 'Distribution Pharma Sud'],
    ['CET10', 'Cétirizine 10 mg comprimés B/20', 'Cétirizine', '10 mg', 'Comprimé', 'Médicaments', 'Laboratoire Beta', 'free', 1400, 2900, 0, 15, 5, 100, 'Distribution Pharma Sud'],
    ['SIROPT', 'Sirop contre la toux adulte 125 ml', 'Dextrométhorphane', '15 mg/5 ml', 'Sirop', 'Médicaments', 'Laboratoire Alpha', 'free', 2200, 4500, 0, 10, 4, 60, 'Grossiste Santé Plus'],
    ['OME20', 'Oméprazole 20 mg gélules B/14', 'Oméprazole', '20 mg', 'Gélule', 'Médicaments', 'Laboratoire Beta', 'prescription', 2500, 5200, 0, 15, 5, 100, 'Distribution Pharma Sud'],
    ['AMX500', 'Amoxicilline 500 mg gélules B/12', 'Amoxicilline', '500 mg', 'Gélule', 'Médicaments', 'Laboratoire Alpha', 'prescription', 2800, 5800, 0, 20, 8, 120, 'Grossiste Santé Plus'],
    ['AMC1G', 'Amoxicilline/ac. clavulanique 1 g B/12', 'Amoxicilline + ac. clavulanique', '1 g', 'Comprimé', 'Médicaments', 'Laboratoire Beta', 'prescription', 6500, 12900, 0, 10, 4, 60, 'Grossiste Santé Plus'],
    ['AZI250', 'Azithromycine 250 mg comprimés B/6', 'Azithromycine', '250 mg', 'Comprimé', 'Médicaments', 'Laboratoire Beta', 'prescription', 4200, 8600, 0, 8, 3, 50, 'Distribution Pharma Sud'],
    ['MET850', 'Metformine 850 mg comprimés B/30', 'Metformine', '850 mg', 'Comprimé', 'Médicaments', 'Laboratoire Alpha', 'prescription', 2300, 4800, 0, 25, 10, 200, 'Distribution Pharma Sud'],
    ['AML5', 'Amlodipine 5 mg comprimés B/30', 'Amlodipine', '5 mg', 'Comprimé', 'Médicaments', 'Laboratoire Beta', 'prescription', 2600, 5400, 0, 20, 8, 150, 'Distribution Pharma Sud'],
    ['ATO20', 'Atorvastatine 20 mg comprimés B/30', 'Atorvastatine', '20 mg', 'Comprimé', 'Médicaments', 'Laboratoire Alpha', 'prescription', 5200, 10500, 0, 15, 6, 120, 'Grossiste Santé Plus'],
    ['LEV100', 'Lévothyroxine 100 µg comprimés B/30', 'Lévothyroxine', '100 µg', 'Comprimé', 'Médicaments', 'Laboratoire Beta', 'prescription', 3100, 6400, 0, 10, 4, 80, 'Distribution Pharma Sud'],
    ['SAL100', 'Salbutamol 100 µg aérosol doseur', 'Salbutamol', '100 µg/dose', 'Aérosol', 'Médicaments', 'Laboratoire Alpha', 'prescription', 3800, 7900, 0, 8, 3, 50, 'Grossiste Santé Plus'],
    ['DIA5', 'Diazépam 5 mg comprimés B/30', 'Diazépam', '5 mg', 'Comprimé', 'Médicaments', 'Laboratoire Beta', 'controlled', 2100, 4400, 0, 5, 2, 30, 'Distribution Pharma Sud'],
    ['TRA50', 'Tramadol 50 mg gélules B/20', 'Tramadol', '50 mg', 'Gélule', 'Médicaments', 'Laboratoire Alpha', 'controlled', 3500, 7200, 0, 5, 2, 30, 'Distribution Pharma Sud'],
    ['INSG', 'Insuline glargine 100 UI/ml stylo', 'Insuline glargine', '100 UI/ml', 'Stylo injectable', 'Médicaments', 'Laboratoire Beta', 'prescription', 28000, 41000, 0, 6, 3, 30, 'Grossiste Santé Plus', 1],
    ['VITC', 'Vitamine C 500 mg effervescent B/20', 'Acide ascorbique', '500 mg', 'Comprimé effervescent', 'Parapharmacie', 'Nutri Demo', 'free', 3500, 7500, 7, 12, 4, 80, 'Distribution Pharma Sud'],
    ['MAGB6', 'Magnésium B6 comprimés B/50', 'Magnésium + Vitamine B6', null, 'Comprimé', 'Parapharmacie', 'Nutri Demo', 'free', 4800, 9800, 7, 12, 4, 80, 'Distribution Pharma Sud'],
    ['SERUM', 'Sérum physiologique unidoses B/40', 'Chlorure de sodium', '0,9 %', 'Solution', 'Hygiène & soins', 'Laboratoire Alpha', 'free', 1600, 3500, 7, 20, 8, 150, 'Grossiste Santé Plus'],
    ['GEL100', 'Gel hydroalcoolique 100 ml', null, null, 'Gel', 'Hygiène & soins', 'MedTech Demo', 'free', 1200, 2800, 19, 20, 8, 120, 'MedTech Fournitures'],
    ['PANS20', 'Pansements adhésifs assortis B/20', null, null, 'Pansement', 'Dispositifs médicaux', 'MedTech Demo', 'free', 900, 2400, 7, 20, 8, 150, 'MedTech Fournitures'],
    ['COMP50', 'Compresses stériles 10×10 B/50', null, null, 'Compresse', 'Dispositifs médicaux', 'MedTech Demo', 'free', 1800, 3900, 7, 15, 5, 100, 'MedTech Fournitures'],
    ['THERM', 'Thermomètre digital', null, null, 'Dispositif', 'Dispositifs médicaux', 'MedTech Demo', 'free', 6000, 14500, 19, 5, 2, 25, 'MedTech Fournitures'],
    ['TENSIO', 'Tensiomètre électronique bras', null, null, 'Dispositif', 'Dispositifs médicaux', 'MedTech Demo', 'free', 42000, 89000, 19, 3, 1, 12, 'MedTech Fournitures'],
    ['MASK50', 'Masques chirurgicaux B/50', null, null, 'Masque', 'Dispositifs médicaux', 'MedTech Demo', 'free', 3000, 6900, 19, 20, 8, 150, 'MedTech Fournitures'],
    ['CHLOR', 'Chlorhexidine solution antiseptique 100 ml', 'Chlorhexidine', '0,5 %', 'Solution', 'Hygiène & soins', 'Laboratoire Alpha', 'free', 2400, 5100, 7, 10, 4, 60, 'Grossiste Santé Plus'],
    ['SOL50', 'Crème solaire SPF50 50 ml', null, null, 'Crème', 'Parapharmacie', 'Nutri Demo', 'free', 14000, 29900, 19, 6, 2, 40, 'Distribution Pharma Sud'],
    ['LAIT1', 'Lait infantile 1er âge 800 g', null, null, 'Poudre', 'Nutrition', 'Nutri Demo', 'free', 21000, 33500, 7, 8, 3, 60, 'Distribution Pharma Sud'],
    ['DENT', 'Brosse à dents souple', null, null, 'Accessoire', 'Hygiène & soins', 'Nutri Demo', 'free', 700, 2000, 19, 15, 5, 100, 'MedTech Fournitures'],
  ];
  const PID = {}, PRODUCT = {};
  P.forEach((p, i) => {
    const [sku, name, dci, dosage, form, c, m, rx, buy, sell, tax, min, crit, max, sp, cold] = p;
    const bc = '619' + String(1000000000 + i * 7919).slice(0, 10);
    const id = insert('INSERT INTO products(sku,name,dci,dosage,form,category_id,manufacturer_id,barcode,rx_status,purchase_price,sale_price,tax_rate,min_stock,critical_stock,max_stock,cold_chain,storage_conditions,generic_group,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      sku, name, dci, dosage, form, cat[c], mf[m], bc, rx, buy, sell, tax, min, crit, max, cold ? 1 : 0, cold ? '2–8 °C' : 'Température ambiante < 25 °C', dci, U.stock_manager);
    insert('INSERT INTO product_price_history(product_id,purchase_price,sale_price,changed_by) VALUES (?,?,?,?)', id, buy, sell, U.stock_manager);
    PID[sku] = id; PRODUCT[sku] = { id, sp: sup[sp], buy, max, min };
  });

  // Réceptions par fournisseur (lots, péremptions variées). Cas de test : lot proche péremption, lot périmé, lot en quarantaine.
  const bySupplier = {};
  for (const [sku, o] of Object.entries(PRODUCT)) (bySupplier[o.sp] ||= []).push([sku, o]);
  const batchOf = {};
  for (const [supId, items] of Object.entries(bySupplier)) {
    const rid = insert('INSERT INTO goods_receipts(pharmacy_id,supplier_id,number,supplier_invoice_ref,user_id) VALUES (?,?,?,?,?)', ph, Number(supId), nextNumber(ph, 'gr', 'BR'), 'FAC-DEMO-' + supId, U.stock_manager);
    for (const [sku, o] of items) {
      const lots = [[`${sku}-A24`, 150 + Math.floor(rnd() * 200), Math.round(o.max * (0.3 + rnd() * 0.25))], [`${sku}-B25`, 400 + Math.floor(rnd() * 300), Math.round(o.max * 0.2)]];
      if (['PAR500', 'IBU400', 'AMX500'].includes(sku)) lots.unshift([`${sku}-OLD`, 25, 12]); // proche péremption
      for (const [no, dleft, qty] of lots) {
        const bid = insert('INSERT INTO batches(product_id,batch_no,mfg_date,exp_date,supplier_id,unit_cost) VALUES (?,?,?,?,?,?)', o.id, no, day(dleft - 700), day(dleft), Number(supId), o.buy);
        insert('INSERT INTO goods_receipt_lines(receipt_id,product_id,batch_id,qty,unit_cost) VALUES (?,?,?,?,?)', rid, o.id, bid, qty, o.buy);
        applyMovement({ ph, batchId: bid, productId: o.id, type: 'receipt', qty, refType: 'receipt', refId: rid, userId: U.stock_manager });
        (batchOf[sku] ||= []).push(bid);
      }
    }
  }
  // lot périmé (cas de blocage) et lot en quarantaine
  const expB = insert('INSERT INTO batches(product_id,batch_no,mfg_date,exp_date,supplier_id,unit_cost) VALUES (?,?,?,?,?,?)', PID.LOR10, 'LOR10-EXP', day(-800), day(-10), sup['Distribution Pharma Sud'], 1500);
  applyMovement({ ph, batchId: expB, productId: PID.LOR10, type: 'receipt', qty: 18, userId: U.stock_manager });
  const quB = insert("INSERT INTO batches(product_id,batch_no,mfg_date,exp_date,status,status_reason,supplier_id,unit_cost) VALUES (?,?,?,?,'quarantine','Contrôle qualité en cours',?,?)", PID.CET10, 'CET10-Q', day(-300), day(300), sup['Distribution Pharma Sud'], 1400);
  applyMovement({ ph, batchId: quB, productId: PID.CET10, type: 'receipt', qty: 40, userId: U.stock_manager });
  // produit en rupture
  const lowSku = 'MASK50'; for (const bid of batchOf[lowSku]) { const l = get('SELECT qty_available q FROM stock_levels WHERE batch_id=?', bid); if (l.q > 3) applyMovement({ ph, batchId: bid, productId: PID[lowSku], type: 'loss', qty: -(l.q - 3 + (bid === batchOf[lowSku][0] ? 0 : 0)), reason: 'Mise en scène démo', userId: U.stock_manager }); }

  // Clients
  const cust = []; for (const [n, t] of [['Mohamed Ben Salah', '+216 20 000 001'], ['Fatma Trabelsi', '+216 20 000 002'], ['Ali Mansouri', '+216 20 000 003'], ['Hana Jebali', '+216 20 000 004']]) cust.push(insert('INSERT INTO customers(pharmacy_id,name,phone) VALUES (?,?,?)', ph, n, t));
  insert('INSERT INTO customers(pharmacy_id,user_id,name,email,marketing_consent,consent_at) VALUES (?,?,?,?,1,datetime(\'now\'))', ph, custUser, 'Salma Cliente', 'client@demo.local');

  // Ordonnance démo validée
  const presId = insert("INSERT INTO prescriptions(pharmacy_id,number,customer_id,patient_name,prescriber_name,prescription_date,valid_until,status,validated_by,created_by) VALUES (?,?,?,?,?,?,?,'validated',?,?)", ph, nextNumber(ph, 'rx', 'ORD'), cust[0], 'Mohamed Ben Salah', 'Dr. Prescripteur Démo', day(-2), day(88), U.pharmacist, U.assistant);
  insert('INSERT INTO prescription_lines(prescription_id,product_id,qty_prescribed,posology) VALUES (?,?,?,?)', presId, PID.AMX500, 2, '1 gélule x3/jour pendant 7 jours');
  insert('INSERT INTO prescription_lines(prescription_id,product_id,qty_prescribed,posology) VALUES (?,?,?,?)', presId, PID.PAR500, 1, 'Si douleur ou fièvre');
  insert("INSERT INTO prescription_reviews(prescription_id,from_status,to_status,reason,user_id) VALUES (?,NULL,'received','Ordonnance reçue',?)", presId, U.assistant);
  insert("INSERT INTO prescription_reviews(prescription_id,from_status,to_status,reason,user_id) VALUES (?,'received','validated','Contrôle pharmacien',?)", presId, U.pharmacist);
  const presId2 = insert("INSERT INTO prescriptions(pharmacy_id,number,patient_name,prescriber_name,prescription_date,status,created_by) VALUES (?,?,?,?,?,'received',?)", ph, nextNumber(ph, 'rx', 'ORD'), 'Fatma Trabelsi', 'Dr. Prescripteur Démo', day(-1), U.assistant);
  insert('INSERT INTO prescription_lines(prescription_id,product_id,qty_prescribed,posology) VALUES (?,?,?,?)', presId2, PID.MET850, 2, '1 cp matin et soir');
  insert("INSERT INTO prescription_reviews(prescription_id,to_status,reason,user_id) VALUES (?,'received','Ordonnance reçue',?)", presId2, U.assistant);
  // Bon de commande démo
  const po = insert("INSERT INTO purchase_orders(pharmacy_id,supplier_id,number,status,expected_date,created_by,approved_by) VALUES (?,?,?,'sent',?,?,?)", ph, sup['Grossiste Santé Plus'], nextNumber(ph, 'po', 'BC'), day(2), U.stock_manager, U.pharmacy_admin);
  insert('INSERT INTO purchase_order_lines(po_id,product_id,qty_ordered,unit_cost) VALUES (?,?,?,?)', po, PID.MASK50, 100, 3000);
  insert('INSERT INTO purchase_order_lines(po_id,product_id,qty_ordered,unit_cost) VALUES (?,?,?,?)', po, PID.PAR500, 200, 600);

  // Historique de ventes sur 30 jours (créées via le vrai moteur de vente, puis antidatées)
  const ctx = { ph, ip: '127.0.0.1', user: { id: U.pharmacist, email: 'pharmacien@demo.local', role: 'pharmacist', pharmacy_id: ph } };
  // le moteur lit les permissions depuis la base : on utilise le pharmacien pour couvrir tous les produits libres
  const sess = insert('INSERT INTO cash_sessions(pharmacy_id,register_id,user_id,opening_float) VALUES (?,?,?,?)', ph, reg1, U.pharmacist, 100000);
  const free = Object.entries(PRODUCT).filter(([s]) => !['PAR500', 'MASK50'].includes(s) && P.find((p) => p[0] === s)[7] === 'free');
  for (let i = 0; i < 70; i++) {
    const n = 1 + Math.floor(rnd() * 3), lines = [];
    for (let k = 0; k < n; k++) { const [sku] = rnd() < 0.3 ? ['PAR500'] : pick(free); lines.push({ product_id: PID[sku], qty: 1 + Math.floor(rnd() * 2) }); }
    const total = lines.reduce((a, l) => a + l.qty * (get('SELECT sale_price p FROM products WHERE id=?', l.product_id).p), 0);
    try {
      const s = createSale(ctx, { lines, customer_id: rnd() < 0.3 ? pick(cust) : null, payments: [{ method: pick(['cash', 'cash', 'card', 'mobile']), amount: total }] });
      const ago = Math.floor(rnd() * 29), hh = 8 + Math.floor(rnd() * 11);
      const ts = `${day(-ago)} ${String(hh).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}:00`;
      run('UPDATE sales SET created_at=? WHERE id=?', ts, s.id); run('UPDATE payments SET created_at=? WHERE sale_id=?', ts, s.id); run("UPDATE cash_movements SET created_at=? WHERE ref_type='sale' AND ref_id=?", ts, s.id);
    } catch (e) { /* produit en rupture : ignoré */ }
  }
  run("UPDATE cash_sessions SET status='closed', closed_at=datetime('now'), expected_cash=opening_float, counted_cash=opening_float, difference=0 WHERE id=?", sess);
});
(await import('./boot.js')).bootNetwork();
console.log(`Base de démonstration créée. Comptes (mot de passe : ${PASSWORD}) :`);
for (const e of ['superadmin', 'admin', 'responsable', 'pharmacien', 'preparateur', 'caissier', 'stock', 'comptable', 'auditeur', 'client']) console.log(`  ${e}@demo.local`);
