// Exports sans dépendance : PDF (Helvetica, texte latin) et XLSX (zip « stored » + XML minimal).
import { crc32 } from 'node:zlib';

export const MONEY_COLS = new Set(['gross', 'discount', 'tax', 'refunded', 'net', 'cost', 'margin', 'total', 'revenue', 'value', 'opening_float', 'expected_cash', 'counted_cash', 'difference', 'ht', 'ttc', 'amount', 'credit_amount', 'balance', 'bought', 'credits', 'paid', 'debit', 'credit', 'unit_price', 'stock_value', 'forecast_value']);
export const LABELS = {
  period: 'Période', tickets: 'Tickets', gross: 'Brut TTC', discount: 'Remises', tax: 'TVA', refunded: 'Remboursé', net: 'Net', cost: 'Coût', margin: 'Marge',
  method: 'Mode', total: 'Total', n: 'Nb', sku: 'SKU', name: 'Produit', qty: 'Qté', revenue: 'CA', value: 'Valeur', batch_no: 'Lot', exp_date: 'Péremption', state: 'État',
  type: 'Type', reason: 'Motif', created_at: 'Date', id: 'N°', opened_at: 'Ouverture', closed_at: 'Clôture', cashier: 'Caissier', register: 'Caisse', opening_float: 'Fond',
  expected_cash: 'Attendu', counted_cash: 'Compté', difference: 'Écart', difference_reason: 'Justification', tax_rate: 'Taux TVA %', ht: 'HT', ttc: 'TTC',
  section: 'Rubrique', label: 'Libellé', amount: 'Montant', supplier: 'Fournisseur', bought: 'Achats', credits: 'Avoirs', paid: 'Payé', balance: 'Solde',
  debit: 'Débit', credit: 'Crédit', code: 'Compte', date: 'Date', ref: 'Référence', source: 'Origine', stock_value: 'Valeur stock', avg_daily: 'Moy./jour', days_left: 'Jours restants', suggested: 'À commander', abc: 'Classe', share: 'Part %', stockout: 'Rupture prévue', forecast_qty: 'Prévu 30 j', on_hand: 'En stock',
};
const label = (c) => LABELS[c] || c;
export const money = (v, dec) => (Number(v) / Math.pow(10, dec)).toFixed(dec);

// ---------------- PDF ----------------
const CP1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, 'Œ': 0x8c, 'œ': 0x9c };
function enc(s) {
  const out = [];
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if (c === 0x28 || c === 0x29 || c === 0x5c) { out.push(0x5c, c); } // ( ) \
    else if (c >= 32 && c < 127) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (CP1252[ch] !== undefined) out.push(CP1252[ch]);
    else if (c === 0x202f || c === 0x2009) out.push(32);
    else out.push(0x3f); // caractères hors latin (ex. arabe) non pris en charge par ce moteur PDF
  }
  return Buffer.from(out);
}
const approx = (s, size, bold) => String(s ?? '').length * size * (bold ? 0.56 : 0.5);
function fit(s, width, size, bold) {
  s = String(s ?? ''); if (approx(s, size, bold) <= width) return s;
  const max = Math.max(1, Math.floor(width / (size * (bold ? 0.56 : 0.5))) - 1); return s.slice(0, max) + '…';
}

class Pdf {
  constructor(w, h) { this.pages = []; this.w = w; this.h = h; this.newPage(); }
  newPage() { this.cur = []; this.pages.push(this.cur); }
  text(x, y, s, size = 9, bold = false, color = null) { this.cur.push(Buffer.concat([Buffer.from(`${color ? color.join(' ') + ' rg ' : ''}BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${(this.h - y).toFixed(2)} Td (`), enc(s), Buffer.from(`) Tj ET${color ? ' 0 g' : ''}\n`)])); }
  frect(x, y, w, h, rgb) { this.cur.push(Buffer.from(`${rgb.join(' ')} rg ${x.toFixed(2)} ${(this.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g\n`)); }
  line(x1, y1, x2, y2, wd = 0.5) { this.cur.push(Buffer.from(`${wd} w ${x1} ${this.h - y1} m ${x2} ${this.h - y2} l S\n`)); }
  image(x, y, w, h, img) { this.imgs ||= []; const k = 'Im' + (this.imgs.push(img)); (this.pageImgs ||= new Map()); const set = this.pageImgs.get(this.pages.length - 1) || new Set(); set.add(k); this.pageImgs.set(this.pages.length - 1, set); this.cur.push(Buffer.from(`q ${w} 0 0 ${h} ${x} ${this.h - y - h} cm /${k} Do Q\n`)); }
  rect(x, y, w, h, gray) { this.cur.push(Buffer.from(`${gray} g ${x} ${this.h - y - h} ${w} ${h} re f 0 g\n`)); }
  build() {
    const objs = []; const add = (b) => { objs.push(Buffer.isBuffer(b) ? b : Buffer.from(b)); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>'); add(''); // 2 = pages (rempli plus bas)
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const xo = (this.imgs || []).map((im) => { let sm = ''; if (im.alpha) { const a = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${im.alpha.length} >>\nstream\n`), im.alpha, Buffer.from('\nendstream')])); sm = ` /SMask ${a} 0 R`; }
      return add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace ${im.cs} /BitsPerComponent ${im.bpc} /Filter ${im.kind === 'jpeg' ? '/DCTDecode' : '/FlateDecode'}${im.decode || ''}${sm} /Length ${im.data.length} >>\nstream\n`), im.data, Buffer.from('\nendstream')])); });
    const kids = []; let pi = 0;
    for (const p of this.pages) {
      const body = Buffer.concat(p);
      const c = add(Buffer.concat([Buffer.from(`<< /Length ${body.length} >>\nstream\n`), body, Buffer.from('\nendstream')]));
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.w} ${this.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo.length ? ` /XObject << ${[...(this.pageImgs?.get(pi) || [])].map((k) => `/${k} ${xo[Number(k.slice(2)) - 1]} 0 R`).join(' ')} >>` : ''} >> /Contents ${c} 0 R >>`)); pi++;
    }
    objs[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
    const parts = [Buffer.from('%PDF-1.4\n')]; const offs = []; let pos = parts[0].length;
    objs.forEach((o, i) => { offs.push(pos); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); parts.push(b); pos += b.length; });
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
}

// Tableau paginé, personnalisé : bandeau + logo de la pharmacie (ou icône par défaut), titre de la page, sous-titre de la vue exportée,
// date/auteur/période, en-tête de colonnes coloré répété à chaque page, lignes zébrées, total des montants, pied de page « Page i / n ».
// columns: [{key, label, money?}] ; rows: objets ; dec = décimales monétaires ; meta: { pharmacy, logo, by, at, period, totals }
const BRAND = [0.06, 0.46, 0.43], GRAY = [0.4, 0.45, 0.45], ZEBRA = [0.955, 0.972, 0.97];
export function pdfTable({ title, subtitle = '', columns, rows, dec = 3, footer = '', meta = {} }) {
  const landscape = columns.length > 6;
  const W = landscape ? 842 : 595, H = landscape ? 595 : 842, M = 36;
  const pdf = new Pdf(W, H);
  const cell = (c, r) => (c.money ? money(r[c.key] ?? 0, dec) : r[c.key] ?? '');
  const weights = columns.map((c) => Math.min(28, Math.max(6, c.label.length, ...rows.slice(0, 200).map((r) => String(cell(c, r)).length))));
  const tw = weights.reduce((a, b) => a + b, 0), avail = W - 2 * M;
  const widths = weights.map((w) => (w / tw) * avail);
  const sums = columns.map((c) => (c.money ? rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0) : null)), withTotal = meta.totals !== false && rows.length > 1 && sums.some((v) => v !== null);
  const head = () => {
    pdf.frect(0, 0, W, 7, BRAND); const top = 24, lh = 46; let x = M;
    if (meta.logo) { const lw = Math.min(96, (meta.logo.w / meta.logo.h) * lh); pdf.image(M, top, lw, lh, meta.logo); x = M + lw + 12; }
    const right = [meta.at && `Édité le ${meta.at}`, meta.by && `par ${meta.by}`, meta.period && `Période : ${meta.period}`].filter(Boolean);
    const rw = Math.max(0, ...right.map((r) => approx(r, 8))) + 8;
    if (meta.pharmacy) pdf.text(x, top + 10, fit(meta.pharmacy, avail - (x - M) - rw, 9, true), 9, true, GRAY);
    pdf.text(x, top + 29, fit(title, avail - (x - M) - rw, 17, true), 17, true);
    if (subtitle) pdf.text(x, top + 44, fit(subtitle, avail - (x - M) - rw, 10.5, true), 10.5, true, BRAND);
    right.forEach((r, i) => pdf.text(W - M - approx(r, 8), top + 10 + i * 12, r, 8, false, GRAY));
    const yb = top + lh + 10; pdf.frect(M, yb, avail, 1.2, BRAND); return yb + 20;
  };
  let y = head(); const lh = 15;
  const header = () => {
    pdf.frect(M, y - 11, avail, lh + 1, BRAND); let x = M;
    columns.forEach((c, i) => { pdf.text(c.money ? x + widths[i] - approx(c.label, 8, true) - 4 : x + 4, y, fit(c.label, widths[i] - 8, 8, true), 8, true, [1, 1, 1]); x += widths[i]; }); y += lh + 1;
  };
  header();
  let i = 0;
  for (const r of rows) {
    if (y > H - M - 28) { pdf.newPage(); y = head(); header(); }
    if (i % 2) pdf.frect(M, y - 10.5, avail, lh, ZEBRA);
    let x = M;
    columns.forEach((c, j) => { const v = fit(cell(c, r), widths[j] - 8, 8); pdf.text(c.money ? x + widths[j] - approx(v, 8) - 4 : x + 4, y, v, 8); x += widths[j]; });
    y += lh; i++;
  }
  if (!rows.length) pdf.text(M + 4, y, 'Aucune donnée.', 9);
  else if (withTotal) {
    if (y > H - M - 28) { pdf.newPage(); y = head(); header(); }
    pdf.line(M, y - 10, W - M, y - 10, 0.8); let x = M;
    columns.forEach((c, j) => { if (j === 0) pdf.text(x + 4, y, 'Total', 8.5, true); else if (sums[j] !== null) { const v = money(sums[j], dec); pdf.text(x + widths[j] - approx(v, 8.5, true) - 4, y, v, 8.5, true); } x += widths[j]; }); y += lh;
  }
  const n = pdf.pages.length, foot = `${meta.pharmacy ? meta.pharmacy + ' — ' : ''}${title}${subtitle ? ' · ' + subtitle : ''}`;
  pdf.pages.forEach((pg, k) => { pdf.cur = pg; pdf.line(M, H - 30, W - M, H - 30, 0.4);
    pdf.text(M, H - 18, fit(foot, avail - 140, 7), 7, false, GRAY); const c = `${rows.length} ligne(s)${footer ? ' · ' + footer : ''}`; pdf.text(W / 2 + 40, H - 18, fit(c, 160, 7), 7, false, GRAY);
    const pn = `Page ${k + 1} / ${n}`; pdf.text(W - M - approx(pn, 7), H - 18, pn, 7, false, GRAY); });
  return pdf.build();
}

// Ticket / facture simplifiée (largeur ~80 mm)
export function pdfReceipt(sale) {
  const dec = sale.pharmacy.currency_decimals, cur = sale.pharmacy.currency;
  const W = 227, M = 10, rows = 14 + sale.lines.length * 2 + sale.payments.length + sale.refunds.length + 6;
  const pdf = new Pdf(W, Math.max(300, rows * 11 + 80));
  let y = 20; const c = (s, size = 8, bold = false) => { pdf.text(Math.max(M, (W - approx(s, size, bold)) / 2), y, s, size, bold); y += size + 3; };
  const lr = (a, b, size = 8, bold = false) => { pdf.text(M, y, fit(a, W - 2 * M - approx(b, size, bold) - 4, size, bold), size, bold); pdf.text(W - M - approx(b, size, bold), y, b, size, bold); y += size + 3; };
  c(sale.pharmacy.name, 11, true); if (sale.pharmacy.address) c(sale.pharmacy.address); if (sale.pharmacy.phone) c('Tél. ' + sale.pharmacy.phone);
  y += 4; pdf.line(M, y - 6, W - M, y - 6);
  lr('Ticket', sale.number, 8, true); lr('Date', sale.created_at); lr('Caissier', sale.cashier_name || ''); if (sale.customer_name) lr('Client', sale.customer_name);
  pdf.line(M, y - 2, W - M, y - 2); y += 4;
  for (const l of sale.lines) { pdf.text(M, y, fit(l.product_name, W - 2 * M, 8), 8); y += 11; lr(`  ${l.qty} x ${money(l.unit_price, dec)}  (lot ${l.batch_no})`, money(l.line_total, dec), 7); }
  pdf.line(M, y - 2, W - M, y - 2); y += 4;
  if (sale.discount) lr('Remises', '-' + money(sale.discount, dec));
  lr('dont TVA', money(sale.tax_total, dec), 8); lr(`TOTAL ${cur}`, money(sale.total, dec), 10, true);
  for (const p of sale.payments) lr('Payé · ' + p.method, money(p.amount, dec));
  if (sale.change_given) lr('Rendu', money(sale.change_given, dec));
  for (const r of sale.refunds) lr('Avoir ' + r.number, '-' + money(r.amount, dec));
  if (sale.balance_due > 0) lr('RESTE À PAYER', money(sale.balance_due, dec), 9, true);
  y += 6; if (sale.pharmacy.legal_notice) c(sale.pharmacy.legal_notice, 6); c('Merci de votre visite', 7);
  return pdf.build();
}

// ---------------- XLSX ----------------
function zip(files) { // files: [{name, data(Buffer)}] — méthode 0 (stockage), suffisant pour de petits classeurs
  const locals = [], centrals = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), crc = crc32(f.data), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(f.data.length, 18); h.writeUInt32LE(f.data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    locals.push(h, name, f.data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(f.data.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    centrals.push(c, name); off += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const colName = (i) => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

// Classeur Excel personnalisé : bloc d'en-tête (logo, pharmacie, titre, sous-titre, date/auteur/période), tableau avec FILTRES et TRI automatiques
// sur chaque colonne, volets figés, largeurs ajustées, nombres/montants numériques (triables), totaux dynamiques (SUBTOTAL : suivent les filtres),
// impression paysage ajustée à la largeur avec titres répétés.
// columns: [{key,label,money?,num?,dec?}] ; meta: { title, subtitle, pharmacy, by, at, period, logo:{buf,ext:'png'|'jpeg'} }
export function xlsx({ sheet = 'Export', columns, rows, dec = 3, meta = null }) {
  const NF = [0, 1, 2, 3, 4].map((d) => ({ id: 164 + d, code: d ? '#,##0.' + '0'.repeat(d) : '#,##0' }));
  // styles : 0 défaut · 1 en-tête · 2 titre · 3 sous-titre · 4 méta · 5 pharmacie · 6 total (libellé) · 7 texte · 8..12 nombres (0-4 décimales) · 13..17 totaux (0-4 décimales)
  const bd = '<border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD0D7D5"/></left><right style="thin"><color rgb="FFD0D7D5"/></right><top style="thin"><color rgb="FFD0D7D5"/></top><bottom style="thin"><color rgb="FFD0D7D5"/></bottom><diagonal/></border><border><left/><right/><top style="medium"><color rgb="FF0F766E"/></top><bottom/><diagonal/></border>';
  const xf = (num, font, fill, border, align = '') => `<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${align ? ` applyAlignment="1"><alignment ${align}/></xf>` : '/>'}`;
  const xfs = [xf(0, 0, 0, 0), xf(0, 1, 2, 1, 'horizontal="left" vertical="center" wrapText="1"'), xf(0, 2, 0, 0), xf(0, 3, 0, 0), xf(0, 4, 0, 0), xf(0, 5, 0, 0), xf(0, 6, 0, 2), xf(0, 0, 0, 1, 'vertical="top"'),
    ...NF.map((f) => xf(f.id, 0, 0, 1)), ...NF.map((f) => xf(f.id, 6, 0, 2))].join('');
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${NF.length}">${NF.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${f.code}"/>`).join('')}</numFmts>`
    + `<fonts count="7"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="18"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FF0F766E"/><name val="Calibri"/></font><font><sz val="9"/><color rgb="FF667370"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FF667370"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts>`
    + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3">${bd}</borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${8 + NF.length * 2}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const colDec = (c) => (c.money ? dec : Number.isInteger(c.dec) ? c.dec : null);
  const C = (r, c, v, st) => `<c r="${colName(c)}${r}" t="inlineStr" s="${st}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const head0 = meta ? 6 : 1, last = columns.length - 1; let top = '';
  if (meta) {
    top += `<row r="1" ht="20" customHeight="1">${C(1, 0, meta.pharmacy || '', 5)}</row><row r="2" ht="28" customHeight="1">${C(2, 0, meta.title || sheet, 2)}</row>`;
    top += `<row r="3" ht="20" customHeight="1">${meta.subtitle ? C(3, 0, meta.subtitle, 3) : ''}</row>`;
    top += `<row r="4">${C(4, 0, [meta.at && `Édité le ${meta.at}`, meta.by && `par ${meta.by}`, meta.period && `Période : ${meta.period}`].filter(Boolean).join(' · '), 4)}</row>`;
  }
  let data = top + `<row r="${head0}" ht="24" customHeight="1">${columns.map((c, i) => C(head0, i, c.label, 1)).join('')}</row>`;
  const first = head0 + 1;
  rows.forEach((row, ri) => {
    const r = first + ri;
    data += `<row r="${r}">` + columns.map((c, i) => {
      const v = row[c.key]; const cd = colDec(c);
      if (v === null || v === undefined || v === '') return `<c r="${colName(i)}${r}" s="7"/>`;
      if (c.money && Number.isFinite(Number(v))) return `<c r="${colName(i)}${r}" s="${8 + dec}"><v>${Number(v) / Math.pow(10, dec)}</v></c>`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${colName(i)}${r}" s="${cd !== null ? 8 + Math.min(4, cd) : Number.isInteger(v) ? 8 : 7}"><v>${v}</v></c>`;
      let t = String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; // pas de formules injectées
      return C(r, i, t, 7);
    }).join('') + '</row>';
  });
  const lastData = first + rows.length - 1;
  // totaux dynamiques : SUBTOTAL(109) ignore les lignes masquées par le filtre
  const totCols = columns.map((c, i) => ((c.money || c.sum) && rows.length > 1 ? i : -1)).filter((i) => i >= 0);
  let totRow = 0;
  if (totCols.length) {
    totRow = lastData + 1; data += `<row r="${totRow}">` + columns.map((c, i) => {
      if (i === 0) return C(totRow, 0, 'Total', 6);
      if (!totCols.includes(i)) return `<c r="${colName(i)}${totRow}" s="6"/>`;
      const cd = c.money ? dec : Math.min(4, colDec(c) ?? 0), sum = rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0) / (c.money ? Math.pow(10, dec) : 1);
      return `<c r="${colName(i)}${totRow}" s="${13 + cd}"><f>SUBTOTAL(109,${colName(i)}${first}:${colName(i)}${lastData})</f><v>${sum}</v></c>`;
    }).join('') + '</row>';
  }
  const widths = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(45, Math.max(11, c.label.length + 4, ...rows.slice(0, 150).map((r) => String(r[c.key] ?? '').length + 2)))}" customWidth="1"/>`).join('');
  const lastCol = colName(last), ref = `A${head0}:${lastCol}${Math.max(lastData, head0)}`, name = xml(String(sheet).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Export');
  const logo = meta?.logo;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><tabColor rgb="FF0F766E"/><pageSetUpPr fitToPage="1"/></sheetPr>`
    + `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${head0}" topLeftCell="A${head0 + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${head0 + 1}" sqref="A${head0 + 1}"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths}</cols><sheetData>${data}</sheetData>`
    + `<autoFilter ref="${ref}"/><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>`
    + `<headerFooter><oddFooter>&amp;L${xml((meta?.pharmacy ? meta.pharmacy + ' — ' : '') + (meta?.title || sheet) + (meta?.subtitle ? ' · ' + meta.subtitle : ''))}&amp;RPage &amp;P / &amp;N</oddFooter></headerFooter>${logo ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
  const F = (n, s) => ({ name: n, data: Buffer.isBuffer(s) ? s : Buffer.from(s) });
  const ext = logo?.ext === 'jpeg' ? 'jpeg' : 'png';
  const files = [
    F('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${logo ? `<Default Extension="${ext}" ContentType="image/${ext}"/>` : ''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${logo ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}</Types>`),
    F('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    F('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name}'!$A$${head0}:$${lastCol}$${Math.max(lastData, head0)}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'${name}'!$${head0}:$${head0}</definedName></definedNames></workbook>`),
    F('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    F('xl/styles.xml', styles), F('xl/worksheets/sheet1.xml', sheetXml),
  ];
  if (logo) {
    files.push(F('xl/worksheets/_rels/sheet1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'));
    files.push(F('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.${ext}"/></Relationships>`));
    const px = 9525, hgt = 62, wid = Math.round(Math.min(150, (logo.w / logo.h) * hgt));
    files.push(F('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>${last}</xdr:col><xdr:colOff>${6 * px}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${4 * px}</xdr:rowOff></xdr:from><xdr:ext cx="${wid * px}" cy="${hgt * px}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo" descr="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wid * px}" cy="${hgt * px}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`));
    files.push(F(`xl/media/logo.${ext}`, logo.buf));
  }
  return zip(files);
}

export const toColumns = (cols) => cols.map((k) => ({ key: k, label: label(k), money: MONEY_COLS.has(k) }));

// ---------------- Reçu de paiement (A4) avec QR de vérification ----------------
// v = { pharmacy:{name,address,phone,email,legal_notice}, receipt:{number,code,payer_name,service,amount,currency,decimals,method_label,reference,created_at,signature}, lines:[{label,qty,unit,total}], tax, verify_url, matrix }
export function pdfPaymentReceipt(v) {
  const pdf = new Pdf(595, 842), r = v.receipt, dec = r.decimals, W = 595, M = 48; let y = 60;
  const lr = (a, b, size = 10, bold = false) => { pdf.text(M, y, fit(a, W - 2 * M - approx(b, size, bold) - 8, size, bold), size, bold); pdf.text(W - M - approx(b, size, bold), y, b, size, bold); y += size + 7; };
  pdf.rect(0, 0, W, 8, 0.15);
  let lx = M; if (v.logo) { const lh = 46, lw = Math.min(150, (v.logo.w / v.logo.h) * lh); pdf.image(M, y - 14, lw, lh, v.logo); lx = M + lw + 12; y += 8; }
  pdf.text(lx, y, fit(v.pharmacy.name, 330 - (lx - M), 20, true), 20, true); pdf.text(W - M - approx('REÇU DE PAIEMENT', 11, true), y - 4, 'REÇU DE PAIEMENT', 11, true); y += 18;
  if (v.pharmacy.address) { pdf.text(M, y, fit(v.pharmacy.address, 330, 9), 9); y += 12; }
  if (v.pharmacy.phone || v.pharmacy.email) { pdf.text(M, y, [v.pharmacy.phone && 'Tél. ' + v.pharmacy.phone, v.pharmacy.email].filter(Boolean).join(' · '), 9); y += 12; }
  y += 8; pdf.line(M, y, W - M, y, 1); y += 20;
  lr('Reçu n°', r.number, 11, true); lr('Référence de transaction', r.reference || '—'); lr('Date et heure', String(r.created_at).slice(0, 16).replace('T', ' ') + ' UTC');
  lr('Payeur', r.payer_name || '—'); lr('Moyen de paiement', r.method_label || '—'); lr('Statut', 'Payé'); y += 6; pdf.line(M, y - 4, W - M, y - 4); y += 12;
  pdf.text(M, y, 'Service payé', 10, true); y += 15; pdf.text(M, y, fit(r.service || '', W - 2 * M, 10), 10); y += 18;
  for (const l of v.lines) lr(`${l.qty} × ${l.label}`, money(l.total, dec), 9);
  y += 4; pdf.line(M, y - 2, W - M, y - 2); y += 14;
  if (v.tax) lr('dont taxes', money(v.tax, dec), 9);
  lr(`MONTANT PAYÉ (${r.currency})`, money(r.amount, dec), 13, true);
  if (v.matrix) { const n = v.matrix.length, cell = 3.2, qx = M, qy = y + 30, q = 4; pdf.rect(qx - q * cell, qy - q * cell, (n + 2 * q) * cell, (n + 2 * q) * cell, 1);
    v.matrix.forEach((row, ry) => row.forEach((on, cx) => { if (on) pdf.rect(qx + cx * cell, qy + ry * cell, cell + 0.15, cell + 0.15, 0); }));
    const tx = qx + (n + q) * cell + 14; let ty = qy + 6; pdf.text(tx, ty, 'Vérification du reçu', 10, true); ty += 14;
    for (const s of ['Scannez le QR code ou ouvrez le lien pour vérifier', 'l\'authenticité de ce reçu auprès de la plateforme.']) { pdf.text(tx, ty, s, 8); ty += 11; }
    ty += 4; pdf.text(tx, ty, fit(v.verify_url, W - M - tx, 7), 7); ty += 12; pdf.text(tx, ty, 'Code : ' + r.code, 8, true); ty += 14;
    pdf.text(tx, ty, 'Sceau électronique (HMAC-SHA256) :', 7, true); ty += 10; pdf.text(tx, ty, r.signature.slice(0, 32), 7); ty += 9; pdf.text(tx, ty, r.signature.slice(32), 7); y = Math.max(y, qy + n * cell + 20, ty); }
  y += 40; pdf.line(M, y, W - M, y); y += 14; if (v.pharmacy.legal_notice) { pdf.text(M, y, fit(v.pharmacy.legal_notice, W - 2 * M, 7), 7); y += 10; }
  pdf.text(M, y, 'Document généré automatiquement ; il reste consultable et archivé dans votre espace.', 7);
  return pdf.build();
}
