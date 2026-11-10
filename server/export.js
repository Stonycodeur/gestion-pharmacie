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
const CP1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '-': 0x96, '-': 0x97, 'Œ': 0x8c, 'œ': 0x9c };
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
  text(x, y, s, size = 9, bold = false) { this.cur.push(Buffer.concat([Buffer.from(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${(this.h - y).toFixed(2)} Td (`), enc(s), Buffer.from(') Tj ET\n')])); }
  line(x1, y1, x2, y2, wd = 0.5) { this.cur.push(Buffer.from(`${wd} w ${x1} ${this.h - y1} m ${x2} ${this.h - y2} l S\n`)); }
  rect(x, y, w, h, gray) { this.cur.push(Buffer.from(`${gray} g ${x} ${this.h - y - h} ${w} ${h} re f 0 g\n`)); }
  build() {
    const objs = []; const add = (b) => { objs.push(Buffer.isBuffer(b) ? b : Buffer.from(b)); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>'); add(''); // 2 = pages (rempli plus bas)
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const p of this.pages) {
      const body = Buffer.concat(p);
      const c = add(Buffer.concat([Buffer.from(`<< /Length ${body.length} >>\nstream\n`), body, Buffer.from('\nendstream')]));
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.w} ${this.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    }
    objs[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
    const parts = [Buffer.from('%PDF-1.4\n')]; const offs = []; let pos = parts[0].length;
    objs.forEach((o, i) => { offs.push(pos); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); parts.push(b); pos += b.length; });
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
}

// Tableau paginé. columns: [{key, label, money?, align?}] ; rows: objets ; dec = décimales monétaires
export function pdfTable({ title, subtitle = '', columns, rows, dec = 3, footer = '' }) {
  const landscape = columns.length > 6;
  const W = landscape ? 842 : 595, H = landscape ? 595 : 842, M = 36;
  const pdf = new Pdf(W, H);
  const cell = (c, r) => (c.money ? money(r[c.key] ?? 0, dec) : r[c.key] ?? '');
  const weights = columns.map((c) => Math.min(28, Math.max(6, c.label.length, ...rows.slice(0, 200).map((r) => String(cell(c, r)).length))));
  const tw = weights.reduce((a, b) => a + b, 0), avail = W - 2 * M;
  const widths = weights.map((w) => (w / tw) * avail);
  const head = () => {
    pdf.text(M, M, title, 14, true); if (subtitle) pdf.text(M, M + 16, subtitle, 9);
    return M + (subtitle ? 34 : 24);
  };
  let y = head(); const lh = 14;
  const header = () => {
    pdf.rect(M, y - 10, avail, lh, 0.9); let x = M;
    columns.forEach((c, i) => { pdf.text(c.money ? x + widths[i] - approx(c.label, 8, true) - 3 : x + 3, y, fit(c.label, widths[i] - 6, 8, true), 8, true); x += widths[i]; }); y += lh;
  };
  header();
  let i = 0;
  for (const r of rows) {
    if (y > H - M - 20) { pdf.newPage(); y = head(); header(); }
    let x = M;
    columns.forEach((c, j) => { const v = fit(cell(c, r), widths[j] - 6, 8); pdf.text(c.money ? x + widths[j] - approx(v, 8) - 3 : x + 3, y, v, 8); x += widths[j]; });
    pdf.line(M, y + 3.5, W - M, y + 3.5, 0.2); y += lh; i++;
  }
  if (!rows.length) pdf.text(M + 3, y, 'Aucune donnée sur la période.', 9);
  if (footer) pdf.text(M, H - M + 10, footer, 7);
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
function zip(files) { // files: [{name, data(Buffer)}] - méthode 0 (stockage), suffisant pour de petits classeurs
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

export function xlsx({ sheet = 'Export', columns, rows, dec = 3 }) {
  const fmtCode = dec > 0 ? '0.' + '0'.repeat(dec) : '0';
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="${fmtCode}"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`;
  const str = (r, c, v, s = 0) => `<c r="${colName(c)}${r}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  let data = `<row r="1">${columns.map((c, i) => str(1, i, c.label, 1)).join('')}</row>`;
  rows.forEach((row, ri) => {
    data += `<row r="${ri + 2}">` + columns.map((c, i) => {
      const v = row[c.key];
      if (v === null || v === undefined || v === '') return '';
      if (c.money && Number.isFinite(Number(v))) return `<c r="${colName(i)}${ri + 2}" s="2"><v>${Number(v) / Math.pow(10, dec)}</v></c>`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${colName(i)}${ri + 2}"><v>${v}</v></c>`;
      let t = String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; // pas de formules injectées
      return str(ri + 2, i, t);
    }).join('') + '</row>';
  });
  const widths = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(40, Math.max(10, c.label.length + 2, ...rows.slice(0, 100).map((r) => String(r[c.key] ?? '').length + 2)))}" customWidth="1"/>`).join('');
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${data}</sheetData></worksheet>`;
  const name = xml(sheet.replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Export');
  const F = (n, s) => ({ name: n, data: Buffer.from(s) });
  return zip([
    F('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    F('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    F('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    F('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    F('xl/styles.xml', styles), F('xl/worksheets/sheet1.xml', sheetXml),
  ]);
}

export const toColumns = (cols) => cols.map((k) => ({ key: k, label: label(k), money: MONEY_COLS.has(k) }));
